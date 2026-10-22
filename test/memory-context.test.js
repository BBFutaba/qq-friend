import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Store } from '../src/store.js';
import { fixtureStore, CONFIG } from './fixture.js';
import { Engine } from '../src/engine.js';
import { Providers } from '../src/providers.js';
import { fitPrompt, promptText, compactMemories, rankMemories } from '../src/context.js';
import { visibleMemory, protectedMemory, normalizedFact } from '../src/memory-policy.js';
const groupId='30000003', userId='10000001';
function setup(t){
 const s=fixtureStore(),c=s.config();c.paused=false;c.personas.gpt.prompt='一个可靠的群友';s.saveConfig(c);
 const calls=[],p={stop(){},async call(role,group,spec,prompt){calls.push({role,prompt});return role==='observer'?{decision:'respond',memoryIds:[],contextIds:[]}:role==='reply'?{text:'这款游戏听起来有趣'}:{operations:[]};}};
 const b=new EventEmitter();b.send=async()=>{throw Error('Test must not send');};const e=new Engine(s,p,b);const queued=[];e.enqueue=row=>queued.push(row);
 t.after(()=>{e.stop();s.close();});
 const message=(text='最近在玩科幻游戏',qq=userId,extra={})=>s.create('message',{groupId,userId:qq,name:qq,text,at:Date.now(),direction:'in',...extra});
 const memory=(content='喜欢科幻游戏',extra={})=>s.memory({groupId,userId,content,debug:true,...extra});
 const source=message();e.upsertMember(groupId,userId,'小明');
 return {s,e,p,c:s.config(),calls,queued,message,memory,source};
}
function candidate(x,extra={}){const m=x.memory('喜欢科幻游戏',{protected:false,sourceIds:[x.source.id],...extra});return m;}
function change(x,target,extra={}){return x.s.proposeMemoryChange({...target,targetId:target.id,targetVersion:target.version,action:'update',content:'现在更喜欢策略游戏',sourceIds:[x.source.id],...extra});}

