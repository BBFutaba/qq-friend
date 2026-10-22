export function splitReply(raw,o){
 let text=String(raw||'').trim();if(!text)return [];
 const protectedParts=[];
 text=text.replace(/```[\s\S]*?```|`[^`\n]+`|https?:\/\/[^\s<>，。！？；]+|(?:[A-Za-z]:\\|\\\\)[^\s<>，。！？；]+|(?:\/[\w.-]+){2,}|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|\b\d+(?:\.\d+)+\b/g,m=>`\uE000${protectedParts.push(m)-1}\uE001`);
 const pieces=[];let current='';
 const flush=()=>{let s=current.trim();while(s&&o.stripEnd.includes(s.at(-1)))s=s.slice(0,-1).trimEnd();if(s)pieces.push(s);current='';};
 for(const ch of text){current+=ch;if(o.splitOn.includes(ch))flush();}flush();
 const result=[];
 for(const piece of pieces){let chunk='';for(const token of piece.match(/\uE000\d+\uE001|[^]/gu)||[]){const match=token.match(/^\uE000(\d+)\uE001$/);const value=match?protectedParts[+match[1]]:token;
   if(chunk&&chunk.length+value.length>o.maxPartChars){result.push(chunk.trim());chunk='';}chunk+=value;
  }if(chunk.trim())result.push(chunk.trim());}
 if(result.length>o.maxParts)throw new Error(`回复拆分后超过 ${o.maxParts} 条，需要缩短后重新生成`);
 if(result.some(p=>p.length>4000))throw new Error('单条回复过长');return result;
}
// Models sometimes wrap the requested object in prose or code fences ("Feeds are empty… {"skip":true}").
// Take the first balanced {...} that parses; never accept a bare array or prose.
function jsonObjects(text){const found=[];for(let start=text.indexOf('{');start>=0;start=text.indexOf('{',start+1)){let depth=0,quoted=false,escaped=false;for(let i=start;i<text.length;i++){const ch=text[i];if(quoted){if(escaped)escaped=false;else if(ch==='\\')escaped=true;else if(ch==='"')quoted=false;continue;}if(ch==='"')quoted=true;else if(ch==='{')depth++;else if(ch==='}'&&--depth===0){found.push(text.slice(start,i+1));break;}}if(found.length>=5)break;}return found;}
export function parseJson(text){const raw=String(text??'').trim();
 for(const candidate of [raw.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''),...jsonObjects(raw)]){let value;try{value=JSON.parse(candidate);}catch{continue;}if(value&&typeof value==='object'&&!Array.isArray(value))return value;}
 throw new Error(`模型没有按要求返回 JSON 对象：${raw.replace(/\s+/g,' ').slice(0,80)||'（空回复）'}`);}

// Chat punctuation is a preferred boundary, not a reason to discard an otherwise deliverable answer.
export function splitChatReply(raw,o){try{return splitReply(raw,o);}catch(error){if(!/回复拆分后超过/.test(error.message))throw error;const pieces=splitReply(raw,{...o,maxParts:10000}),packed=[];let part='';for(const piece of pieces){if(part&&part.length+1+piece.length>o.maxPartChars){packed.push(part);part='';}part+=(part?' ':'')+piece;}if(part)packed.push(part);if(packed.length>o.maxParts)throw error;return packed;}}
