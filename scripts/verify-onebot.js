// Read-only QQ checks against the running server: the logged-in account must be the configured bot,
// and each enabled group's member list must be readable. Members are synchronized only into this local app.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA,ensureSecrets } from '../src/config.js';
const secrets=ensureSecrets(),base=`http://127.0.0.1:${process.env.PORT||4891}`;
const login=await fetch(base+'/api/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:secrets.adminToken}),signal:AbortSignal.timeout(5000)}).catch(()=>null);
if(!login?.ok)throw new Error('管理后台登录失败：请先启动服务（启动QQ群友.cmd 或 npm start）');
const cookie=login.headers.get('set-cookie')?.split(';')[0];
async function api(path,body){const r=await fetch(base+'/api/'+path,{method:body?'POST':'GET',headers:{Cookie:cookie,'Content-Type':'application/json','X-QQ-Friend':'1'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});const data=await r.json();if(!r.ok)throw new Error(data.error);return data;}
const report={at:new Date().toISOString(),realQQSends:0};
try{
 const before=await api('state');report.paused=before.config.paused;report.debug=before.config.debug;
 report.identity=await api('probe',{});
 const groups=before.config.groups.filter(g=>g.enabled);if(!groups.length)throw new Error('没有启用的群');
 report.groups=[];for(const g of groups)report.groups.push({id:g.id,name:g.name,...await api('members/sync',{groupId:g.id})});
 const after=await api('state');report.connection=after.connection;
 report.passed=report.identity.account===before.config.botId&&report.groups.every(g=>g.count>0)&&report.connection.status==='connected';
}catch(e){report.passed=false;report.error=e.message;}
finally{await api('logout',{}).catch(()=>{});}
writeFileSync(join(DATA,'onebot-verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;
