import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { fixtureStore, CONFIG } from './fixture.js';
import { archiveInitialMemories } from '../src/history-import.js';
const groupId='30000003',userId='12345678';
function fixture(){return {manifest:{groupId,sourceKind:'local-qq-database',exportSha256:'a'.repeat(64)},messages:[{id:'history:test',groupId,userId,name:'历史测试群友',text:'我喜欢科幻小说',at:Date.now()-86400000}],memories:[{userId,content:'曾表达喜欢科幻小说',sourceIds:['history:test']}],agent:{provider:'claude',model:'fixture'},assessment:{usefulness:'fixture'}};}
test('history archives pending memories without triggering live chat, changing profiles or repeating import',()=>{
 const store=fixtureStore();try{const c=store.config();store.create('member',{groupId,userId,name:'手工名字',profile:'手工画像',notes:'手工备注'},`member:${groupId}:${userId}`);const report=archiveInitialMemories(store,fixture());assert.equal(report.memoryIds.length,1);const memory=store.get(report.memoryIds[0]);assert.equal(memory.status,'pending');assert.equal(memory.debug,false);assert.equal(memory.scope,'shared');const source=store.get('history:test');assert.equal(source.direction,'history');assert.equal(source.archived,true);assert.equal(store.list('message',m=>m.direction==='in').length,0);assert.equal(store.list('outbox').length,0);assert.equal(store.get(`member:${groupId}:${userId}`).profile,'手工画像');assert.equal(store.config().revision,c.revision);assert.equal(archiveInitialMemories(store,fixture()).alreadyImported,true);assert.equal(store.list('memory').length,1);}finally{store.close();}
});
test('history import rejects cross-group evidence and unsupported personal claims atomically',()=>{
 const store=fixtureStore();try{let f=fixture();f.messages[0].groupId='999999999';assert.throws(()=>archiveInitialMemories(store,f),/跨群/);f=fixture();f.memories[0].sourceIds=['missing'];assert.throws(()=>archiveInitialMemories(store,f),/证据/);f=fixture();f.memories[0].userId='87654321';assert.throws(()=>archiveInitialMemories(store,f),/本人/);assert.equal(store.list('memory').length,0);assert.equal(store.list('message').length,0);}finally{store.close();}
});
test('history import rolls back if an existing source id belongs to another record',()=>{
 const store=fixtureStore();try{store.create('message',{groupId:'999999999',userId,text:'other'},'history:test');assert.throws(()=>archiveInitialMemories(store,fixture()),/冲突/);assert.equal(store.list('memory').length,0);assert.equal(store.list('history-import').length,0);}finally{store.close();}
});
