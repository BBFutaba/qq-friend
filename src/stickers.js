// Content-addressed image library. Each distinct image (sha256 of its bytes) is analysed once; repeats reuse the
// saved interpretation, which the owner can rewrite. Owner-confirmed stickers can join the bot's own repertoire.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { DATA } from './config.js';
const MIME={png:'image/png',jpg:'image/jpeg',gif:'image/gif',webp:'image/webp',bmp:'image/bmp'},EXT=Object.fromEntries(Object.entries(MIME).map(([k,v])=>[v,k]));
export const LIMITS={files:400,bytes:300*1024*1024,description:2000,usage:500,name:40,repertoire:60};
export const mediaHash=bytes=>createHash('sha256').update(bytes).digest('hex');
export const mediaId=hash=>`media:${hash}`;
const validHash=h=>typeof h==='string'&&/^[a-f0-9]{64}$/.test(h);
export function sniffImage(b){if(!b||b.length<12)return '';const hex=b.subarray(0,4).toString('hex');
 return hex==='89504e47'?MIME.png:hex.startsWith('ffd8ff')?MIME.jpg:hex==='47494638'?MIME.gif:hex.startsWith('424d')?MIME.bmp:hex==='52494646'&&b.subarray(8,12).toString('ascii')==='WEBP'?MIME.webp:'';}
