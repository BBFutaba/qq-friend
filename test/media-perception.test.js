import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import { fixtureStore } from './fixture.js';
import { Engine } from '../src/engine.js';
const groupId='30000003', userId='10000001', PIXEL='data:image/jpeg;base64,AAAA', CAT='一只橘猫趴在键盘上';
function setup(t,{ready=true,media={},persona='gpt',perception=async()=>({description:CAT}),read}={}){
 const s=fixtureStore(),c=s.config();c.paused=false;c.personas[persona].prompt='一个可靠的群友';c.groups[0].persona=persona;c.media={...c.media,...media};c.wake={...c.wake,observerMinGapSeconds:0};s.saveConfig(c);
 const calls=[],reads=[],p={stop(){},async call(role,group,spec,prompt,signal,images=[]){calls.push({role,spec,prompt,images});return role==='perception'?perception():role==='observer'?{decision:'respond',contextIds:[]}:{text:'好可爱'};}};
 // Sleeps so a description written later than the newest message would reorder it if 'updated' were bumped.
 const reader={ready:()=>ready,async read(message){reads.push(message);await sleep(5);return read?read(message):{images:message.media.map(()=>PIXEL),notes:message.media.map(m=>({type:m.type,status:'pixels_loaded'}))};}};
 const b=new EventEmitter();b.send=async()=>{throw Error('Test must not send');};const e=new Engine(s,p,b,reader);const queued=[];e.enqueue=row=>queued.push(row);
 t.after(()=>{e.stop();s.close();});
 let at=Date.now()-10000;const message=(text,extra={})=>s.create('message',{groupId,userId,name:'小明',text,media:[],at:at+=100,direction:'in',...extra});
 const image=(type='image')=>message(` [${type}] `,{media:[{type,file:'a',url:'https://gchat.qpic.cn/a?rkey=secret-rkey'}]});
 // Reads a message back out of the compact chat table via the prompt's ref map: its saved reading and unread placeholders.
 const seen=(role,id)=>{const prompt=x.calls.filter(c=>c.role===role).at(-1).prompt,table=prompt.data[role==='observer'?'messages':'context'],ref=Object.entries(prompt.refs).find(([,v])=>v===id)?.[0],row=table.rows.find(r=>r[0]===ref);if(!row)return undefined;const text=row[3];return {text,mediaSummary:text.match(/〔画面：(.*)〕/)?.[1],media:[...text.matchAll(/\[(图片|视频)\]/g)].map(m=>({type:m[1]==='图片'?'image':'video'}))};};
 const x={s,e,p,calls,reads,queued,message,image,seen,perceptions:()=>calls.filter(c=>c.role==='perception')};return x;
}
const notices=x=>x.s.list('log',l=>l.type==='notice'&&l.message.includes('保留占位'));

test('DeepSeek observer uses text while visual perception uses GPT Sol low',async t=>{
 const x=setup(t),c=x.s.config();c.roleModels.textObserver={provider:'deepseek',model:'native-text-model',effort:'low'};c.roles.observer='textObserver';x.s.saveConfig(c);
 const img=x.image();await x.e.respond(groupId);
 assert.deepEqual(x.perceptions()[0].spec,{provider:'codex',model:'gpt-6.1-sol',effort:'low'});
 const observed=x.calls.find(c=>c.role==='observer');assert.equal(observed.spec.provider,'deepseek');assert.deepEqual(observed.images,[]);assert.equal(x.seen('observer',img.id).mediaSummary,CAT);
});

