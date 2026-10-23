// Link-share cards (QQ ark `json`, `share`) become one bracketed line of message text, so every model, the memory
// worker and the dashboard see what was shared, with no network request. Every field comes from the sender's client:
// control characters and brackets are replaced (a title cannot fake [图片], an @ or a new prompt line, as qq-bridge
// guards its media summaries), lengths are capped, and Bilibili tracking query strings are dropped. Merged forwards and
// files get a placeholder instead of an empty message. Card fields naming the sharer (host uin / nick) are never read.
export const clean=(v,max)=>{const s=String(v??'').replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g,' ').replace(/\[/g,'［').replace(/\]/g,'］').replace(/\s+/g,' ').trim();return s.length>max?s.slice(0,max-1)+'…':s;};
const TRACKED=/(^|\.)(b23\.tv|bilibili\.com|bili2233\.cn)$/;
export function cleanUrl(raw){let u;try{u=new URL(String(raw??'').trim());}catch{return '';}if(!['http:','https:'].includes(u.protocol)||u.username||u.password)return '';
 if(TRACKED.test(u.hostname))u.search='';u.hash='';const href=(u.href.length<=200?u.href:(u.origin+u.pathname).slice(0,200)).replace(/\[/g,'%5B').replace(/\]/g,'%5D');return href;}
// Mini-app cards (detail_1: title is the app, desc the content, qqdocurl the link) and news cards (news / music:
// tag is the source, title and desc the content, jumpUrl the link); anything else falls back to the card's prompt.
export function arkCard(raw){let j;try{j=JSON.parse(String(raw??'').slice(0,32000));}catch{return null;}if(!j||typeof j!=='object')return null;
 const app=String(j.app||''),objects=Object.values(j.meta&&typeof j.meta==='object'?j.meta:{}).filter(x=>x&&typeof x==='object'&&!Array.isArray(x));
 if(app==='com.tencent.multimsg'){const d=objects[0]||{};return {kind:'forward',title:clean(d.source,30),desc:clean(d.summary,40)};}
 const d=objects.find(x=>x.qqdocurl||x.jumpUrl||x.title||x.desc)||{},mini=!!d.qqdocurl||/miniapp/i.test(app);
 const card={kind:'share',source:clean(mini?d.title:d.tag,20),title:clean(mini?d.desc:d.title,100),desc:clean(mini?'':d.desc,140),url:cleanUrl(d.qqdocurl||d.jumpUrl)};
 if(card.title||card.desc)return card;const prompt=clean(j.prompt,60);return prompt?{kind:'other',title:prompt}:null;}
export function cardText(s){const d=s?.data&&typeof s.data==='object'?s.data:{};let c=null;
 if(s?.type==='json')c=arkCard(d.data);
 else if(s?.type==='share')c={kind:'share',source:'',title:clean(d.title,100),desc:clean(d.content,140),url:cleanUrl(d.url)};
 else if(s?.type==='forward')c={kind:'forward'};
 else if(s?.type==='file')return `[文件 ${clean(d.name||d.file,60)||'未命名'}]`;
 if(!c)return '';
 if(c.kind==='forward')return `[聊天记录${c.title||c.desc?'：'+[c.title,c.desc].filter(Boolean).join(' · '):''}]`;
 if(c.kind==='other')return `[卡片：${c.title}]`;
 if(!c.title&&!c.desc&&!c.url)return '';
 return `[分享${c.source?' '+c.source:''}：${c.title||c.desc}${c.title&&c.desc&&c.desc!==c.title?' — '+c.desc:''}${c.url?' '+c.url:''}]`;}
