import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ROOT } from './config.js';
import { fetchMedia } from './media-fetch.js';
import { decodeMedia, mediaReady } from './media-worker.js';
export { allowedMediaUrl } from './media-fetch.js';
const LIMIT={image:5*1024*1024,record:25*1024*1024,video:25*1024*1024};
export class Media {
 // library: the content-addressed image library (src/stickers.js); fetch/decode are injectable for tests.
 constructor(onebot,library=null,{fetch=fetchMedia,decode=decodeMedia}={}){this.onebot=onebot;this.library=library;this.fetch=fetch;this.decode=decode;}
 ready(){return mediaReady();}
 // The pixels of a stored library image, decoded like a fresh one (the 画面图鉴 cataloguer looks at the owner's annotated images).
 async pixels(hash,signal){const b=this.library?.bytes(hash);if(!b)return [];const dir=join(ROOT,'workspace','media');mkdirSync(dir,{recursive:true});const file=join(dir,randomUUID()+'.media');
  try{writeFileSync(file,b.data);return (await this.decode('image',file,signal)).images;}finally{try{unlinkSync(file);}catch{}}}
 async download(m,signal){let url=m.url;if(!url){const r=await this.onebot.action(m.type==='record'?'get_record':m.type==='video'?'get_video':'get_image',{file:m.file,...(m.type==='record'?{out_format:'wav'}:{})});url=r?.url;}
  if(!url)throw new Error('桥接端未返回可下载 URL；不读取工作目录之外的文件');return this.fetch(url,signal,LIMIT[m.type]);}
 // Resolves one image segment to its library record. A known hash, or a QQ file name already verified as the image's
 // MD5, with an interpretation needs no download; otherwise the bytes come from the local cache or the network.
 // Each message counts once per image.
 async image(message,m,signal){if(!this.library)return {row:null,bytes:await this.download(m,signal)};
  const meta={groupId:message.groupId,messageId:message.id,userId:message.userId,at:message.at,subType:m.subType,summary:m.summary};
  const known=(m.hash&&this.library.get(m.hash))||(!m.hash&&this.library.byAlias(m.file))||null;if(known?.description)return {row:this.library.seen(known,meta),bytes:null};
  const bytes=(known&&this.library.bytes(known.hash)?.data)||await this.download(m,signal);
  return {row:this.library.sighting(bytes,{file:m.file,...meta}),bytes};}
 // Known images come back as their saved interpretation instead of pixels; `fresh` lists the hashes whose pixels were loaded.
 async read(message,config,signal){const images=[],notes=[],fresh=[];for(const m of message.media.slice(0,3)){const action=m.type==='record'?'audio':m.type,key=m.type==='image'?'images':action;if(!config.media[key]){notes.push({type:m.type,status:'disabled'});continue;}let file;
  try{let bytes,row=null;
   if(m.type==='image'){({row,bytes}=await this.image(message,m,signal));if(row?.description){notes.push({type:'image',status:'known_image',description:row.description,...(row.repertoire?{sticker:row.repertoire.name}:row.sticker?{sticker:true}:{})});continue;}}
   else bytes=await this.download(m,signal);
   const dir=join(ROOT,'workspace','media');mkdirSync(dir,{recursive:true});file=join(dir,randomUUID()+'.media');writeFileSync(file,bytes);const result=await this.decode(action,file,signal);
   images.push(...result.images);if(row&&result.images.length)fresh.push(row.hash);notes.push({type:m.type,status:result.images.length?'pixels_loaded':'decoded',boundedSeconds:m.type==='image'?undefined:60},...result.notes);
  }catch(e){notes.push({type:m.type,status:'unavailable',reason:e.message});}finally{if(file)try{unlinkSync(file);}catch{}}}
 return {images,notes,fresh};}
}
