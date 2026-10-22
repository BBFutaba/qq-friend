// Real configured providers, synthetic chat, in-memory DB, no OneBot import or network sender.
import { DatabaseSync } from 'node:sqlite';
import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { DATA, ROOT, ensureSecrets } from '../src/config.js';
import { Store } from '../src/store.js';
import { Providers } from '../src/providers.js';
import { Engine } from '../src/engine.js';
const live=new DatabaseSync(join(DATA,'friend.sqlite'),{readOnly:true});
const config=JSON.parse(live.prepare("SELECT body FROM records WHERE id='config'").get().body);live.close();
const store=new Store(':memory:');config.paused=false;config.debug=true;config.participation.maxReplyAgeSeconds=600;store.saveConfig(config);
const bot=new EventEmitter();bot.send=async()=>{throw new Error('Synthetic verification prohibits QQ sends');};
const providers=new Providers(store,ensureSecrets()),engine=new Engine(store,providers,bot),queued=[];engine.enqueue=row=>queued.push(row);
if(!config.groups.length||!config.ownerId)throw new Error('请先完成 QQ 账号与群聊设置');
const groupId=config.groups[0].id,userId=config.ownerId,persona=config.groups[0].persona;
engine.upsertMember(groupId,userId,'验收用合成群友');
const source=store.create('message',{groupId,userId,name:'验收用合成群友',direction:'in',at:Date.now(),text:'我以前最喜欢看科幻电影，现在周末更喜欢玩回合制策略游戏了。'});
const m=store.memory({groupId,userId,debug:true,scope:'shared',key:'member:周末兴趣',content:'周末最喜欢看科幻电影',protected:false,sourceIds:[source.id]});
store.create('message',{groupId,userId,name:'验收用合成群友',direction:'in',at:Date.now()+1,text:'你还记得我现在周末更喜欢什么吗？',mentioned:true,media:[]});
const report={synthetic:true,realQQSends:0,productionWrites:false,startedAt:new Date().toISOString()};
try{
 await engine.extractMemory(groupId,persona,engine.context(groupId,persona,store.config()),store.config(),AbortSignal.timeout(150000));
 report.memory={originalUnchanged:store.get(m.id).content===m.content,changes:store.list('memory-change').map(m=>({action:m.action,status:m.status,sourceCount:m.sourceIds.length})),newCandidates:store.list('memory',r=>r.id!==m.id).map(m=>({category:m.category,status:m.status}))};
 await engine.respond(groupId);
 report.reply={decision:store.list('log',l=>l.type==='decision')[0]?.details.decision,queuedToMock:queued.length};
 report.usage=store.list('usage').map(({role,model,effort,status,tokens,input,error})=>({role,model,effort,status,tokens,input,error}));
 report.passed=report.memory.originalUnchanged&&report.usage.every(u=>u.status==='completed'&&u.input.chars<=u.input.limitChars)&&report.reply.queuedToMock===1&&report.memory.changes.length>0;
}catch(e){report.error=String(e.message);report.passed=false;}
finally{engine.stop();store.close();}
writeFileSync(join(ROOT,'verification','memory-v2-native.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;
