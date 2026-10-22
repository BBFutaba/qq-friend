import test from 'node:test';import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';import {Store} from '../src/store.js';import {fixtureStore} from './fixture.js';import {createApp} from '../src/server.js';
test('HTTP auth, CSRF, redaction, edit persistence and browser ingress boundaries',async()=>{class Bot extends EventEmitter{state={status:'mock'};start(){}stop(){}async probe(){return {account:'20000002'};}}
 const s=fixtureStore();const secrets={adminToken:'admin-secret',browserToken:'browser-secret',eventToken:'events',token:'onebot-secret',wsToken:'ws-secret',httpUrl:'http://127.0.0.1:3000',wsUrl:'',claudeSdk:'',deepseekCommand:''};const app=createApp({store:s,secrets,onebot:new Bot(),providers:{stop(){}}});const addr=await app.start(0),base=`http://127.0.0.1:${addr.port}`;
 try{let r=await fetch(base+'/api/state');assert.equal(r.status,401);r=await fetch(base+'/api/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:'admin-secret'})});const cookie=r.headers.get('set-cookie').split(';')[0];assert.equal(r.status,200);
 r=await fetch(base+'/api/state',{headers:{Cookie:cookie}});const text=await r.text();assert.ok(!text.includes('onebot-secret'));assert.ok(!text.includes('browser-secret'));assert.ok(!text.includes('admin-secret'));
 r=await fetch(base+'/api/runtime',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({action:'pause'})});assert.equal(r.status,403);
 r=await fetch(base+'/api/runtime',{method:'POST',headers:{Cookie:cookie,Origin:'https://evil.test','X-QQ-Friend':'1','Content-Type':'application/json'},body:JSON.stringify({action:'pause'})});assert.equal(r.status,403);
 r=await fetch(base+'/api/memory',{method:'POST',headers:{Cookie:cookie,'X-QQ-Friend':'1','Content-Type':'application/json'},body:JSON.stringify({groupId:'30000003',content:'人工记录的称呼'})});assert.equal(r.status,200);assert.equal(s.list('memory').length,1);
 r=await fetch(base+'/api/browser/ingest',{method:'POST',headers:{Authorization:'Bearer browser-secret','Content-Type':'application/json'},body:JSON.stringify({items:[]})});assert.equal(r.status,400);
 s.saveConfig({...s.config(),browser:{...s.config().browser,enabled:true}});
 r=await fetch(base+'/api/browser/ingest',{method:'POST',headers:{Authorization:'Bearer browser-secret','Content-Type':'application/json'},body:JSON.stringify({items:[{url:'https://evil.test',text:'bad'},{url:'https://www.bilibili.com/video/BV123',text:'video',title:'test'}]})});assert.equal((await r.json()).count,1);assert.equal(s.list('feed').length,1);
 r=await fetch(base+'/api/state',{headers:{Authorization:'Bearer browser-secret'}});assert.equal(r.status,401);
 const message=s.create('message',{groupId:'30000003',text:'现在喜欢科幻电影',direction:'in',userId:'10000001'});
 const memory=s.memory({groupId:'30000003',content:'喜欢电影',sourceIds:[message.id],protected:false});
 const change=s.proposeMemoryChange({...memory,targetId:memory.id,targetVersion:memory.version,action:'update',content:'现在喜欢科幻电影',sourceIds:[message.id]});
 r=await fetch(base+'/api/memory/changes');assert.equal(r.status,401);
 r=await fetch(base+'/api/memory/changes',{headers:{Cookie:cookie}});assert.equal((await r.json())[0].id,change.id);
 r=await fetch(base+'/api/memory/sources?id='+change.id,{headers:{Cookie:cookie}});assert.equal((await r.json())[0].id,message.id);
 r=await fetch(base+'/api/memory/changes',{method:'POST',headers:{Cookie:cookie,'X-QQ-Friend':'1','Content-Type':'application/json'},body:JSON.stringify({id:change.id,allow:true,version:change.version})});assert.equal(r.status,200);assert.equal(s.get(memory.id).content,'现在喜欢科幻电影');
 r=await fetch(base+'/api/memory/changes',{method:'POST',headers:{Cookie:cookie,'X-QQ-Friend':'1','Content-Type':'application/json'},body:JSON.stringify({id:change.id,allow:true,version:change.version})});assert.equal(r.status,409);
 r=await fetch(base+'/memory-view.js');assert.equal(r.status,200);assert.match(await r.text(),/memoryPage/);
 }finally{await app.close();}
});
