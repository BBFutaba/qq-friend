// 原图直送 (media.replyImages): the reply model also gets the pictures themselves, next to their saved readings.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fixtureStore, GROUP } from './fixture.js';
import { Engine } from '../src/engine.js';
import { Media } from '../src/media.js';
import { MediaLibrary } from '../src/stickers.js';
import { DEFAULTS, assertConfig } from '../src/config.js';
const png=n=>Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),Buffer.from(`picture-${n}`)]),pixel=n=>'data:image/png;base64,'+png(n).toString('base64'),CAT='一只橘猫趴在键盘上';
// The decoder stub turns a file into a data URL of its own bytes, so each attached picture can be told apart.
function setup(t,{media={},persona='gpt'}={}){
 const dir=mkdtempSync(join(tmpdir(),'qq-friend-reply-images-')),s=fixtureStore(),c=s.config();c.paused=false;c.personas[persona].prompt='一个可靠的群友';c.groups[0].persona=persona;c.output={...c.output,delayMs:0};c.wake={...c.wake,observerMinGapSeconds:0};c.media={...c.media,...media};s.saveConfig(c);
 const lib=new MediaLibrary(s,dir),files=new Map(),downloads=[],calls=[];
 const m=new Media({action:async()=>{throw new Error('no bridge in tests');}},lib,{fetch:async url=>{downloads.push(url);if(!files.has(url))throw new Error('媒体请求失败或已过期');return files.get(url);},decode:async(action,file)=>({images:['data:image/png;base64,'+readFileSync(file).toString('base64')],notes:[]})});m.ready=()=>true;
 const p={stop(){},async call(role,group,spec,prompt,signal,images=[]){calls.push({role,spec,prompt,images});return role==='perception'?{description:CAT}:role==='observer'?{decision:'respond',contextIds:[]}:{text:'好可爱'};}};
 const bot=new EventEmitter();bot.send=async()=>({message_id:'t'});const e=new Engine(s,p,bot,m);const queued=[];e.enqueue=row=>queued.push(row);
 t.after(()=>{e.stop();s.close();rmSync(dir,{recursive:true,force:true});});
 let n=0,at=Date.now()-60000;
 const message=(text,extra={})=>s.create('message',{groupId:GROUP,userId:'10000009',name:'小明',text,media:[],at:at+=100,direction:'in',...extra});
 // Like an arrival: the image is filed in the library (and its segment gets the hash) before any reply runs.
 const image=async(k,extra={},seg={})=>{const url=`https://gchat.qpic.cn/${++n}`;files.set(url,png(k));const row=message(' [image] ',{media:[{type:'image',file:`f${n}`,url,...seg}],...extra});await e.index(row);return row;};
 const reply=()=>calls.filter(x=>x.role==='reply').at(-1),refOf=id=>Object.entries(reply().prompt.refs).find(([,v])=>v===id)?.[0];
 return {s,e,lib,files,downloads,calls,queued,message,image,reply,refOf};}

