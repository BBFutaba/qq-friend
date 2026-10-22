// Read production once; compare serialization locally without provider calls or data writes.
import { DatabaseSync } from 'node:sqlite';
import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { DATA, ROOT } from '../src/config.js';
import { Store } from '../src/store.js';
import { Engine } from '../src/engine.js';
import { compactMemories } from '../src/context.js';
const live=new DatabaseSync(join(DATA,'friend.sqlite'),{readOnly:true}),store=new Store(':memory:');
const config=JSON.parse(live.prepare("SELECT body FROM records WHERE id='config'").get().body);
if(!config.groups?.length)throw new Error('请先完成 QQ 账号与群聊设置');
const rows=live.prepare("SELECT * FROM records WHERE kind IN ('memory','member','message')").all();live.close();
const insert=store.db.prepare('INSERT INTO records VALUES(?,?,?,?,?)');for(const r of rows)insert.run(r.id,r.kind,r.body,r.version,r.updated);store.saveConfig(config);
const engine=new Engine(store,{stop(){}},new EventEmitter()),report={at:new Date().toISOString(),productionWrites:false,providerCalls:0,unit:'JavaScript string characters, not tokens/cost',scenarios:[]};
for(const debug of [true,false]){
 const c={...store.config(),debug},g=c.groups[0],ctx=engine.context(g.id,g.persona,c);
 const oldRows=store.scoped('memory',g.id,m=>m.status==='approved'&&m.debug===debug&&(m.scope==='shared'||m.scope==='persona'&&m.persona===g.persona),30).map(m=>({id:m.id,userId:m.userId,scope:m.scope,persona:m.persona,content:m.content.slice(0,2000)}));
 while(oldRows.length&&JSON.stringify(oldRows).length>c.participation.maxContextChars*.25)oldRows.pop();
 const selectedOld=ctx.memories.map(({id,userId,scope,persona,content})=>({id,userId,scope,persona,content}));
 report.scenarios.push({debug,oldCandidateCount:oldRows.length,retrievedCandidateCount:ctx.memories.length,oldMemoryChars:JSON.stringify(oldRows).length,selectedOldEncodingChars:JSON.stringify(selectedOld).length,compactReplyMemoryChars:JSON.stringify(compactMemories(ctx.memories)).length,compactObserverMemoryChars:JSON.stringify(compactMemories(ctx.memories,true)).length,observerSelection:'Not executed; actual reply may choose fewer memories'});
}
engine.stop();store.close();writeFileSync(join(ROOT,'verification','memory-v2-measurement.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
