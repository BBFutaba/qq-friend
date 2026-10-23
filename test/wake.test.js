import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fixtureStore, GROUP, OWNER, BOT } from './fixture.js';
import { Store } from '../src/store.js';
import { Engine } from '../src/engine.js';
import { Media } from '../src/media.js';
import { MediaLibrary } from '../src/stickers.js';
import { assertConfig, DEFAULTS } from '../src/config.js';
import { fitPrompt } from '../src/context.js';
import { chatView, resolveRefs, messageText } from '../src/model-view.js';
import { wakeReason, stronger, unfinished, mentions, WAKE_DEFAULTS } from '../src/wake.js';

test('wake reasons: private, @, reply to the bot, names with word boundaries, keywords, else chatter',()=>{
 const bot=new Set(['900']),opts={names:['小团子','gpt'],keywords:['天气'],isBotMessage:id=>bot.has(id)},m=(x)=>({groupId:GROUP,text:'',...x});
 assert.equal(wakeReason(m({groupId:`private:${OWNER}`}),opts),'private');assert.equal(wakeReason(m({mentioned:true}),opts),'mention');
 assert.equal(wakeReason(m({replyId:'900'}),opts),'reply');assert.equal(wakeReason(m({replyId:'901'}),opts),'chatter');
 assert.equal(wakeReason(m({text:'小团子你在吗'}),opts),'name');assert.equal(wakeReason(m({text:'问问 GPT 吧'}),opts),'name');assert.equal(wakeReason(m({text:'我在用chatgpt'}),opts),'chatter');
 assert.equal(wakeReason(m({text:'今天天气不错'}),opts),'keyword');assert.equal(wakeReason(m({text:'哈哈哈'}),opts),'chatter');
 assert.equal(stronger('chatter','mention'),'mention');assert.equal(stronger('mention','chatter'),'mention');assert.equal(stronger('chatter',undefined),'chatter');
 assert.equal(mentions('Hi Bob!','bob'),true);assert.equal(mentions('bobby','bob'),false);});
test('unfinished messages are detected so the batch window stretches',()=>{
 for(const t of ['我觉得这个吧，','然后','其实 [image] ','你看...'])assert.equal(unfinished(t),true,t);
 for(const t of ['好的。','哈哈哈','说完了'])assert.equal(unfinished(t),false,t);});
test('compact chat view: short refs, minutes ago, @你, saved readings, sticker captions, head+tail clipping',()=>{
 const now=Date.UTC(2026,9,22,8,0),long='长'.repeat(300)+'结尾';
 const msgs=[{id:'a',externalId:'1',name:'小明',userId:'1',direction:'in',at:now-5*60000,text:`[@${BOT}] 早`},{id:'b',externalId:'2',name:'机器人',direction:'out',at:now-4*60000,text:'早上好'},{id:'c',externalId:'3',name:'小红',userId:'2',direction:'in',at:now-60000,text:' [image] ',mediaSummary:'一只猫',replyId:'2'},{id:'d',externalId:'4',name:'小红',direction:'in',at:now,text:' [image] ',media:[{type:'image',summary:'[动画表情]'}],replyId:'zz'},{id:'e',name:'小明',direction:'in',at:now,text:long}];
 const v=chatView(msgs,{now,botId:BOT,recent:1,limit:20,tail:5});
 assert.deepEqual(v.table.columns,['ref','who','ago','text','re']);
 assert.deepEqual(v.table.rows.slice(0,4),[['m1','小明',5,'@你 早',''],['m2','你',4,'早上好',''],['m3','小红',1,'〔画面：一只猫〕','m2'],['m4','小红',0,'[动画表情]','更早']]);
 assert.equal(v.table.rows[4][3],long,'the newest message keeps up to recentLimit');
 assert.equal(chatView(msgs.slice(4),{now,limit:20,tail:5,recent:0}).table.rows[0][3],'长'.repeat(20)+'…长长长结尾');
 assert.deepEqual(resolveRefs(v,['m3','e','m9']).map(m=>m.id),['c','e']);assert.equal(v.refOf('d'),'m4');
 assert.equal(messageText({text:''}),'[空消息]');
 assert.ok(JSON.stringify(v.table).length<JSON.stringify(msgs).length/2+400,'the table is much smaller than the records');});
test('fitPrompt trims chat tables oldest-first, keeps required refs, and marks cut text',()=>{
 const rows=Array.from({length:30},(_,i)=>[`m${i+1}`,'小明',1,`第${i+1}条 `+'字'.repeat(80),'']);
 const p=fitPrompt({system:'s',data:{messages:{columns:['ref','who','ago','text','re'],rows}}},1200,{requiredIds:['m30']});
 const kept=p.data.messages.rows.map(r=>r[0]);assert.ok(kept.includes('m30'));assert.ok(!kept.includes('m1'));assert.ok(p.budget.dropped.messages>0);
 const tight=fitPrompt({system:'s',data:{context:{columns:['ref','who','ago','text','re'],rows:[['m1','a',0,'字'.repeat(900),'']]}}},300,{requiredIds:['m1']});assert.match(tight.data.context.rows[0][3],/内容因预算截断/);});
