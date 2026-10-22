// Headless setup of the QQ identity, private-chat whitelist and groups (the same settings as the
// dashboard's 「连接与环境」 page). Run it while the server is stopped; it refuses if the server is up.
//   node scripts/configure.js --show
//   node scripts/configure.js --bot 123456789 --owner 987654321 --allow 555555555 --group 111111111:我们的群
// --group ID[:名称] adds or renames a group (repeatable); --remove-group ID; --persona gpt|claude|deepseek
// sets the persona for groups added in this run; --disable-group ID / --enable-group ID toggle a group.
import { join } from 'node:path';
import { Store } from '../src/store.js';
import { DATA, identityReady } from '../src/config.js';
const args=process.argv.slice(2),all=name=>args.flatMap((a,i)=>a===name&&args[i+1]?String(args[i+1]).split(/[,，]/):[]).map(s=>s.trim()).filter(Boolean),one=name=>all(name).at(-1);
const port=Number(process.env.PORT||4891);
const running=await fetch(`http://127.0.0.1:${port}/healthz`,{signal:AbortSignal.timeout(1500)}).then(r=>r.ok).catch(()=>false);
const store=new Store(join(DATA,'friend.sqlite'));
try{
 let c=store.config();
 if(!args.includes('--show')){
  if(running)throw new Error(`服务正在 ${port} 端口运行。请先停止服务再运行本脚本，或在后台「连接与环境」页面修改。`);
  const persona=one('--persona')||'gpt';if(!c.personas[persona])throw new Error('--persona 只能是 gpt、claude 或 deepseek');
  const next=structuredClone(c);
  if(one('--bot')!==undefined)next.botId=one('--bot');
  if(one('--owner')!==undefined)next.ownerId=one('--owner');
  next.privateAllowlist=[...new Set([next.ownerId,...next.privateAllowlist.filter(x=>x!==c.ownerId),...all('--allow')].filter(Boolean))];
  for(const raw of all('--group')){const [id,...name]=raw.split(':'),label=name.join(':').trim()||id,old=next.groups.find(g=>g.id===id);if(old)old.name=label;else next.groups.push({id,name:label,enabled:true,persona});}
  for(const id of all('--remove-group'))next.groups=next.groups.filter(g=>g.id!==id);
  for(const id of all('--disable-group'))next.groups.forEach(g=>{if(g.id===id)g.enabled=false;});
  for(const id of all('--enable-group'))next.groups.forEach(g=>{if(g.id===id)g.enabled=true;});
  c=store.saveConfig(next);
 }
 console.log(JSON.stringify({botId:c.botId||null,ownerId:c.ownerId||null,privateAllowlist:c.privateAllowlist,groups:c.groups,paused:c.paused,debug:c.debug,identityReady:identityReady(c),serverRunning:running},null,2));
}catch(e){console.error('配置未保存：'+e.message);process.exitCode=1;}
finally{store.close();}
