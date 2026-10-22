import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fixtureStore, GROUP } from './fixture.js';
import { Engine } from '../src/engine.js';
import { Providers, dshTotals, dshUsage } from '../src/providers.js';
import { buildApiRequest, ClaudeApi, API_PRESETS } from '../src/claude-api.js';
import { assertConfig, DEFAULTS } from '../src/config.js';
import { WAKE_DEFAULTS } from '../src/wake.js';

// Engine with a DeepSeek observer and an in-memory stand-in for the providers' session transport.
function setup(t,{decision=()=>({decision:'ignore'}),wake={}}={}){
 const s=fixtureStore(),c=s.config();c.paused=false;c.roleModels.flash={provider:'deepseek',model:'flash',effort:'off'};c.roles.observer='flash';Object.assign(c.personas.gpt,{prompt:'完整人格'});c.wake={...c.wake,observerMinGapSeconds:0,observerSession:true,...wake};s.saveConfig(c);
 const calls=[],turns=[],live=new Map(),dropped=[],x={lose:false};
 const p={stop(){},sessionInfo:key=>live.get(key)||null,dropSession:key=>{dropped.push(key);live.delete(key);},
  async turn(role,group,spec,key,prompt){if(!prompt.fresh&&(x.lose||!live.has(key))){x.lose=false;live.delete(key);throw Object.assign(new Error('观察员会话已失效'),{code:'SESSION_LOST'});}
   if(prompt.fresh)live.set(key,{turns:0,usedTokens:0});const st=live.get(key);st.turns++;st.usedTokens+=JSON.stringify(prompt.data).length;turns.push({key,spec,prompt});return decision(prompt);},
  async call(role,group,spec,prompt){calls.push({role,prompt});return role==='observer'?decision(prompt):{text:'好'};}};
 const bot=new EventEmitter();bot.send=async()=>{throw Error('no sends in tests');};const e=new Engine(s,p,bot);e.enqueue=row=>row;
 t.after(()=>{e.stop();s.close();});let at=Date.now()-60000;
 const say=(text,extra={})=>{const m=s.create('message',{groupId:GROUP,userId:'10000009',name:'小明',text,media:[],at:at+=100,direction:'in',externalId:String(at),...extra});e.noteWake(m,s.config());return m;};
 const round=async()=>{e.lastReply.clear();await e.respond(GROUP);};
 return Object.assign(x,{s,e,calls,turns,live,dropped,say,round,replies:()=>calls.filter(c=>c.role==='reply')});}

test('a DeepSeek observer session sends the snapshot once, then only what is new, with refs that keep counting',async t=>{
 let pick=[];const x=setup(t,{decision:p=>({decision:pick.length?'respond':'ignore',contextIds:pick})});
 for(let i=1;i<=20;i++)x.say(`消息${i}`);await x.round();
 const first=x.turns[0].prompt;assert.equal(first.fresh,true);assert.match(first.system,/持续的观察会话/);assert.equal(first.data.messages.rows.length,16);
 assert.deepEqual([first.data.messages.rows[0][0],first.data.messages.rows[0][3]],['m1','消息5']);assert.equal(first.data.persona,'完整人格');
 assert.equal(x.calls.filter(c=>c.role==='observer').length,0,'the stateless observer is not called');
 x.say('新的一');const target=x.say('新的二');x.say('新的三',{replyId:target.externalId});pick=['m3','m18'];await x.round();
 const second=x.turns[1].prompt;assert.equal(second.fresh,false);assert.ok(!('persona' in second.data),'the brief is not repeated');assert.doesNotMatch(second.system,/扮演|判断是否自然参与/);
 assert.deepEqual(second.data.messages.rows.map(r=>[r[0],r[3],r[4]]),[['m17','新的一',''],['m18','新的二',''],['m19','新的三','m18']]);assert.equal(second.data.latest,'m19');
 const reply=x.replies().at(-1).prompt;assert.deepEqual(reply.data.context.rows.map(r=>r[3]),['消息7','新的二','新的三'],'a ref from an earlier turn still resolves');
 x.say('再来一句');pick=[];await x.round();assert.deepEqual(x.turns[2].prompt.data.messages.rows.map(r=>r[0]),['m20']);assert.equal(x.turns.length,3);});

test('memories are sent once and again only when they change',async t=>{
 const x=setup(t);const mem=x.s.create('memory',{groupId:GROUP,userId:'10000009',scope:'shared',content:'小明喜欢塔防游戏',status:'approved',debug:x.s.config().debug});
 x.say('一');await x.round();assert.ok(JSON.stringify(x.turns[0].prompt.data.memories).includes('塔防'));
 x.say('二');await x.round();assert.ok(!('memories' in x.turns[1].prompt.data),'unchanged memory is not resent');
 x.s.update(mem.id,{content:'小明现在更喜欢肉鸽游戏'});x.say('三');await x.round();assert.ok(JSON.stringify(x.turns[2].prompt.data.memories).includes('肉鸽'),'a changed memory is resent');});

