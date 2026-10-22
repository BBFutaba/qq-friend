// Synthetic UI acceptance data, separate from the real database and connections.
import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { writeFileSync,mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { Store } from '../src/store.js';
import { ROOT } from '../src/config.js';
import { createApp } from '../src/server.js';
const store=new Store(':memory:');const groupId='30000003',userId='12345678';
store.update('config',{ownerId:'10000001',botId:'20000002',privateAllowlist:['10000001'],groups:[{id:groupId,name:'合成测试群',enabled:true,persona:'gpt'}]});
store.create('member',{groupId,userId,name:'测试群友（合成数据）',profile:'',notes:''},`member:${groupId}:${userId}`);
const source=store.create('message',{groupId,userId,name:'测试群友',text:'我平时喜欢看科幻电影',at:Date.now(),direction:'in'});
store.memory({groupId,userId,content:'喜欢科幻电影',sourceIds:[source.id],debug:true},'memory-agent');
const fact=store.memory({groupId,userId,content:'周末喜欢看电影（合成）',sourceIds:[source.id],debug:true,protected:false,key:'member:weekend'});
store.proposeMemoryChange({...fact,targetId:fact.id,targetVersion:fact.version,action:'update',content:'周末更喜欢看科幻电影（合成）',sourceIds:[source.id],reason:'验收用更新建议'});
store.memory({groupId,userId:'',content:'正在讨论周末电影（合成）',category:'topic',expiresAt:Date.now()+3600000,sourceIds:[source.id],debug:true},'memory-agent');
store.create('usage',{role:'memory',groupId,model:'合成验收数据',status:'completed',startedAt:Date.now(),tokens:null,input:{chars:2400,beforeChars:3100,estimatedTextTokens:1500,limitChars:16000,imageCount:0,blocks:{memories:300,people:100},dropped:{memories:2}}});
const observerRow=(provider,transport,model,[input,cached,output],extra={})=>store.create('usage',{role:'observer',groupId,provider,transport,model,status:'completed',startedAt:Date.now(),durationMs:1200,tokens:{inputTokens:input,cachedInputTokens:cached,cacheWriteInputTokens:0,outputTokens:output,totalTokens:input+output,reasoningOutputTokens:null},input:{chars:input*2,limitChars:16000},...extra});
for(let i=0;i<3;i++)observerRow('deepseek','session','deepseek-flash（合成）',[794+i*100,640+i*96,38],{session:{turn:i+1,fresh:!i,contextTokens:830+i*100}});
observerRow('deepseek','native','deepseek-flash（合成）',[1900,512,40]);observerRow('codex','native','gpt-6.1-sol（合成）',[23000,10450,99]);
const catalogs={codex:[{id:'gpt-6.1-sol',name:'GPT 6.1 Sol（合成目录）',efforts:['low','medium','high']},{id:'gpt-6-luna',name:'GPT 6 Luna（合成目录）',efforts:['low','medium']}],claude:[{id:'claude-fable-5-1',name:'Fable（合成目录）',efforts:['low','medium','high']},{id:'haiku',name:'Haiku（合成目录）',efforts:[]}],deepseek:[{id:'deepseek-fixture',name:'DeepSeek（合成目录）',efforts:['off','low','high','max'],isDefault:true,defaultEffort:'low'}]};
for(const [provider,models] of Object.entries(catalogs))store.create('model-catalog',{provider,models,fetchedAt:Date.now()},`model-catalog:${provider}`);
class Bot extends EventEmitter{constructor(){super();this.state={status:'mock',note:'隔离 UI 测试，无真实 QQ 连接'};}start(){}stop(){}async send(){throw new Error('UI 测试禁止发送');}}
const token=randomBytes(32).toString('hex');mkdirSync(join(ROOT,'verification'),{recursive:true});writeFileSync(join(ROOT,'verification','qa-token.txt'),token);
const app=createApp({store,persistSecrets(){},secrets:{adminToken:token,httpUrl:'',wsUrl:'',claudeSdk:'',deepseekCommand:''},onebot:new Bot(),providers:{stop(){},async catalog(provider){return provider==='claude-api'?[{id:'claude-api-fixture',name:'API 测试模型',efforts:[]}]:catalogs[provider];}}});
await app.start(4892);console.log('Synthetic UI test http://127.0.0.1:4892');
