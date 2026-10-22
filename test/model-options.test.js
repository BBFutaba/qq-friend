import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { modelOptions } from '../public/model-options.js';
import { Store } from '../src/store.js';
import { fixtureStore, CONFIG } from './fixture.js';
import { createApp } from '../src/server.js';

const catalog={models:[{id:'full',name:'Full',efforts:['low','medium','high','ultra']},{id:'small',name:'Small',efforts:['low','medium']},{id:'fixed',name:'Fixed',efforts:[]}]};
test('before detection, current model and effort stay intact',()=>{const p=modelOptions(undefined,'saved','high');assert.equal(p.model,'saved');assert.equal(p.effort,'high');assert.equal(p.canSelectModel,false);assert.equal(p.canSelectEffort,false);});
test('native extra efforts remain available and selected',()=>{const p=modelOptions(catalog,'full','ultra');assert.ok(p.efforts.includes('ultra'));assert.equal(p.effort,'ultra');});
test('switching models replaces an unsupported effort with a supported value',()=>{const p=modelOptions(catalog,'small','ultra');assert.deepEqual(p.efforts,['low','medium']);assert.equal(p.effort,'medium');assert.match(p.note,/ultra/);});
test('model without advertised effort clears previous effort',()=>{const p=modelOptions(catalog,'fixed','high');assert.equal(p.effort,'');assert.equal(p.canSelectEffort,false);assert.deepEqual(p.efforts,[]);});
test('missing configured model is retained rather than silently replaced',()=>{const p=modelOptions(catalog,'unavailable','high');assert.equal(p.model,'unavailable');assert.equal(p.effort,'high');assert.equal(p.models[0].unavailable,true);assert.equal(p.canSelectModel,true);});
test('implicit local model resolves to detected default and native effort',()=>{const p=modelOptions({models:[{id:'local',name:'Local',isDefault:true,efforts:['off','low','high','max'],defaultEffort:'high'}]},'','');assert.equal(p.model,'local');assert.equal(p.effort,'high');});
test('catalog detection is persisted without changing config and failures preserve it',async()=>{
 class Bot extends EventEmitter{state={status:'mock'};start(){}stop(){}}
 const store=fixtureStore();let fail=false;const app=createApp({store,secrets:{adminToken:'test-token'},onebot:new Bot(),providers:{stop(){},async catalog(){if(fail)throw new Error('offline');return catalog.models;}}});const addr=await app.start(0),base=`http://127.0.0.1:${addr.port}`;
 try{let r=await fetch(base+'/api/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:'test-token'})});const headers={Cookie:r.headers.get('set-cookie').split(';')[0],'Content-Type':'application/json','X-QQ-Friend':'1'},revision=store.config().revision;
  r=await fetch(base+'/api/models',{method:'POST',headers,body:JSON.stringify({provider:'codex'})});assert.equal(r.status,200);const detected=await r.json();assert.deepEqual(detected.models,catalog.models);assert.ok(detected.fetchedAt);assert.equal(store.config().revision,revision);
  fail=true;r=await fetch(base+'/api/models',{method:'POST',headers,body:JSON.stringify({provider:'codex'})});assert.equal(r.status,400);
  r=await fetch(base+'/api/state',{headers});const state=await r.json();assert.equal(state.modelCatalogs.length,1);assert.deepEqual(state.modelCatalogs[0].models,catalog.models);assert.equal(state.config.paused,true);
  r=await fetch(base+'/model-options.js');assert.equal(r.status,200);
 }finally{await app.close();}
});