// QQ marks reusable emoji images ("[动画表情]", sub_type 1) in the segment; only a hint, the owner confirms.
const stickerHint=(subType,summary)=>Number(subType)===1||/表情/.test(String(summary||''));
// QQ usually names an image after the MD5 of its bytes ("<32 hex>.jpg"). Such a name is trusted as an alias only once
// it has been checked against the bytes, after qq-bridge's id-based sticker lookup; a reused or random name never is.
const md5Name=file=>{const name=String(file||'').split(/[\\/]/).pop().split('.')[0].replace(/[{}]/g,'').toLowerCase();return /^[0-9a-f]{32}$/.test(name)?name:'';};
export class MediaLibrary {
 constructor(store,dir=join(DATA,'media-cache')){this.store=store;this.dir=dir;}
 get(hash){return validHash(hash)?this.store.get(mediaId(hash)):null;}
 // A known image by its verified QQ file name, without downloading it.
 byAlias(file){const name=md5Name(file);return name?this.store.list('media',m=>m.alias===name,1)[0]||null:null;}
 // Counts one more sighting; arrival indexing and description can both read the same message, which counts once.
 seen(row,{groupId='',messageId='',userId='',at=Date.now(),subType,summary}={}){if(messageId&&row.messageIds.includes(messageId))return row;
  return this.store.update(row.id,{seenCount:row.seenCount+1,lastSeen:at,groups:[...new Set([...row.groups,groupId].filter(Boolean))].slice(-10),senders:[...new Set([...row.senders,userId].filter(Boolean))].slice(-50),messageIds:[...row.messageIds,messageId].filter(Boolean).slice(-8),likelySticker:row.likelySticker||stickerHint(subType,summary)});}
 // Every incoming image passes here. A returned description means the model need not see the pixels again.
 sighting(bytes,{type='image',file='',groupId='',messageId='',userId='',at=Date.now(),subType,summary}={}){
  const hash=mediaHash(bytes),id=mediaId(hash),old=this.store.get(id),mime=sniffImage(bytes),named=md5Name(file),alias=named&&named===createHash('md5').update(bytes).digest('hex')?named:'';
  let row=old?this.seen(old,{groupId,messageId,userId,at,subType,summary})
   :this.store.create('media',{hash,type,mime,size:bytes.length,file:String(file).slice(0,200),alias,description:'',source:'',model:'',analyzedAt:null,editedAt:null,seenCount:1,firstSeen:at,lastSeen:at,groups:[groupId].filter(Boolean),senders:[userId].filter(Boolean),messageIds:[messageId].filter(Boolean),likelySticker:stickerHint(subType,summary),sticker:false,repertoire:null,sentCount:0,stored:false},id);
  if(alias&&!row.alias)row=this.store.update(id,{alias});
  if(!row.stored&&mime){mkdirSync(this.dir,{recursive:true});writeFileSync(this.path(hash,mime),bytes);row=this.store.update(id,{stored:true});this.evict();}
  return row;}
 path(hash,mime){return join(this.dir,`${hash}.${EXT[mime]||'bin'}`);}
 // Model output never replaces an interpretation the owner wrote.
 analysed(hash,{description,model=''}){const row=this.get(hash);if(!row||row.source==='owner'||typeof description!=='string'||!description.trim())return row;return this.store.update(row.id,{description:description.trim().slice(0,LIMITS.description),source:'model',model:String(model).slice(0,80),analyzedAt:Date.now()});}
 edit(hash,patch,version){const row=this.get(hash);if(!row)throw Object.assign(new Error('图片记录不存在'),{status:404});if(!Number.isInteger(version))throw new Error('请提供版本后编辑');const next={};
  if(patch.description!==undefined){if(typeof patch.description!=='string'||patch.description.length>LIMITS.description)throw new Error(`解读最多 ${LIMITS.description} 字`);const text=patch.description.trim();Object.assign(next,text?{description:text,source:'owner',editedAt:Date.now()}:{description:'',source:'',editedAt:Date.now()});}
  if(patch.sticker!==undefined){if(typeof patch.sticker!=='boolean')throw new Error('表情包标记无效');next.sticker=patch.sticker;if(!patch.sticker)next.repertoire=null;}
  if(patch.repertoire!==undefined){const r=patch.repertoire;
   if(r===null)next.repertoire=null;
   else{if(!r||typeof r.usage!=='string'||!r.usage.trim()||r.usage.length>LIMITS.usage||typeof r.name!=='string'||r.name.length>LIMITS.name||typeof r.enabled!=='boolean')throw new Error(`使用场景必填（最多 ${LIMITS.usage} 字），名称最多 ${LIMITS.name} 字`);
    if(!(next.sticker??row.sticker))throw new Error('先标记为表情包，再加入机器人表情库');if(!row.stored||!existsSync(this.path(hash,row.mime)))throw new Error('原图已不在本地缓存，等它再次出现后才能加入表情库');
    if(!row.repertoire&&this.repertoire(true).length>=LIMITS.repertoire)throw new Error(`机器人表情库最多 ${LIMITS.repertoire} 个`);
    next.repertoire={name:r.name.trim(),usage:r.usage.trim(),enabled:r.enabled,addedAt:row.repertoire?.addedAt||Date.now()};}}
  return this.store.update(row.id,next,version);}
 markStickers(hashes,sticker){if(!Array.isArray(hashes)||hashes.length>200||typeof sticker!=='boolean')throw new Error('批量标记格式无效');let changed=0;for(const h of hashes){const row=this.get(h);if(!row||row.sticker===sticker)continue;this.store.update(row.id,sticker?{sticker:true}:{sticker:false,repertoire:null});changed++;}return {changed};}
 forget(hash){const row=this.get(hash);if(!row)throw Object.assign(new Error('图片记录不存在'),{status:404});try{unlinkSync(this.path(hash,row.mime));}catch{}this.store.remove(row.id);return {ok:true};}
 list(){return this.store.list('media',()=>true,5000).map(({messageIds,senders,...m})=>({...m,senderCount:senders.length}));}
 // Entries the reply model may choose from; includeDisabled is for the size limit check.
 repertoire(includeDisabled=false){return this.store.list('media',m=>m.repertoire&&(includeDisabled||m.repertoire.enabled)&&m.stored,1000);}
 bytes(hash){const row=this.get(hash);if(!row?.stored)return null;try{return {mime:row.mime,data:readFileSync(this.path(hash,row.mime))};}catch{return null;}}
 sent(hash){const row=this.get(hash);if(row)this.store.update(row.id,{sentCount:(row.sentCount||0)+1,lastSentAt:Date.now()});}
 // Keep stickers; drop the bytes of the least recently seen other images beyond the cap (their analysis stays).
 evict(){const stored=this.store.list('media',m=>m.stored,10000);let total=stored.reduce((n,m)=>n+m.size,0),count=stored.length;if(count<=LIMITS.files&&total<=LIMITS.bytes)return;
  for(const m of stored.filter(m=>!m.sticker&&!m.repertoire).sort((a,b)=>a.lastSeen-b.lastSeen)){if(count<=LIMITS.files&&total<=LIMITS.bytes)break;try{unlinkSync(this.path(m.hash,m.mime));}catch{}this.store.update(m.id,{stored:false});count--;total-=m.size;}}
}
// Short codes keep hashes out of the prompt; only codes from this menu are accepted back.
export function stickerMenu(entries,limit=30){const menu=entries.slice().sort((a,b)=>(b.sentCount||0)-(a.sentCount||0)||a.repertoire.addedAt-b.repertoire.addedAt).slice(0,limit).map((m,i)=>({id:`s${i+1}`,hash:m.hash,name:m.repertoire.name,usage:m.repertoire.usage,meaning:(m.description||'').slice(0,200)}));
 return {menu:menu.map(({hash,...x})=>x),resolve:code=>menu.find(m=>m.id===code)?.hash||null};}
