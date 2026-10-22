import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fixtureStore, GROUP, OWNER, BOT } from './fixture.js';
import { Engine } from '../src/engine.js';
import { Media } from '../src/media.js';
import { MediaLibrary } from '../src/stickers.js';
import { normalizeEvent } from '../src/onebot.js';
const png=n=>Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),Buffer.from(`sticker-${n}`)]),PIXEL='data:image/png;base64,AAAA',CAT='一只橘猫捂脸';
function setup(t,{debug=false,reply=()=>({text:'哈哈'})}={}){
 const dir=mkdtempSync(join(tmpdir(),'qq-friend-pipeline-')),s=fixtureStore(),c=s.config();c.paused=false;c.debug=debug;c.personas.gpt.prompt='一个可靠的群友';c.output={...c.output,delayMs:0};s.saveConfig(c);
 const lib=new MediaLibrary(s,dir),files=new Map(),downloads=[],decodes=[],calls=[];
 const media=new Media({action:async()=>{throw new Error('no bridge in tests');}},lib,{fetch:async url=>{downloads.push(url);return files.get(url);},decode:async(action,file)=>{decodes.push(file);return {images:[PIXEL],notes:[]};}});media.ready=()=>true;
 const p={stop(){},async call(role,group,spec,prompt,signal,images=[]){calls.push({role,prompt,images});return role==='perception'?{description:CAT}:role==='observer'?{decision:'respond',contextIds:[]}:reply(prompt);}};
 const bot=new EventEmitter();bot.sent=[];bot.images=[];bot.send=async(type,id,text)=>{bot.sent.push({type,id,text});return {message_id:'t'+bot.sent.length};};bot.sendImage=async(type,id,bytes)=>{bot.images.push({type,id,bytes});return {message_id:'i'+bot.images.length};};
 const e=new Engine(s,p,bot,media);t.after(()=>{e.stop();s.close();rmSync(dir,{recursive:true,force:true});});
 let n=0;const image=(bytes,extra={})=>{const url=`https://gchat.qpic.cn/${++n}`;files.set(url,bytes);return s.create('message',{groupId:GROUP,userId:'10000009',name:'小明',text:' [image] ',media:[{type:'image',file:`f${n}`,url,...extra}],at:Date.now()+n,direction:'in'});};
 const settle=async()=>{for(let i=0;i<200&&(e.outboxRunning||s.list('outbox',x=>x.status==='queued').length);i++)await new Promise(r=>setTimeout(r,5));};
 // Like schedule(): a failed turn is logged, not thrown.
 const round=async()=>{e.lastReply.clear();await e.respond(GROUP).catch(err=>e.logError('回复',err));await settle();};
 return {s,e,lib,bot,calls,downloads,decodes,image,round,perceptions:()=>calls.filter(x=>x.role==='perception').length,lastReply:()=>calls.filter(x=>x.role==='reply').at(-1)};}
test('a repeated image is described once; later sightings use the library without download, decode or model',async t=>{
 const x=setup(t),a=x.image(png(1));await x.e.index(a);const hash=x.s.get(a.id).media[0].hash;
 assert.equal(x.lib.get(hash).seenCount,1);assert.equal(x.s.get(a.id).updated,a.updated,'indexing must not reorder messages');
 await x.round();assert.equal(x.perceptions(),1);assert.equal(x.lib.get(hash).description,CAT);assert.equal(x.lib.get(hash).source,'model');assert.equal(x.downloads.length,1,'description reads the cached bytes, not the network');
 const b=x.image(png(1));await x.e.index(b);assert.equal(x.lib.get(hash).seenCount,2);await x.round();
 assert.equal(x.perceptions(),1,'no second perception');assert.equal(x.decodes.length,1);assert.equal(x.s.get(b.id).mediaSummary,CAT);assert.deepEqual(x.lastReply().images,[],'known image is not sent as pixels');
 assert.deepEqual(x.lastReply().prompt.data.media.map(m=>[m.status,m.description]),[['known_image',CAT]]);
 x.lib.edit(hash,{description:'熊猫头捂脸：表示被离谱到'},x.lib.get(hash).version);const c=x.image(png(1));await x.e.index(c);await x.round();
 assert.equal(x.perceptions(),1);assert.equal(x.s.get(c.id).mediaSummary,'熊猫头捂脸：表示被离谱到');assert.equal(x.lastReply().prompt.data.media[0].description,'熊猫头捂脸：表示被离谱到');});
test('each message counts once per image, even when indexing and description both read it',async t=>{
 const x=setup(t),a=x.image(png(2));await Promise.all([x.e.index(a),x.e.index(a)]);await x.round();
 const [row]=x.lib.list();assert.equal(row.seenCount,1);assert.equal(x.s.list('message',m=>m.id===a.id)[0].media[0].hash,row.hash);});
