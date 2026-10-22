// Read-only check of how the bot's replies compare with how people type in the same groups: lengths, short reactions and
// questions, from the local database. Prints counts and percentages only, never message text.
//   node scripts/voice-stats.js [--since 2026-10-22T12:00] [--persona claude]
// Target after the pace change: median ≤ 15 characters and at least 30% of replies within 10.
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { DATA } from '../src/config.js';
const arg=name=>{const i=process.argv.indexOf(name);return i>0?process.argv[i+1]:undefined;};
const since=arg('--since')?Date.parse(arg('--since')):0,persona=arg('--persona');if(Number.isNaN(since))throw new Error('--since 需要日期时间，例如 2026-10-22T12:00');
const db=new DatabaseSync(join(DATA,'friend.sqlite'),{readOnly:true}),rows=kind=>db.prepare('SELECT body FROM records WHERE kind=?').all(kind).map(r=>JSON.parse(r.body));
const config=JSON.parse(db.prepare("SELECT body FROM records WHERE id='config'").get().body),bots=new Set(config.wake?.botAccounts||[]);
// Placeholders for media, @ and cards are not typing.
const typed=t=>String(t||'').replace(/\[(image|video|record)\]|\[@\d+\]|\[(分享|聊天记录|文件|卡片)[^\]]*\]/g,'').trim();
const people=rows('message').filter(m=>m.direction==='in'&&!String(m.groupId).startsWith('private:')&&!bots.has(String(m.userId))&&m.at>=since).map(m=>typed(m.text)).filter(Boolean);
const replies=rows('outbox').filter(o=>o.category==='reply'&&o.status==='sent'&&!o.debug&&(o.createdAt??0)>=since&&(!persona||o.persona===persona)&&o.text).map(o=>o.text.trim());
db.close();
function stats(texts){const n=texts.length;if(!n)return {n};const len=texts.map(t=>[...t].length).sort((a,b)=>a-b),share=f=>Math.round(texts.filter(f).length*100/n)+'%';
 return {n,median:len[n>>1],p75:len[Math.floor(n*.75)],'≤4字':share(t=>[...t].length<=4),'≤10字':share(t=>[...t].length<=10),'>40字':share(t=>[...t].length>40),'问号':share(t=>/[？?]/.test(t)),'感叹号':share(t=>/[！!]/.test(t))};}
const bot=stats(replies);
console.log(JSON.stringify({since:since?new Date(since).toISOString():'all',persona:persona||'all',people:stats(people),replies:bot,target:{median:'≤15',['≤10字']:'≥30%'},met:bot.n?bot.median<=15&&parseInt(bot['≤10字'])>=30:null},null,1));
