import { EventEmitter } from 'node:events';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA,ensureSecrets } from '../src/config.js';
import { Store } from '../src/store.js';
import { Providers } from '../src/providers.js';
import { Engine } from '../src/engine.js';
const store=new Store(':memory:');store.update('config',{ownerId:'10000001',botId:'20000002',privateAllowlist:['10000001'],groups:[{id:'30000003',name:'合成测试群',enabled:true,persona:'gpt'}]});const c=store.config();c.paused=false;c.personas.gpt.prompt='你是一位友善简洁的普通群友。用一到两句中文自然回复，内容准确，不假装拥有亲身经历。';c.output.delayMs=0;store.saveConfig(c);
class MockBot extends EventEmitter {constructor(){super();this.sent=[];}async send(type,id,text){this.sent.push({type,id,text});return {message_id:'mock-'+this.sent.length};}}
const bot=new MockBot(),providers=new Providers(store,ensureSecrets()),engine=new Engine(store,providers,bot);
const groupId=c.groups[0].id,userId=c.ownerId;
engine.upsertMember(groupId,userId,'验收用合成群友');
store.create('message',{groupId,userId,name:'验收用合成群友',direction:'in',type:'group',externalId:'synthetic-1',at:Date.now(),text:'群友你好，想问你：猫为什么会发出呼噜声？用一句话聊聊就好',mentioned:true,media:[]});
const report={synthetic:true,realQQSends:0};
try{
 await engine.respond(groupId);while(engine.outboxRunning)await new Promise(r=>setTimeout(r,50));
 report.reply={decision:store.list('log',x=>x.type==='decision')[0]?.details.decision,sentToMock:bot.sent.length,parts:bot.sent.map(s=>s.text)};
 const context=engine.context(groupId,'gpt',store.config());await engine.extractMemory(groupId,'gpt',context,store.config(),AbortSignal.timeout(120000));report.memory={candidates:store.list('memory').length};
 const proposal=await engine.createProposal(groupId,{text:'大家最近有看过什么喜欢的科幻电影吗'},AbortSignal.timeout(120000));while(engine.outboxRunning)await new Promise(r=>setTimeout(r,50));
 report.audit={status:store.get(proposal.id).status,reason:proposal.auditReason};
 report.usage=store.list('usage').map(({role,status,model,tokens})=>({role,status,model,tokens}));
 report.passed=report.reply.sentToMock>0&&report.usage.every(u=>u.status==='completed')&&['pending','rejected'].includes(report.audit.status);
}catch(e){report.error=e.message;report.passed=false;}
finally{engine.stop();store.close();}
writeFileSync(join(DATA,'pipeline-verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;