test('an image seen before its first description is still described once and saved for next time',async t=>{
 const x=setup(t),a=x.image(png(3));await x.round();assert.equal(x.perceptions(),1);const [row]=x.lib.list();assert.equal(row.description,CAT);assert.equal(row.seenCount,1);
 const b=x.image(png(3));await x.round();assert.equal(x.perceptions(),1);assert.equal(x.lib.list()[0].seenCount,2);assert.equal(x.s.get(b.id).mediaSummary,CAT);});
function sticker(x,n=9){const m=x.image(png(n));const row=x.lib.sighting(png(n),{groupId:GROUP,messageId:'seed'});x.lib.analysed(row.hash,{description:'熊猫捂脸'});x.lib.markStickers([row.hash],true);x.lib.edit(row.hash,{repertoire:{name:'捂脸',usage:'无语的时候',enabled:true}},x.lib.get(row.hash).version);x.s.remove(m.id);return row.hash;}
test('the reply may send a repertoire sticker by its menu code, after the text, and the menu never exposes hashes',async t=>{
 const x=setup(t,{reply:()=>({text:'这也行',sticker:'s1'})}),hash=sticker(x);x.s.create('message',{groupId:GROUP,userId:'10000009',name:'小明',text:'我把咖啡倒进了键盘',media:[],at:Date.now(),direction:'in'});await x.round();
 const prompt=x.lastReply().prompt;assert.deepEqual(prompt.data.stickers,[{id:'s1',name:'捂脸',usage:'无语的时候',meaning:'熊猫捂脸'}]);assert.ok(!JSON.stringify(prompt).includes(hash));assert.match(prompt.system,/只能使用 stickers 里的 id/);
 assert.deepEqual(x.bot.sent.map(s=>[s.type,s.id,s.text]),[['group',GROUP,'这也行']]);assert.equal(x.bot.images.length,1);assert.equal(x.bot.images[0].type,'group');assert.ok(x.bot.images[0].bytes.equals(png(9)));
 const out=x.s.list('outbox')[0];assert.equal(out.status,'sent');assert.equal(out.stickerSent,true);assert.equal(x.lib.get(hash).sentCount,1);
 const sent=x.s.list('message',m=>m.direction==='out');assert.deepEqual(sent.map(m=>m.text).sort(),['[表情包：捂脸]','这也行']);});
test('unknown sticker codes are ignored, and an empty reply with no valid sticker sends nothing',async t=>{
 let answer={text:'好',sticker:'s7'};const x=setup(t,{reply:()=>answer});sticker(x);const say=t=>x.s.create('message',{groupId:GROUP,userId:'10000009',name:'小明',text:t,media:[],at:Date.now(),direction:'in'});
 say('一');await x.round();assert.deepEqual(x.bot.sent.map(s=>s.text),['好']);assert.equal(x.bot.images.length,0);
 answer={text:'',sticker:'not-a-code'};say('二');await x.round();assert.equal(x.bot.sent.length,1);assert.equal(x.bot.images.length,0);assert.ok(x.s.list('log',l=>l.type==='error').some(l=>l.message.includes('回复内容为空')));});
test('without a repertoire the reply format is unchanged; a debug sticker-only reply tells the owner which sticker',async t=>{
 const plain=setup(t);plain.s.create('message',{groupId:GROUP,userId:'10000009',name:'小明',text:'在吗',media:[],at:Date.now(),direction:'in'});await plain.round();assert.equal(plain.lastReply().prompt.data.stickers,undefined);assert.match(plain.lastReply().prompt.system,/只返回 \{"text":"最终回复"\}/);
 const x=setup(t,{debug:true,reply:()=>({text:'',sticker:'s1'})});sticker(x);x.s.create('message',{groupId:GROUP,userId:'10000009',name:'小明',text:'离谱',media:[],at:Date.now(),direction:'in'});await x.round();
 assert.deepEqual(x.bot.sent.map(s=>[s.type,s.id]),[['private',OWNER]]);assert.match(x.bot.sent[0].text,/^\[调试 ·[^\n]*\]\n（发表情包「捂脸」）$/);assert.deepEqual(x.bot.images.map(s=>[s.type,s.id]),[['private',OWNER]]);});
test('QQ sticker hints on image segments are kept for the library',()=>{
 const c={botId:BOT,privateAllowlist:[OWNER],groups:[{id:GROUP,enabled:true}]};
 const m=normalizeEvent({post_type:'message',message_type:'group',self_id:Number(BOT),user_id:10000009,group_id:Number(GROUP),message_id:1,time:Math.floor(Date.now()/1000),sender:{nickname:'小明'},message:[{type:'image',data:{file:'a.gif',url:'https://gchat.qpic.cn/x',sub_type:1,summary:'[动画表情]'}},{type:'image',data:{file:'b.jpg',url:'https://gchat.qpic.cn/y'}}]},c);
 assert.deepEqual(m.media,[{type:'image',file:'a.gif',url:'https://gchat.qpic.cn/x',subType:1,summary:'[动画表情]'},{type:'image',file:'b.jpg',url:'https://gchat.qpic.cn/y'}]);});
