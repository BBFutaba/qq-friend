// Meme dictionary. The observer flags terms it does not understand (its optional "memes" output), Wander researches a term
// once it keeps coming up (see researchMeme in wander.js), the owner reviews the result on the 梗词典 page, and approved
// entries reach the observer and the reply whenever the term or an alias shows up in recent messages: plain string matching,
// no model call. Records are kind 'meme', id meme:<hash of the normalized term>; who flagged a term stays in the database.
import { createHash } from 'node:crypto';
import { clean } from './links.js';

export const MEME_STATUSES = ['candidate', 'pending', 'approved', 'rejected'];
export const normTerm = s => String(s ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
export const memeId = term => `meme:${createHash('sha256').update(normTerm(term)).digest('hex').slice(0, 24)}`;
const text = (v, max) => clean(v, max).replace(/〔/g, '（').replace(/〕/g, '）');
// A term worth keeping: 1–30 characters, not a number, a link, a mention or anything carrying a QQ-style number.
export function memeTerm(raw) {
  const t = text(raw, 40).replace(/^[「『“"'《]+|[」』”"'》]+$/g, '').trim();
  return t && [...t].length <= 30 && !/^\d+$/.test(t) && !/https?:|www\.|@|\d{5,}/i.test(t) ? t : '';
}
// What the owner (or a research result) may set on an entry; everything is cleaned and capped like other untrusted text.
export function memeFields(b) {
  const list = Array.isArray(b.aliases) ? b.aliases : typeof b.aliases === 'string' ? b.aliases.split(/[,，、\n]/) : [];
  const term = memeTerm(b.term), aliases = [...new Set(list.map(memeTerm).filter(a => a && normTerm(a) !== normTerm(term)))].slice(0, 5);
  return { term, meaning: text(b.meaning, 200), origin: text(b.origin, 200), usage: text(b.usage, 200), example: text(b.example, 120), aliases,
    status: MEME_STATUSES.includes(b.status) ? b.status : 'pending', nsfw: b.nsfw === true || b.nsfw === 'on' };
}
const all = store => store.list('meme', () => true, 5000);
// The entry a term belongs to: its own record, or one that lists it as an alias.
export function findMeme(store, term) { const n = normTerm(term); return store.get(memeId(term)) || all(store).find(m => (m.aliases || []).some(a => normTerm(a) === n)) || null; }
// Observer flags: [{term, message}] with the message the term appeared in. A message counts once per term.
export function recordFlags(store, groupId, flags, now = Date.now()) {
  const touched = [];
  for (const { term: raw, message } of flags.slice(0, 2)) {
    const term = memeTerm(raw);if (!term || !message?.id) continue;
    const old = findMeme(store, term);
    if (old) {
      if ((old.sourceIds || []).includes(message.id)) continue;
      touched.push(store.update(old.id, { mentions: (old.mentions || 0) + 1, people: [...new Set([...(old.people || []), message.userId].filter(Boolean))].slice(-20), groupIds: [...new Set([...(old.groupIds || []), groupId])], sourceIds: [...(old.sourceIds || []), message.id].slice(-10), lastSeen: now }));
    } else touched.push(store.create('meme', { term, aliases: [], status: 'candidate', mentions: 1, people: [message.userId].filter(Boolean), groupIds: [groupId], sourceIds: [message.id], firstSeen: now, lastSeen: now }, memeId(term)));
  }
  return touched;
}
// The next candidate to research: flagged at least minMentions times or by two people (or asked for on the page), at most
// researchDaily tries a day, and a failed try waits six hours unless asked for again.
export function dueForResearch(store, o, now = Date.now()) {
  const memes = all(store);if (memes.filter(m => m.triedAt > now - 86400000).length >= o.researchDaily) return null;
  return memes.filter(m => m.status === 'candidate' && (m.forced || (!(m.triedAt > now - 6 * 3600000) && ((m.mentions || 0) >= o.minMentions || (m.people || []).length >= 2))))
    .sort((a, b) => (b.forced ? 1 : 0) - (a.forced ? 1 : 0) || (b.mentions || 0) - (a.mentions || 0))[0] || null;
}
// The lines around the latest two mentions for the researcher: speakers as A/B/C, mentions and long numbers removed.
export function researchContext(store, meme) {
  const lines = [], who = new Map();
  for (const id of (meme.sourceIds || []).slice(-2)) {
    const m = store.get(id);if (m?.kind !== 'message') continue;
    const around = store.scoped('message', m.groupId, x => x.at <= m.at && x.direction === 'in', 30).sort((a, b) => a.at - b.at || a.updated - b.updated).slice(-4);
    for (const x of around) {
      if (x.forward?.nsfw) continue;
      const line = text(String(x.text || '').replace(/@\S+/g, '').replace(/\d{5,}/g, '…'), 150);if (!line) continue;
      if (!who.has(x.userId)) who.set(x.userId, String.fromCharCode(65 + who.size % 26));
      lines.push(`${who.get(x.userId)}：${line}`);
    }
  }
  return [...new Set(lines)].slice(-8);
}
// A research result becomes an entry for the owner to review; nothing found online makes it a group-only joke (low confidence).
export function applyResearch(store, meme, r, nsfw = false, now = Date.now()) {
  const f = memeFields({ ...r, term: meme.term, status: 'pending' });
  return store.update(meme.id, { ...f, found: r.found === true, group: r.found !== true, sources: r.found === true ? r.sources || [] : [], confidence: r.found === true ? r.confidence : 'low', nsfw: r.nsfw === true || nsfw, researchedAt: now, triedAt: now, error: '', forced: false });
}
export const researchFailed = (store, meme, error, now = Date.now()) => store.update(meme.id, { triedAt: now, error: String(error || '查证失败').slice(0, 160), forced: false });
// Approved, non-NSFW entries whose term or an alias appears in the texts; a short Latin term has to match a whole word.
export function memesIn(store, texts, max = 3) {
  const hay = texts.map(normTerm).join('\n'), out = [];if (!hay.trim()) return out;
  const hit = t => /^[a-z0-9]{1,3}$/.test(t) ? new RegExp(`(^|[^a-z0-9])${t}([^a-z0-9]|$)`).test(hay) : hay.includes(t);
  for (const m of store.list('meme', x => x.status === 'approved' && !x.nsfw, 5000)) {
    if (![m.term, ...(m.aliases || [])].map(normTerm).filter(Boolean).some(hit)) continue;
    out.push({ term: m.term, meaning: m.meaning, ...(m.usage ? { usage: m.usage } : {}), ...(m.group ? { group: true } : {}) });
    if (out.length >= max) break;
  }
  return out;
}
