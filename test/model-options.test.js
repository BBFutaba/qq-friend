import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { modelOptions } from '../public/model-options.js';
import { Store } from '../src/store.js';
import { fixtureStore, CONFIG } from './fixture.js';
import { createApp } from '../src/server.js';
import { DEFAULTS, DEFAULT_OBSERVER, assertConfig } from '../src/config.js';
import { backgroundSpecs, saveBackgroundSpecs } from '../public/model-options.js';

test('background roles preserve legacy choices and save independent models across all providers',()=>{
 const c=structuredClone(CONFIG);c.roles={observer:'fable',memory:'fable',auditor:'gpt',discovery:'gpt',perception:'perception'};
 const original=structuredClone(c),specs=backgroundSpecs(c);specs.observer={...DEFAULT_OBSERVER};specs.memory={provider:'deepseek',model:'native-model-id',effort:'off'};specs.discovery={provider:'codex',model:'gpt-6-luna',effort:'high'};
 saveBackgroundSpecs(c,specs);assert.doesNotThrow(()=>assertConfig(c));assert.deepEqual(backgroundSpecs(c),specs);assert.deepEqual(c.roleModels.fable,original.roleModels.fable);assert.deepEqual(c.personas,original.personas);assert.equal(c.paused,true);
 specs.observer.effort='high';assert.equal(backgroundSpecs(c).observer.effort,'low');assert.equal(backgroundSpecs(c).auditor.effort,'medium');
 c.roleModels[c.roles.memory].provider='arbitrary';assert.throws(()=>assertConfig(c),/后台模型/);
});
test('画面识别 is its own role: older configs get the model images used before, and it must be able to see',()=>{
 const s=new Store(':memory:'),legacy=(observer)=>{s.update('config',{roles:{observer:'role:observer',memory:'gpt',auditor:'gpt',discovery:'gpt'},roleModels:{...structuredClone(DEFAULTS.roleModels),'role:observer':observer}});return s.config();};
 try{
  assert.deepEqual(backgroundSpecs(legacy({provider:'deepseek',model:'flash',effort:'off'})).perception,DEFAULT_OBSERVER,'text-only observer: images went to GPT 6.1 Sol low');
  assert.deepEqual(backgroundSpecs(legacy({provider:'codex',model:'gpt-6-luna',effort:'medium'})).perception,{provider:'codex',model:'gpt-6-luna',effort:'medium'},'otherwise the observer saw them');
  const c=s.config();c.roleModels['role:perception']={provider:'claude',model:'opus',effort:'low',transport:'native',apiPreset:'default'};c.roles.perception='role:perception';s.saveConfig(c);c.roleModels['role:observer']={provider:'deepseek',model:'flash',effort:'off'};s.saveConfig(c);
  assert.equal(s.config().roleModels[s.config().roles.perception].provider,'claude','a saved choice is kept');
  const bad=structuredClone(CONFIG);bad.roleModels.perception={provider:'deepseek',model:'flash',effort:'off'};assert.throws(()=>assertConfig(bad),/画面识别需要能看图的模型/);
 }finally{s.close();}});
test('fresh observer uses GPT 6.1 Sol low without lowering other roles',()=>{assert.deepEqual(backgroundSpecs(DEFAULTS).observer,DEFAULT_OBSERVER);assert.equal(backgroundSpecs(DEFAULTS).memory.effort,'medium');});

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