test('wake settings are validated and filled in for configs saved before they existed',()=>{
 assert.doesNotThrow(()=>assertConfig(structuredClone(DEFAULTS)));
 for(const bad of [{observerMinGapSeconds:-1},{observerHourly:0},{batchMs:500},{unfinishedMs:2000},{names:['x'.repeat(21)]},{directReply:'yes'},{observerMessages:3}])assert.throws(()=>assertConfig({...structuredClone(DEFAULTS),wake:{...WAKE_DEFAULTS,...bad}}),/设置无效|超出允许范围/,JSON.stringify(bad));
 const s=new Store(':memory:'),{wake,...old}=s.config();s.update('config',{...old,wake:undefined});assert.deepEqual(s.config().wake,WAKE_DEFAULTS);s.close();});
function setup(t,{decision=()=>({decision:'ignore'}),wake={},persona={}}={}){
 const s=fixtureStore(),c=s.config();c.paused=false;Object.assign(c.personas.gpt,{prompt:'完整人格：'+'设'.repeat(500),...persona});c.wake={...c.wake,...wake};s.saveConfig(c);
 const calls=[],p={stop(){},async call(role,group,spec,prompt){calls.push({role,prompt});return role==='observer'?decision(prompt):{text:'好'};}};
 const bot=new EventEmitter();bot.send=async()=>{throw Error('no sends in tests');};const e=new Engine(s,p,bot);const queued=[];e.enqueue=row=>{queued.push(row);return row;};
 t.after(()=>{e.stop();s.close();});let at=Date.now()-60000;
 const say=(text,extra={})=>{const m=s.create('message',{groupId:GROUP,userId:'10000009',name:'小明',text,media:[],at:at+=100,direction:'in',externalId:String(at),...extra});e.noteWake(m,s.config());return m;};
 const round=async()=>{e.lastReply.clear();await e.respond(GROUP);};
 return {s,e,calls,queued,say,round,observers:()=>calls.filter(x=>x.role==='observer'),replies:()=>calls.filter(x=>x.role==='reply'),stats:()=>s.list('wake-stats')[0]||{}};}
test('a message aimed at the bot goes straight to the reply without an observer call',async t=>{
 for(const [label,extra] of [['@',{mentioned:true}],['name',{text:'小团子在吗'}]]){
  const x=setup(t,{wake:{names:['小团子']}});x.say('随便聊聊');x.say(extra.text||'喂',extra.text?{}:extra);await x.round();
  assert.equal(x.observers().length,0,label);assert.equal(x.replies().length,1,label);assert.equal(x.queued.length,1,label);assert.equal(x.stats().direct,1);
  assert.match(x.s.list('log',l=>l.type==='decision')[0].message,/直接回复/);}
 const reply=setup(t),mine=reply.s.create('message',{groupId:GROUP,userId:BOT,name:'GPT',text:'我说过的话',media:[],at:Date.now()-70000,direction:'out',delivered:true,debug:true,externalId:'bot-1'});reply.say('回你',{replyId:'bot-1'});await reply.round();
 assert.equal(reply.observers().length,0);assert.equal(reply.replies().length,1);assert.ok(mine);
 const off=setup(t,{wake:{directReply:false}});off.say('喂',{mentioned:true});await off.round();assert.equal(off.observers().length,1,'directReply off sends even @ through the observer');});
test('chatter is judged at most once per gap and per hourly cap; the rest is deferred, not dropped',async t=>{
 const x=setup(t,{wake:{observerMinGapSeconds:60,observerHourly:3}});x.say('一');await x.round();assert.equal(x.observers().length,1);
 x.say('二');await x.round();assert.equal(x.observers().length,1,'within the gap');assert.equal(x.stats().deferred,1);assert.ok(x.e.timers.has(GROUP),'a retry is scheduled');
 x.e.observerTimes.set(GROUP,[Date.now()-61000]);await x.round();assert.equal(x.observers().length,2,'after the gap');
 x.e.observerTimes.set(GROUP,[Date.now()-3000000,Date.now()-2000000,Date.now()-1000000]);x.say('三');await x.round();assert.equal(x.observers().length,2,'hourly cap reached');
 const wait=x.e.observerWait(GROUP,x.s.config().wake);assert.ok(wait>590000&&wait<=600000,'the oldest of the three frees a slot in ~10 minutes');assert.equal(x.stats().judged,2);});
