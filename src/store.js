import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DEFAULTS, assertConfig } from './config.js';
import { memoryOptions, memoryFields, protectedMemory, sameMemoryScope, normalizedFact, expiredMemory, crossGroupMemory } from './memory-policy.js';
import { wakeOptions } from './wake.js';
export class Store {
 constructor(file){
  if(file!==':memory:')mkdirSync(dirname(file),{recursive:true});
  this.db=new DatabaseSync(file);this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
   CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY,kind TEXT NOT NULL,body TEXT NOT NULL,version INTEGER NOT NULL,updated INTEGER NOT NULL);
   CREATE INDEX IF NOT EXISTS records_kind ON records(kind,updated);
   CREATE INDEX IF NOT EXISTS records_group ON records(kind,json_extract(body,'$.groupId'),updated);
   CREATE TABLE IF NOT EXISTS dedup(key TEXT PRIMARY KEY,created INTEGER NOT NULL);`);
  if(!this.get('config'))this.create('config',structuredClone(DEFAULTS),'config');
 }
 decode(r){return r?{...JSON.parse(r.body),id:r.id,kind:r.kind,version:r.version,updated:r.updated}:null;}
 get(id){return this.decode(this.db.prepare('SELECT * FROM records WHERE id=?').get(String(id)));}
 list(kind,filter=()=>true,limit=300){return this.db.prepare('SELECT * FROM records WHERE kind=? ORDER BY updated DESC,rowid DESC LIMIT 10000').all(kind).map(r=>this.decode(r)).filter(filter).slice(0,limit);}
 // Model calls (usage rows plus extra API tool rounds) since a time, counted in SQLite: the budget and the dashboard
 // need the true total, not a capped list. A row's `updated` is never before its start, so the index narrows first.
 callsSince(since){const n=(kind,field)=>this.db.prepare(`SELECT count(*) n FROM records WHERE kind=? AND updated>? AND json_extract(body,'$.${field}')>?`).get(kind,since,since).n;return n('usage','startedAt')+n('api-round','at');}
 // Filter by group in SQLite, before the limit. Old relevant rows cannot be displaced by other groups.
 scoped(kind,groupId,filter=()=>true,limit=300){const rows=[];for(const raw of this.db.prepare("SELECT * FROM records WHERE kind=? AND json_extract(body,'$.groupId')=? ORDER BY updated DESC,rowid DESC").iterate(kind,groupId)){const row=this.decode(raw);if(filter(row))rows.push(row);if(rows.length>=limit)break;}return rows;}
 create(kind,body,id=randomUUID()){this.db.prepare('INSERT INTO records VALUES(?,?,?,1,?)').run(id,kind,JSON.stringify(body),Date.now());return this.get(id);}
 update(id,patch,version,touched=Date.now()){const old=this.get(id);if(!old)throw Object.assign(new Error('记录不存在'),{status:404});if(version!==undefined&&old.version!==version)throw Object.assign(new Error('内容已改变，请刷新后再编辑'),{status:409});
  const {id:_id,kind,version:v,updated,...body}={...old,...patch};
  const result=this.db.prepare('UPDATE records SET body=?,version=version+1,updated=? WHERE id=? AND version=?').run(JSON.stringify(body),touched,id,old.version);
  if(!result.changes)throw Object.assign(new Error('并发更新冲突'),{status:409});return this.get(id);
 }
 claim(id,from,to){const old=this.get(id);if(!old||old.status!==from)return null;return this.update(id,{status:to},old.version);}
 remove(id){this.db.prepare('DELETE FROM records WHERE id=?').run(id);}
 seen(key){return !this.db.prepare('INSERT OR IGNORE INTO dedup VALUES(?,?)').run(key,Date.now()).changes;}
 // Sections added after an install was created (memory, wake) are filled in from their defaults.
 config(){const {id,kind,version,updated,...c}=this.get('config');return {...c,memory:memoryOptions(c),wake:wakeOptions(c)};}
 saveConfig(c){const old=this.config();assertConfig(c);const next={...c,revision:old.revision+1};this.update('config',next);this.log('config','后台更新配置',{revision:next.revision});return next;}
 log(type,message,details={}){return this.create('log',{type,message,details});}
 memory(input,actor='owner'){
  const {groupId,userId='',scope='shared',persona='',content,sourceIds=[],debug=false}=input;
  if(typeof content!=='string'||!content.trim()||content.length>6000||!['shared','persona','private'].includes(scope))throw new Error('记忆内容或范围无效');
  if(typeof debug!=='boolean'||typeof userId!=='string'||!Array.isArray(sourceIds)||sourceIds.length>20||sourceIds.some(id=>{const m=this.get(id);return m?.kind!=='message'||m.groupId!==groupId;}))throw new Error('记忆来源或分支无效');
  if(scope==='persona'&&!['gpt','claude','deepseek'].includes(persona))throw new Error('请选择记忆所属人格');
  if(scope==='private'&&userId!==this.config().ownerId)throw new Error('私人兴趣仅属于审批人');
  if(!this.config().groups.some(g=>g.id===groupId)&&groupId!==`private:${this.config().ownerId}`)throw new Error('记忆所属群未启用');
  if(actor!=='owner'&&(!sourceIds.length||sourceIds.some(id=>{const m=this.get(id);return m.direction==='out'&&(m.debug!==debug||!m.delivered);})))throw new Error('agent 记忆必须有同分支的消息来源');
  const fields=memoryFields(input,{scope,userId});
  if(actor!=='owner'){
   const scopeRow={groupId,userId,scope,persona:scope==='persona'?persona:'',debug,category:fields.category},same=m=>sameMemoryScope(m,scopeRow)&&['pending','approved'].includes(m.status)&&!expiredMemory(m)&&(normalizedFact(m.content)===normalizedFact(content)||(fields.key&&m.key===fields.key));
   // A person's fact is one memory across groups, so the same fact learned again elsewhere is the same row.
   const duplicate=crossGroupMemory(scopeRow)?this.list('memory',same,1)[0]:this.scoped('memory',groupId,same,1)[0];
   if(duplicate)return duplicate;
  }
  const item=this.create('memory',{groupId,userId,scope,persona:scope==='persona'?persona:'',content:content.trim(),sourceIds:[...new Set(sourceIds)],debug,...fields,protected:actor==='owner'?(input.protected??true):false,status:actor==='owner'?'approved':'pending',actor});
  this.create('revision',{targetId:item.id,actor,before:null,after:item});return item;
 }
 editMemory(id,patch,version){const old=this.get(id);if(old?.kind!=='memory')throw new Error('记忆不存在');
  if(typeof patch.content!=='string'||!patch.content.trim()||patch.content.length>6000||!['approved','pending','rejected'].includes(patch.status))throw new Error('记忆更新无效');
  if(!Number.isInteger(version))throw new Error('请提供记忆版本后编辑');
  const fields=memoryFields(patch,old);
  const changed=patch.content.trim()!==old.content||fields.category!==(old.category||memoryFields({},old).category)||fields.key!==(old.key||'')||fields.expiresAt!==(old.expiresAt??null);
  const next=this.update(id,{content:patch.content.trim(),status:patch.status,...fields,protected:changed||patch.protected===true||(patch.protected===undefined&&protectedMemory(old)),actor:'owner'},version);
  this.create('revision',{targetId:id,actor:'owner',before:old,after:next});return next;
 }
 proposeMemoryChange(input,actor='memory-agent'){
  const target=this.get(input.targetId);
  if(target?.kind!=='memory'||target.status!=='approved'||protectedMemory(target))throw new Error('目标记忆不存在、未通过或受人工保护');
  if(!sameMemoryScope(target,input)||target.version!==input.targetVersion)throw new Error('记忆范围或目标版本已改变');
  if(!['update','expire'].includes(input.action))throw new Error('不支持的记忆操作');
  if(!Array.isArray(input.sourceIds)||!input.sourceIds.length||input.sourceIds.length>20||input.sourceIds.some(id=>{const m=this.get(id);return m?.kind!=='message'||m.groupId!==(crossGroupMemory(target)?input.groupId:target.groupId)||(m.direction==='out'&&(m.debug!==target.debug||!m.delivered));}))throw new Error('更新必须有同群同分支来源');
  const content=input.action==='expire'?target.content:input.content;
  if(typeof content!=='string'||!content.trim()||content.length>6000)throw new Error('更新内容无效');
  const fields=memoryFields(input,target);
  const existing=this.scoped('memory-change',target.groupId,m=>m.status==='pending'&&m.targetId===target.id&&m.targetVersion===target.version&&m.action===input.action&&normalizedFact(m.content)===normalizedFact(content),1)[0];
  if(existing)return existing;
  return this.create('memory-change',{targetId:target.id,targetVersion:target.version,groupId:target.groupId,userId:target.userId,scope:target.scope,persona:target.persona,debug:target.debug,action:input.action,...(input.groupId!==target.groupId?{sourceGroupId:input.groupId}:{}),content:content.trim(),beforeContent:target.content,...fields,sourceIds:[...new Set(input.sourceIds)],reason:String(input.reason||'').slice(0,400),status:'pending',actor});
 }
 reviewMemoryChange(id,allow,version){
  const change=this.get(id);if(change?.kind!=='memory-change'||change.status!=='pending'||change.version!==version)throw Object.assign(new Error('候选已改变，请刷新'),{status:409});
  if(!allow)return this.update(id,{status:'rejected',reviewedAt:Date.now()},version);
  this.db.exec('BEGIN IMMEDIATE');
  try{
   const old=this.get(change.targetId);
   if(old?.kind!=='memory'||old.status!=='approved'||old.version!==change.targetVersion||protectedMemory(old)||!sameMemoryScope(old,change))throw Object.assign(new Error('原记忆已编辑、受保护或版本过期，请重新整理；未覆盖人工内容'),{status:409});
   const fields=memoryFields(change,old);
   const sourceIds=[...new Set([...change.sourceIds,...old.sourceIds])].slice(0,20);
   const next=this.update(old.id,{...fields,content:change.content,sourceIds,expiresAt:change.action==='expire'?Date.now():fields.expiresAt,actor:'memory-agent',lastApprovedBy:'owner'},old.version);
   this.create('revision',{targetId:old.id,actor:'owner',changeId:id,before:old,after:next});
   const result=this.update(id,{status:'applied',reviewedAt:Date.now(),appliedVersion:next.version},version);
   this.db.exec('COMMIT');return result;
  }catch(e){this.db.exec('ROLLBACK');throw e;}
 }
 recover(){for(const r of this.list('outbox',r=>['queued','sending'].includes(r.status)))this.update(r.id,{status:r.status==='sending'?'unknown':'cancelled',note:'程序重启，未自动重发'});for(const r of this.list('proposal',r=>['dispatching','auditing'].includes(r.status)))this.update(r.id,{status:'expired',note:'程序重启，需要重新审核'});}
 close(){this.db.close();}
}