test('off by default: the reply gets the saved reading, not the picture',async t=>{
 assert.equal(DEFAULTS.media.replyImages,false);assert.equal(DEFAULTS.media.replyImageCount,3);
 const x=setup(t),img=await x.image(1);await x.e.respond(GROUP);
 const r=x.reply();assert.deepEqual(r.images,[]);assert.equal(r.prompt.data.images,undefined);assert.doesNotMatch(r.prompt.system,/直接附上的原图/);
 assert.deepEqual(r.prompt.data.media.map(n=>[n.status,n.description]),[['known_image',CAT]]);assert.equal(x.s.get(img.id).mediaSummary,CAT);assert.equal(x.queued.length,1);
});
test('on: the picture goes to the reply with its message ref and reading, from the stored original',async t=>{
 const x=setup(t,{media:{replyImages:true}}),img=await x.image(1);await x.e.respond(GROUP);
 assert.equal(x.calls.filter(c=>c.role==='perception').length,1,'the reading is still made, for the observer and the library');
 const r=x.reply();assert.deepEqual(r.images,[pixel(1)]);assert.deepEqual(r.prompt.data.images,[{n:1,ref:x.refOf(img.id),description:CAT}]);
 assert.deepEqual(r.prompt.data.media,[],'no second, pixel-less note for the same picture');assert.match(r.prompt.system,/直接附上的原图/);
 const row=r.prompt.data.context.rows.find(row=>row[0]===x.refOf(img.id));assert.match(row.at(-2),new RegExp(`〔画面：${CAT}〕`),'the chat table keeps the reading');
 assert.equal(x.downloads.length,1,'the stored original is reused, not downloaded again');assert.equal(x.queued.length,1);
 // The note stays in the system prompt on a reply without pictures, so the prompt does not change from call to call.
 x.e.lastReply.clear();x.message('今天吃什么');await x.e.respond(GROUP);assert.match(x.reply().prompt.system,/直接附上的原图/);
});
test('the answered message first, then the one it quotes, then the newest others; stickers only when answered or quoted; capped',async t=>{
 const x=setup(t,{media:{replyImages:true,replyImageCount:3}});
 const old=await x.image(4),quoted=await x.image(1,{externalId:'ext-quoted'}),newer=await x.image(3),sticker=await x.image(2,{},{subType:1,summary:'[动画表情]'});
 const focus=x.message('这张是哪来的',{replyId:'ext-quoted'});await x.e.respond(GROUP);
 const r=x.reply();assert.deepEqual(r.prompt.data.images.map(p=>p.ref),[x.refOf(quoted.id),x.refOf(newer.id),x.refOf(old.id)]);assert.deepEqual(r.images,[pixel(1),pixel(3),pixel(4)]);
 assert.equal(r.prompt.data.focus,x.refOf(focus.id));assert.ok(!r.images.includes(pixel(2)),'a sticker in the recent chat is skipped');
 x.e.lastReply.clear();x.message('哈哈',{replyId:undefined});const c=x.s.config();c.media.replyImageCount=1;x.s.saveConfig(c);
 const own=await x.image(2,{},{subType:1,summary:'[动画表情]'});await x.e.respond(GROUP);
 assert.deepEqual(x.reply().images,[pixel(2)],'a sticker being answered is attached; the cap is one');assert.deepEqual(x.reply().prompt.data.images.map(p=>p.ref),[x.refOf(own.id)]);
});
test('a picture that cannot be fetched is left out and the reply still goes',async t=>{
 const x=setup(t,{media:{replyImages:true}}),img=await x.image(1);const hash=x.s.get(img.id).media[0].hash;
 // The cached original was evicted and the QQ link has expired: only the reading is left.
 await x.e.perceive(GROUP,[x.s.get(img.id)],x.s.config(),AbortSignal.timeout(5000));rmSync(x.lib.path(hash,'image/png'));x.files.clear();
 await x.e.respond(GROUP);
 const r=x.reply();assert.deepEqual(r.images,[]);assert.equal(r.prompt.data.images,undefined);assert.equal(x.queued.length,1);
 assert.match(r.prompt.data.context.rows.find(row=>row[0]===x.refOf(img.id)).at(-2),/〔画面：/);
 assert.equal(x.s.list('log',l=>l.type==='notice'&&l.message.startsWith('原图没能附上')).length,1);
});
test('a text-only DeepSeek persona is not given pictures even with the switch on',async t=>{
 const x=setup(t,{media:{replyImages:true},persona:'deepseek'});await x.image(1);await x.e.respond(GROUP);
 const r=x.reply();assert.deepEqual(r.images,[]);assert.equal(r.prompt.data.images,undefined);assert.doesNotMatch(r.prompt.system,/直接附上的原图/);
});
test('turning image reading off turns 原图直送 off too',async t=>{
 const x=setup(t,{media:{replyImages:true,images:false}});x.message(' [image] ',{media:[{type:'image',file:'f',url:'https://gchat.qpic.cn/x'}]});await x.e.respond(GROUP);
 const r=x.reply();assert.deepEqual(r.images,[]);assert.equal(r.prompt.data.images,undefined);assert.equal(x.downloads.length,0);
});
test('config: the switch is a boolean and the count is 1 to 6',t=>{
 const s=fixtureStore();t.after(()=>s.close());const base=()=>structuredClone(s.config());
 for(const [k,v] of [['replyImages','yes'],['replyImageCount',0],['replyImageCount',7],['replyImageCount',2.5]]){const c=base();c.media[k]=v;assert.throws(()=>assertConfig(c),undefined,`${k}=${v}`);}
 for(const v of [1,6]){const c=base();c.media.replyImages=true;c.media.replyImageCount=v;assert.doesNotThrow(()=>assertConfig(c));}
});