test('the observer sees unread chatter plus four earlier messages, a persona brief, and refs that map back',async t=>{
 let pick=[];const x=setup(t,{wake:{observerMinGapSeconds:0},decision:p=>({decision:pick.length?'respond':'ignore',contextIds:pick})});
 const first=Array.from({length:30},(_,i)=>x.say(`消息${i+1}`));await x.round();
 let obs=x.observers().at(-1).prompt;assert.equal(obs.data.messages.rows.length,16);assert.equal(obs.data.persona,'完整人格：'+'设'.repeat(295));assert.ok(!JSON.stringify(obs.data).includes(first[0].id),'no record ids are sent');
 x.say('新的一');x.say('新的二');x.say('新的三');pick=['m2'];await x.round();obs=x.observers().at(-1).prompt;
 assert.deepEqual(obs.data.messages.rows.map(r=>r[3]),['消息27','消息28','消息29','消息30','新的一','新的二','新的三']);
 const reply=x.replies().at(-1).prompt;assert.deepEqual(reply.data.context.rows.map(r=>r[3]),['消息28','新的三']);assert.equal(Object.values(reply.refs).length,2);
 const brief=setup(t,{persona:{brief:'嘴毒但心软的群友'}});brief.say('哈');await brief.round();assert.equal(brief.observers()[0].prompt.data.persona,'嘴毒但心软的群友');});
test('batch windows: @ waits debounceMs, chatter batchMs, unfinished chatter unfinishedMs',t=>{
 const x=setup(t,{wake:{batchMs:8000,unfinishedMs:15000}}),c=()=>x.s.config();x.say('好的。');assert.equal(x.e.wakeDelay(GROUP,c()),8000);
 x.say('然后，');assert.equal(x.e.wakeDelay(GROUP,c()),15000);x.say('喂',{mentioned:true});assert.equal(x.e.wakeDelay(GROUP,c()),c().participation.debounceMs);x.say('哈哈');assert.equal(x.e.wakeDelay(GROUP,c()),c().participation.debounceMs,'an @ in the batch keeps it direct');});
test('stickers are offered at most once every stickerEvery replies and stickerHourly per hour',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'qq-friend-wake-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const x=setup(t,{wake:{observerMinGapSeconds:0,stickerEvery:3,stickerHourly:2}}),lib=new MediaLibrary(x.s,dir);x.e.media={library:lib,ready:()=>false,read:async()=>({images:[],notes:[]})};
 const png=Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),Buffer.from('pacing')]),r=lib.sighting(png,{groupId:GROUP});lib.markStickers([r.hash],true);lib.edit(r.hash,{repertoire:{name:'捂脸',usage:'无语',enabled:true}},lib.get(r.hash).version);
 const offered=async()=>{x.say('说点啥',{mentioned:true});await x.round();return !!x.replies().at(-1).prompt.data.stickers;};
 const sent=(sticker)=>x.s.create('outbox',{groupId:GROUP,category:'reply',status:'sent',createdAt:Date.now(),stickerSent:sticker,parts:[],receipts:[]});
 assert.equal(await offered(),true);sent(true);assert.equal(await offered(),false,'right after a sticker');sent(false);assert.equal(await offered(),false,'one reply later');sent(false);assert.equal(await offered(),true,'after stickerEvery replies');
 sent(true);sent(false);sent(false);assert.equal(await offered(),false,'stickerHourly reached');});
test('a QQ file name is trusted as an alias only when it is the MD5 of the bytes',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'qq-friend-alias-')),s=fixtureStore(),lib=new MediaLibrary(s,dir);t.after(()=>{s.close();rmSync(dir,{recursive:true,force:true});});
 const png=n=>Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),Buffer.from(`alias-${n}`)]),md5=b=>createHash('md5').update(b).digest('hex');
 const good=lib.sighting(png(1),{file:`${md5(png(1)).toUpperCase()}.png`,groupId:GROUP,messageId:'x1'});assert.equal(good.alias,md5(png(1)));lib.analysed(good.hash,{description:'熊猫头'});
 const liar=lib.sighting(png(2),{file:`${md5(png(1))}.jpg`,groupId:GROUP,messageId:'x2'});assert.equal(liar.alias,'','a name that does not match the bytes is not an alias');
 const downloads=[];const media=new Media({action:async()=>{throw Error('no bridge');}},lib,{fetch:async url=>{downloads.push(url);return png(1);},decode:async()=>({images:[],notes:[]})});
 const r=await media.image({id:'m9',groupId:GROUP},{type:'image',file:`{${md5(png(1))}}.gif`,url:'https://gchat.qpic.cn/z'},AbortSignal.timeout(1000));
 assert.equal(r.row.hash,good.hash);assert.equal(r.bytes,null);assert.equal(downloads.length,0,'known by alias: no download');assert.equal(lib.get(good.hash).seenCount,2);
 await media.image({id:'m10',groupId:GROUP},{type:'image',file:'0123456789abcdef0123456789abcdef.png',url:'https://gchat.qpic.cn/y'},AbortSignal.timeout(1000));assert.equal(downloads.length,1,'unknown name still downloads');});