test('observer IDs actually control reply memory; invented/cross-persona IDs are ignored',async t=>{
 const x=setup(t),yes=x.memory('喜欢科幻游戏'),no=x.memory('喜欢电影'),secret=x.memory('Claude 私有回忆',{scope:'persona',persona:'claude'});
 x.p.call=async(role,group,spec,prompt)=>{x.calls.push({role,prompt});return role==='observer'?{decision:'respond',memoryIds:[yes.id,secret.id,'fake'],contextIds:[]}:{text:'聊聊科幻游戏'};};
 await x.e.respond(groupId);const reply=x.calls.find(c=>c.role==='reply').prompt;
 assert.deepEqual(reply.data.memories.rows.map(r=>r.at(-1)),[yes.content]);assert.ok(!JSON.stringify(reply).includes(no.content));assert.equal(x.queued.length,1);
});
test('empty or missing observer memoryIds sends no fallback memory dump',async t=>{
 const x=setup(t);x.memory();await x.e.respond(groupId);assert.deepEqual(x.calls.at(-1).prompt.data.memories.rows,[]);
});
test('memory edited after observation is not silently substituted into the reply',async t=>{
 const x=setup(t),m=x.memory();x.p.call=async(role,group,spec,prompt)=>{x.calls.push({role,prompt});if(role==='observer'){x.s.editMemory(m.id,{content:'改后的事实',status:'approved'},m.version);return {decision:'respond',memoryIds:[m.id]};}return {text:'收到'};};
 await x.e.respond(groupId);assert.equal(x.calls.at(-1).prompt.data.memories.rows.length,0);
});
test('lexical ranking retrieves old relevant facts and mentioned members, excluding unrelated people',t=>{
 const x=setup(t);const old=x.memory('喜欢科幻游戏',{userId:'22222222'});x.s.update(old.id,{key:'兴趣:游戏'});
 for(let i=0;i<40;i++)x.memory('喜欢烹饪',{userId:String(33000000+i)});
 x.e.upsertMember(groupId,'44444444','小王');const named=x.memory('只喝无糖饮料',{userId:'44444444'});x.message('小王最近在玩科幻游戏');
 const ids=x.e.context(groupId,'gpt',x.c).memories.map(m=>m.id);assert.ok(ids.includes(old.id));assert.ok(ids.includes(named.id));assert.equal(ids.length,2);
});
test('approved formal baseline is opt-in, read-only and never leaks debug back to formal',t=>{
 const x=setup(t),formal=x.memory('正式群事件',{userId:'',debug:false}),debug=x.memory('调试群事件',{userId:''});
 assert.ok(!visibleMemory(formal,groupId,'gpt',x.c));
 const enabled={...x.c,memory:{...x.c.memory,debugReadApproved:true}};
 assert.ok(visibleMemory(formal,groupId,'gpt',enabled));assert.ok(!visibleMemory(debug,groupId,'gpt',{...enabled,debug:false}));
 assert.throws(()=>change(x,{...formal,protected:false},{debug:true}),/保护|范围/);
});
test('expired facts, pending rows, private interests, other groups and personas stay excluded',t=>{
 const x=setup(t),base=x.memory();
 for(const patch of [{expiresAt:Date.now()-1},{status:'pending'},{groupId:'other'},{scope:'private'},{scope:'persona',persona:'claude'}])assert.equal(visibleMemory({...base,...patch},groupId,'gpt',x.c),false);
});
test('short-term topics require lexical overlap and expire without deleting evidence',t=>{
 const x=setup(t),topic=x.memory('周末约玩游戏',{category:'topic',expiresAt:Date.now()+10000});
 const ids=rankMemories([topic],[{userId,text:'午饭吃什么'}],[],groupId,'gpt',x.c);assert.equal(ids.length,0);
 assert.equal(rankMemories([topic],[{userId,text:'周末游戏几点开始'}],[],groupId,'gpt',x.c).length,1);
 assert.throws(()=>x.memory('缺少时效的话题',{category:'topic'}),/有效期/);assert.equal(x.s.get(topic.id).content,topic.content);
});
test('final text budget includes persona, JSON and media and preserves necessary message IDs',()=>{
 const system='人格'.repeat(550),data={context:[{id:'old',text:'旧'.repeat(4000)},{id:'new',text:'新'.repeat(2000)},{id:'quote',text:'引用'.repeat(600)}],memories:compactMemories([{content:'记忆'.repeat(3000),scope:'shared'}]),people:{columns:['profile'],rows:[['画像'.repeat(600)]]},media:[{status:'transcribed',text:'媒体文字'.repeat(1000)}]};
 const result=fitPrompt({system,data},2500,{requiredIds:['new','quote']});
 assert.equal(result.system,system);assert.ok(promptText(result).length<=2500);assert.ok(result.data.context.some(m=>m.id==='new'));assert.ok(result.data.context.some(m=>m.id==='quote'));assert.equal(result.data.media[0].status,'transcribed');assert.ok(Object.keys(result.budget.dropped).length>0);assert.ok(result.budget.beforeChars>result.budget.chars);
 assert.equal(data.context[1].text.length,2000);
});
test('oversized instructions fail before invoking the model instead of silently cutting persona',()=>{
 assert.throws(()=>fitPrompt({system:'不删人格'.repeat(1000),data:{context:[{id:'a',text:'你好'}]}},2000),/提高预算/);
});
test('pending updates leave original unchanged until explicit approval and retain stable IDs/revisions',t=>{
 const x=setup(t),m=candidate(x),proposal=change(x,m);assert.equal(x.s.get(m.id).content,m.content);
 x.s.reviewMemoryChange(proposal.id,true,proposal.version);const next=x.s.get(m.id);assert.equal(next.content,'现在更喜欢策略游戏');assert.equal(next.version,m.version+1);assert.equal(next.status,'approved');assert.equal(x.s.list('revision',r=>r.targetId===m.id).length,2);
 assert.throws(()=>x.s.reviewMemoryChange(proposal.id,true,proposal.version),/改变/);
});
test('manual edits force protection and stale candidates cannot overwrite them even after unlock',t=>{
 const x=setup(t),m=candidate(x),proposal=change(x,m);const edited=x.s.editMemory(m.id,{content:'我确认的事实',status:'approved',protected:false},m.version);assert.equal(edited.protected,true);
 assert.throws(()=>change(x,edited),/保护/);
 assert.throws(()=>x.s.reviewMemoryChange(proposal.id,true,proposal.version),/人工内容/);
 const unlocked=x.s.editMemory(m.id,{content:edited.content,status:'approved',protected:false},edited.version);assert.equal(protectedMemory(unlocked),false);
 assert.throws(()=>x.s.reviewMemoryChange(proposal.id,true,proposal.version),/版本/);assert.equal(x.s.get(m.id).content,edited.content);assert.equal(x.s.get(proposal.id).status,'pending');
});
test('rejected updates and approved expiry preserve original source and revision history',t=>{
 const x=setup(t),m=candidate(x),rejected=change(x,m);x.s.reviewMemoryChange(rejected.id,false,rejected.version);assert.equal(x.s.get(m.id).version,m.version);
 const expire=change(x,m,{action:'expire'});x.s.reviewMemoryChange(expire.id,true,expire.version);assert.ok(!visibleMemory(x.s.get(m.id),groupId,'gpt',x.c));assert.ok(x.s.get(x.source.id));assert.equal(x.s.get(m.id).content,m.content);
});
test('updates reject wrong scope, source, target version and unsupported actions',t=>{
 const x=setup(t),m=candidate(x),foreign=x.message('私人资料',userId,{groupId:'private:'+userId});
 for(const patch of [{debug:false},{persona:'claude'},{userId:'99999999'},{targetVersion:99},{action:'execute'},{sourceIds:[foreign.id]}])assert.throws(()=>change(x,m,patch));
});
test('normalized duplicates and stable keys deduplicate only within the same branch/persona/person',t=>{
 const x=setup(t);const input={groupId,userId,debug:true,content:'喜欢 科幻游戏。',key:'member:兴趣',sourceIds:[x.source.id]};const a=x.s.memory(input,'memory-agent');
 assert.equal(x.s.memory({...input,content:'喜欢科幻游戏'},'memory-agent').id,a.id);
 assert.equal(x.s.memory({...input,content:'新增措辞'},'memory-agent').id,a.id);
 assert.notEqual(x.s.memory({...input,debug:false},'memory-agent').id,a.id);
 assert.notEqual(x.s.memory({...input,scope:'persona',persona:'claude'},'memory-agent').id,a.id);
});
test('same-scope history retrieval includes imported evidence without loading private or debug replies',t=>{
 const x=setup(t);const history=x.message('科幻游戏旧约定',userId,{direction:'history'});x.message('科幻游戏私人秘密',userId,{groupId:'private:'+userId});x.message('科幻游戏正式回复',userId,{direction:'out',debug:false,delivered:true});
 const found=x.e.history(groupId,'科幻 游戏',x.c);assert.ok(found.some(m=>m.id===history.id));assert.ok(!JSON.stringify(found).includes('秘密'));assert.ok(!JSON.stringify(found).includes('正式回复'));
});
test('dedup preserves decimal points, signs and punctuation inside facts',()=>{
 assert.notEqual(normalizedFact('预算 1.5 元'),normalizedFact('预算 15 元'));
 assert.notEqual(normalizedFact('气温 -10 度'),normalizedFact('气温 10 度'));
 assert.equal(normalizedFact('喜欢 科幻游戏。'),normalizedFact('喜欢科幻游戏'));
});
test('an expired topic key can produce a new reviewed candidate without reviving the old row',t=>{
 const x=setup(t),old=x.memory('周末约玩游戏',{category:'topic',key:'topic:周末',expiresAt:Date.now()-1});
 const next=x.s.memory({groupId,userId,debug:true,content:old.content,category:'topic',key:old.key,expiresAt:Date.now()+3600000,sourceIds:[x.source.id]},'memory-agent');
 assert.notEqual(next.id,old.id);assert.equal(next.status,'pending');assert.ok(x.s.get(old.id).expiresAt<Date.now());
});
test('scoped retrieval filters before global row caps',t=>{
 const x=setup(t);x.s.db.exec('BEGIN');for(let i=0;i<10001;i++)x.s.create('memory',{groupId:'other',content:'other'});x.s.db.exec('COMMIT');
 const m=x.memory('老事实');assert.equal(x.s.scoped('memory',groupId,()=>true,1)[0].id,m.id);
 // The source was created before all 10001 foreign records.
 x.s.db.exec('BEGIN');for(let i=0;i<10001;i++)x.s.create('message',{groupId:'other',text:'other'});x.s.db.exec('COMMIT');assert.equal(x.s.scoped('message',groupId,()=>true,1)[0].id,x.source.id);
});
test('memory worker stages typed updates and bounded topic drafts using only supplied evidence',async t=>{
 const x=setup(t),m=candidate(x);const ctx=x.e.context(groupId,'gpt',x.c);
 x.p.call=async()=>({operations:[{action:'update',targetId:m.id,targetVersion:m.version,userId,scope:'shared',category:'fact',content:'更喜欢策略游戏',sourceIds:[x.source.id]},
  {action:'add',userId:'',scope:'shared',category:'topic',key:'topic:科幻',content:'群内正在讨论科幻游戏',sourceIds:[x.source.id]},
  {action:'add',userId,scope:'shared',content:'没有依据的资料',sourceIds:['invented']} ]});
 const processed=await x.e.extractMemory(groupId,'gpt',ctx,x.c);assert.deepEqual(processed,[x.source.id]);assert.equal(x.s.list('memory-change').length,1);assert.equal(x.s.get(m.id).content,m.content);
 const topic=x.s.list('memory',r=>r.category==='topic')[0];assert.equal(topic.status,'pending');assert.ok(topic.expiresAt>Date.now());assert.equal(x.s.list('memory').length,2);
});
test('an agent cannot attach another member\'s statement as evidence of a personal fact',async t=>{
 const x=setup(t);x.e.upsertMember(groupId,'22222222','他人');x.message('hello','22222222');
 x.p.call=async()=>({operations:[{action:'add',userId:'22222222',scope:'shared',content:'喜欢科幻游戏',sourceIds:[x.source.id]}]});
 await x.e.extractMemory(groupId,'gpt',x.e.context(groupId,'gpt',x.c),x.c);assert.equal(x.s.list('memory').length,0);
});
test('provider logs final application text separately from reported billable usage',async t=>{
 const x=setup(t),p=new Providers(x.s,{});t.after(()=>p.stop());p.invoke=async()=>({text:'{"ok":true}',usage:{inputTokens:10,cachedInputTokens:100,outputTokens:2,totalTokens:112}});
 const prompt=fitPrompt({system:'system',data:{text:'你好'}},2000);await p.call('observer',groupId,x.c.roleModels.gpt,prompt);
 const row=x.s.list('usage')[0];assert.equal(row.input.chars,promptText(prompt).length);assert.equal(row.input.limitChars,2000);assert.equal(row.tokens.cachedInputTokens,100);assert.equal(row.tokens.totalTokens,112);
 await assert.rejects(p.call('reply',groupId,x.c.roleModels.gpt,{...prompt,system:'x'.repeat(3000)}),/预算/);
});