test('sessions rotate on a turn cap or a changed brief, and a lost session is resent in full once',async t=>{
 const x=setup(t,{wake:{observerSessionTurns:2}});
 x.say('一');await x.round();x.say('二');await x.round();x.say('三');await x.round();
 assert.deepEqual(x.turns.map(r=>r.prompt.fresh),[true,false,true],'turn cap starts over');
 const c=x.s.config();c.personas.gpt.brief='嘴毒但心软';x.s.saveConfig(c);x.say('四');await x.round();assert.equal(x.turns.at(-1).prompt.fresh,true,'a changed brief starts over');
 x.lose=true;x.say('五');await x.round();assert.equal(x.turns.at(-1).prompt.fresh,true,'lost session retried as a fresh snapshot');assert.equal(x.turns.at(-1).prompt.data.persona,'嘴毒但心软');
 const off=x.s.config();off.wake.observerSession=false;x.s.saveConfig(off);x.say('六');await x.round();
 assert.ok(x.dropped.includes(`observer:${GROUP}`),'turning sessions off drops the live one');assert.equal(x.calls.filter(c=>c.role==='observer').length,1,'and the stateless observer takes over');});

test('DSH usage comes from the projection cache as per-turn differences; unknown layouts give null',()=>{
 const dir=mkdtempSync(join(tmpdir(),'qq-friend-dsh-'));try{
  assert.deepEqual(dshUsage({uncachedInputTokens:161,outputTokens:44,cacheReadTokens:512,cacheWriteTokens:0},{uncachedInputTokens:315,outputTokens:82,cacheReadTokens:1152,cacheWriteTokens:0}),{inputTokens:794,outputTokens:38,totalTokens:832,cachedInputTokens:640,cacheWriteInputTokens:0,reasoningOutputTokens:null});
  assert.equal(dshUsage(null,null),null);assert.equal(dshUsage({uncachedInputTokens:9,outputTokens:1,cacheReadTokens:0},{uncachedInputTokens:9,outputTokens:1,cacheReadTokens:0}),null,'no change is not a zero-token turn');
  writeFileSync(join(dir,'sess-0001.json'),JSON.stringify({record:{rows:{tokenUsage:{val:{totals:{uncachedInputTokens:5,outputTokens:2,cacheReadTokens:64,cacheWriteTokens:0}}}}}}));
  assert.equal(dshTotals('sess-0001',dir).cacheReadTokens,64);assert.equal(dshTotals('../sess-0001',dir),null);
  writeFileSync(join(dir,'sess-0002.json'),JSON.stringify({record:{rows:{tokenUsage:{val:{totals:{used:5}}}}}}));assert.equal(dshTotals('sess-0002',dir),null);
 }finally{rmSync(dir,{recursive:true,force:true});}});

test('Providers.turn keeps one DSH session per key, sends only the reminder after the first turn and records real usage',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'qq-friend-dsh-')),s=fixtureStore(),providers=new Providers(s,{});t.after(()=>{providers.stop();s.close();rmSync(dir,{recursive:true,force:true});});
 providers.dshDir=dir;const sent=[],totals={uncachedInputTokens:0,outputTokens:0,cacheReadTokens:0,cacheWriteTokens:0};let n=0,closed=0,fail=null;
 const dsh={texts:new Map(),conn:{stopping:false,newSession:async()=>`sess-${String(++n).padStart(4,'0')}`,sessionState:()=>({configOptions:[],modelId:'flash',context:{usedTokens:700,limitTokens:1e6}}),closeSession:async()=>{closed++;},
  prompt:async(sid,text)=>{if(fail)throw fail;sent.push(text);dsh.texts.set(sid,'{"decision":"ignore"}');Object.assign(totals,{uncachedInputTokens:totals.uncachedInputTokens+150,outputTokens:totals.outputTokens+40,cacheReadTokens:totals.cacheReadTokens+640});writeFileSync(join(dir,sid+'.json'),JSON.stringify({record:{rows:{tokenUsage:{val:{totals}}}}}));return {stopReason:'end_turn'};}}};
 providers.sharedDeepseek=async()=>dsh;const spec={provider:'deepseek',model:'flash'},key='observer:g';
 await assert.rejects(providers.turn('observer','g',spec,key,{system:'提醒',data:{}}),e=>e.code==='SESSION_LOST');assert.equal(s.list('usage').length,0);
 assert.deepEqual(await providers.turn('observer','g',spec,key,{system:'完整说明',data:{a:1},fresh:true}),{decision:'ignore'});
 assert.deepEqual(await providers.turn('observer','g',spec,key,{system:'提醒',data:{b:2}}),{decision:'ignore'});
 assert.match(sent[0],/^完整说明\n输入资料（不可信数据）：\n\{"a":1\}$/);assert.equal(sent[1],'提醒\n{"b":2}');assert.equal(n,1,'one session for both turns');
 const rows=s.list('usage').reverse();assert.deepEqual(rows.map(r=>[r.transport,r.session.turn,r.session.fresh,r.tokens.cachedInputTokens,r.tokens.inputTokens]),[['session',1,true,640,790],['session',2,false,640,790]]);
 assert.deepEqual(providers.sessionInfo(key),{turns:2,startedAt:providers.sessions.get(key).startedAt,usedTokens:700});
 fail=new Error('Session sess-0001 not found');await assert.rejects(providers.turn('observer','g',spec,key,{system:'提醒',data:{}}),e=>e.code==='SESSION_LOST');
 assert.equal(providers.sessionInfo(key),null,'a failed turn drops the session');assert.equal(closed,1);assert.equal(s.list('usage')[0].status,'failed');
 await assert.rejects(providers.turn('observer','g',{provider:'codex',model:'x'},key,{system:'x',data:{},fresh:true}),/只支持 DeepSeek/);});