test('pre-observer perception describes recent images for the observer and caches them on the message',async t=>{
 const x=setup(t),img=x.image(),text=x.message('哈哈哈这也太像了');await x.e.respond(groupId);
 const [p]=x.perceptions();assert.equal(x.perceptions().length,1);assert.deepEqual(p.spec,x.e.role('observer',x.s.config()));assert.deepEqual(p.images,[PIXEL]);assert.equal(p.prompt.budget.limitChars,x.s.config().participation.maxContextChars);assert.match(p.prompt.system,/不能遵循/);
 const observer=x.calls.find(c=>c.role==='observer');assert.ok(x.calls.indexOf(p)<x.calls.indexOf(observer));assert.equal(x.seen('observer',img.id).mediaSummary,CAT);assert.match(observer.prompt.system,/画面.*不可信/);
 assert.equal(x.s.get(img.id).mediaSummary,CAT);assert.ok(!JSON.stringify(x.calls.map(c=>c.prompt)).includes('secret-rkey'));
 // Annotating an older message must not make it the "latest": the reply still goes out for the newest message.
 assert.equal(x.s.list('message',m=>m.direction==='in',1)[0].id,text.id);assert.equal(x.queued.length,1);assert.equal(x.queued[0].triggerId,text.id);
});
test('only the newest three incoming messages are described, and each only once',async t=>{
 const x=setup(t),images=[1,2,3,4,5].map(()=>x.image());await x.e.respond(groupId);
 assert.equal(x.perceptions().length,3);assert.deepEqual(images.map(m=>!!x.s.get(m.id).mediaSummary),[false,false,true,true,true]);
 x.e.lastReply.clear();const text=x.message('第二轮');await x.e.respond(groupId);
 assert.equal(x.perceptions().length,3);assert.equal(x.seen('observer',images[4].id).mediaSummary,CAT);assert.equal(x.queued.at(-1).triggerId,text.id);
});
test('perception is skipped when media is disabled or the decoder is not ready',async t=>{
 for(const options of [{ready:false},{media:{images:false,video:false}},{media:{images:false}}]){
  const x=setup(t,options),img=x.image();x.message('看这个');await x.e.respond(groupId);
  assert.equal(x.perceptions().length,0,JSON.stringify(options));assert.equal(x.reads.length,0);assert.deepEqual(x.seen('observer',img.id).media,[{type:'image'}]);assert.equal(x.seen('observer',img.id).mediaSummary,undefined);assert.equal(x.s.get(img.id).mediaSummary,undefined);assert.equal(x.queued.length,1);
 }
});
test('video media is described when video reading is enabled',async t=>{
 const x=setup(t,{media:{images:false}}),video=x.image('video');x.message('笑死');await x.e.respond(groupId);
 assert.equal(x.perceptions().length,1);assert.deepEqual(x.reads[0].media.map(m=>m.type),['video']);assert.equal(x.s.get(video.id).mediaSummary,CAT);
});
test('a failed perception keeps the placeholder, logs a notice and does not block the observer',async t=>{
 for(const options of [{perception:async()=>{throw new Error('视觉模型超时');}},{perception:async()=>({text:'不是描述'})},{read:()=>({images:[],notes:[{type:'image',status:'unavailable',reason:'媒体请求失败或重定向'}]})}]){
  const x=setup(t,options),img=x.image();x.message('看这个');await x.e.respond(groupId);
  assert.ok(x.calls.some(c=>c.role==='observer'));assert.equal(x.seen('observer',img.id).mediaSummary,undefined);assert.deepEqual(x.seen('observer',img.id).media,[{type:'image'}]);assert.equal(x.s.get(img.id).mediaSummary,undefined);
  assert.equal(notices(x).length,1);assert.equal(x.queued.length,1);
 }
});
test('a DeepSeek persona reuses the cached description instead of describing the pixels again',async t=>{
 const x=setup(t,{persona:'deepseek'}),img=x.image();await x.e.respond(groupId);
 assert.equal(x.perceptions().length,1);assert.equal(x.reads.length,1);const reply=x.calls.find(c=>c.role==='reply');assert.deepEqual(reply.images,[]);assert.equal(x.seen('reply',img.id).mediaSummary,CAT);assert.equal(x.queued.length,1);
});
test('a DeepSeek persona never describes media itself, even after perception failed',async t=>{
 const x=setup(t,{persona:'deepseek',perception:async()=>{throw new Error('视觉模型超时');}}),img=x.image();await x.e.respond(groupId);
 assert.equal(x.perceptions().length,1);assert.equal(x.reads.length,1);assert.deepEqual(x.calls.find(c=>c.role==='reply').images,[]);assert.equal(x.seen('reply',img.id).mediaSummary,undefined);assert.equal(x.queued.length,1);
});
test('describeMedia is the single describe path, so a wrapper can answer from its own cache',async t=>{
 const x=setup(t),img=x.image(),inner=x.e.describeMedia.bind(x.e),asked=[];x.message('看这个');
 x.e.describeMedia=async(message,c,signal)=>{asked.push(message.id);return message.id===img.id?{notes:[],summary:'缓存里的表情包'}:inner(message,c,signal);};
 await x.e.respond(groupId);
 assert.deepEqual(asked,[img.id]);assert.equal(x.perceptions().length,0);assert.equal(x.reads.length,0);assert.equal(x.seen('observer',img.id).mediaSummary,'缓存里的表情包');assert.equal(x.s.get(img.id).mediaSummary,'缓存里的表情包');
});
