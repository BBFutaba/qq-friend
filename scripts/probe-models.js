import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Store } from '../src/store.js';
import { DATA, ensureSecrets } from '../src/config.js';
import { Providers } from '../src/providers.js';
const store=new Store(join(DATA,'friend.sqlite'));
const providers=new Providers(store,ensureSecrets());
const reports=[];
try {
 for(const id of process.argv.slice(2).length?process.argv.slice(2):['gpt','claude','deepseek']){
  const spec=store.config().personas[id];const started=Date.now();
  try{const result=await providers.call('connection-test','local',spec,{system:'This is a connectivity test. Do not use any tools. Return exactly one JSON object: {"ok":true}.',data:{test:'json-response'}},AbortSignal.timeout(140000));reports.push({id,model:spec.model,result,elapsedMs:Date.now()-started,passed:result.ok===true});}
  catch(e){reports.push({id,passed:false,error:e.message,elapsedMs:Date.now()-started});}
  console.log(JSON.stringify(reports.at(-1)));writeFileSync(join(DATA,'model-probes.json'),JSON.stringify({at:new Date().toISOString(),reports},null,2));
 }
}finally{providers.stop();store.close();}