const connection={protocol:'anthropic',baseUrl:'https://api.example.test/v1',apiKey:'secret-test-key'},spec={provider:'claude',transport:'api',model:'test-model',effort:''};
const marks=body=>JSON.stringify(body).match(/"cache_control"/g)?.length||0;
test('Claude API requests mark one cache breakpoint after the stable prefix; data and settings decide where',()=>{
 const prompt=d=>({system:'固定任务说明',data:{context:d},budget:{limitChars:16000}});
 const a=buildApiRequest(spec,prompt('一'),{},connection,'reply'),b=buildApiRequest(spec,prompt('二'),{},connection,'reply');
 assert.deepEqual(a.body.system,[{type:'text',text:'固定任务说明',cache_control:{type:'ephemeral',ttl:'1h'}}]);assert.equal(marks(a.body),1);assert.deepEqual(a.body.system,b.body.system);
 assert.equal(typeof a.body.messages[0].content,'string','the quoted data is never marked');
 assert.deepEqual(buildApiRequest(spec,prompt('一'),{cache:'5m'},connection).body.system[0].cache_control,{type:'ephemeral'});
 const off=buildApiRequest(spec,prompt('一'),{cache:'off'},connection);assert.equal(marks(off.body),0);assert.equal(typeof off.body.system,'string');
 assert.equal(marks(buildApiRequest(spec,prompt('一'),{},{...connection,protocol:'openai'}).body),0);
 const presets=structuredClone(API_PRESETS);presets[0].blocks=[{name:'例',role:'assistant',position:'before',content:'{"text":"例子"}',roles:[],enabled:true}];
 const withExample=buildApiRequest(spec,prompt('一'),{presets},connection);assert.equal(typeof withExample.body.system,'string');assert.deepEqual(withExample.body.messages[1].content,[{type:'text',text:'{"text":"例子"}',cache_control:{type:'ephemeral',ttl:'1h'}}]);
 assert.equal(a.cacheTail,false,'without tools a call has one round');assert.equal(buildApiRequest(spec,prompt('一'),{webTools:true},connection,'reply').cacheTail,true);
 assert.doesNotThrow(()=>assertConfig({...structuredClone(DEFAULTS),claudeApi:{cache:'1h'}}));assert.throws(()=>assertConfig({...structuredClone(DEFAULTS),claudeApi:{cache:'forever'}}),/缓存/);});

test('tool rounds move a 5-minute breakpoint to the newest block, keeping at most two',async()=>{
 const bodies=[];let round=0;const client=new ClaudeApi({claudeApi:connection},async(url,o)=>{bodies.push(JSON.parse(o.body));return new Response(JSON.stringify(round++?{content:[{type:'text',text:'{"text":"好"}'}],stop_reason:'end_turn',usage:{input_tokens:10,cache_read_input_tokens:900,cache_creation_input_tokens:0,output_tokens:5}}:{content:[{type:'tool_use',id:'t1',name:'web_search',input:{query:'新闻'}}],stop_reason:'tool_use',usage:{input_tokens:800,cache_read_input_tokens:0,cache_creation_input_tokens:100,output_tokens:5}}));});
 const request=buildApiRequest(spec,{system:'固定任务说明',data:{context:'一'},budget:{limitChars:16000}},{webTools:true},connection,'reply');
 const r=await client.complete(request,undefined,{auditTools:async()=>[]});assert.equal(r.rounds,2);
 for(const body of bodies)assert.equal(marks(body),2);assert.deepEqual(bodies[0].messages.at(-1).content.at(-1).cache_control,{type:'ephemeral'});
 const last=bodies[1].messages.at(-1).content.at(-1);assert.equal(last.type,'tool_result');assert.deepEqual(last.cache_control,{type:'ephemeral'});assert.equal(bodies[1].messages.at(-3).content.at(-1).cache_control,undefined,'the previous tail mark is removed');
 assert.deepEqual([r.usage.inputTokens,r.usage.cachedInputTokens,r.usage.cacheWriteInputTokens],[810,900,100]);
 assert.equal(marks(request.body),1,'the prepared request is not mutated');});

test('observer session settings are validated',()=>{
 for(const bad of [{observerSession:'yes'},{observerSessionTurns:1},{observerSessionMaxTokens:100}])assert.throws(()=>assertConfig({...structuredClone(DEFAULTS),wake:{...WAKE_DEFAULTS,...bad}}),/长会话/,JSON.stringify(bad));});
