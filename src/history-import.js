// Historical sources are retained for review, never injected as fresh events.
export function archiveInitialMemories(store,{manifest,messages,memories,agent,assessment}) {
 const groupId=manifest.groupId;
 if(!store.config().groups.some(g=>g.id===groupId)||manifest.sourceKind!=='local-qq-database'||!/^[a-f0-9]{64}$/.test(manifest.exportSha256))throw new Error('历史来源范围无效');
 const sourceMap=new Map(messages.map(m=>[m.id,m]));
 if(sourceMap.size!==messages.length||messages.some(m=>m.groupId!==groupId||typeof m.text!=='string'||!Number.isFinite(m.at)))throw new Error('历史原文存在重复或跨群记录');
 for(const m of memories){
  if(typeof m.content!=='string'||!m.content.trim()||m.content.length>6000||typeof m.userId!=='string'||m.userId&&!/^\d{5,15}$/.test(m.userId)||!Array.isArray(m.sourceIds)||!m.sourceIds.length||m.sourceIds.length>20||m.sourceIds.some(id=>!sourceMap.has(id)))throw new Error('历史记忆缺少有效证据');
  if(m.userId&&!m.sourceIds.some(id=>sourceMap.get(id).userId===m.userId))throw new Error('个人记忆没有本人发言来源');
 }
 const importId=`history-import:${manifest.exportSha256}`;
 const existing=store.get(importId);if(existing)return {alreadyImported:true,...existing};
 const memoryIds=[],sourceIds=new Set(memories.flatMap(m=>m.sourceIds));
 store.db.exec('BEGIN IMMEDIATE');
 try {
  for(const id of sourceIds){const m=sourceMap.get(id),old=store.get(id);
   if(old){if(old.kind!=='message'||old.groupId!==groupId||old.text!==m.text||old.userId!==m.userId)throw new Error('历史来源 ID 冲突');continue;}
   store.create('message',{...m,direction:'history',archived:true,sourceKind:manifest.sourceKind,importId,media:[]},id);
   store.db.prepare('UPDATE records SET updated=? WHERE id=?').run(m.at,id);
  }
  for(const m of memories){
   if(m.userId){const memberId=`member:${groupId}:${m.userId}`;
    if(!store.get(memberId)){const source=m.sourceIds.map(id=>sourceMap.get(id)).find(x=>x.userId===m.userId);store.create('member',{groupId,userId:m.userId,name:source.name||m.userId,profile:'',notes:'',lastSeen:source.at,historical:true},memberId);}
   }
   const row=store.memory({groupId,userId:m.userId,scope:'shared',content:m.content,sourceIds:m.sourceIds,debug:false},'memory-agent');
   store.update(row.id,{importId,sourceKind:manifest.sourceKind,agent,confidence:m.confidence||'review',historical:true});memoryIds.push(row.id);
  }
  const report=store.create('history-import',{manifest,agent,assessment,memoryIds,sourceIds:[...sourceIds],status:'pending-review',createdAt:Date.now()},importId);
  store.log('history-import',`历史整理完成：${memoryIds.length} 条初始候选记忆，待审核`,{groupId,importId,memories:memoryIds.length});
  store.db.exec('COMMIT');return report;
 } catch(e){store.db.exec('ROLLBACK');throw e;}
}
