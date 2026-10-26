// Links to Bilibili and YouTube are read by Wander, a separate local app that reads them read-only through the owner's
// logged-in Chrome and answers with a short note from its own model, plus a subtitle excerpt (or, without subtitles, top
// comments) when it has one. Only allowlisted HTTPS links are sent, Wander must be on
// this machine, and the note that comes back is untrusted data: cleaned like a share card, length-capped, never instructions.
import { clean, cleanUrl } from './links.js';
export const WANDER_URL = 'http://127.0.0.1:4893';
// X is left out on purpose: the owner does not want the bot reading X for now.
const READABLE = /(^|\.)(bilibili\.com|b23\.tv|bili2233\.cn|youtube\.com|youtu\.be)$/;
const SITES = ['bilibili', 'x', 'youtube'], KINDS = ['video', 'post', 'page'];
// At most two links per message, cleaned (Bilibili tracking parameters dropped, YouTube's ?v= kept), HTTPS only.
export function readableLinks(text) {
  const out = [];
  for (const raw of String(text || '').match(/https?:\/\/[^\s<>"'［］\[\]【】（）()，。、]+/g) || []) {
    const url = cleanUrl(raw); let host = '';
    try { host = new URL(url).hostname; } catch { continue; }
    if (url.startsWith('https://') && READABLE.test(host) && !out.includes(url)) out.push(url);
    if (out.length >= 2) break;
  }
  return out;
}
export function wanderBase(value = WANDER_URL) {
  let u; try { u = new URL(value); } catch { throw new Error('Wander 地址无效'); }
  if (!['http:', 'https:'].includes(u.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) || u.username || u.password || u.search || u.hash) throw new Error('Wander 必须是本机地址，令牌不得放入 URL');
  return u.href.replace(/\/$/, '');
}
const note = (v, max) => clean(v, max).replace(/〔/g, '（').replace(/〕/g, '）');
// Subtitle lines ("[0:20] …") stay separate lines, each cleaned; the excerpt is cut at a line boundary.
const lines = (v, max) => {
  let out = '';
  for (const line of String(v ?? '').split('\n')) { const l = note(line, 300); if (!l) continue; if (out.length + l.length + 1 > max) break; out += (out ? '\n' : '') + l; }
  return out;
};
// A video page Wander can read. web_read hands these to Wander: fetching the page itself shows a reader nothing useful.
export function videoLink(raw) {
  let u; try { u = new URL(raw); } catch { return false; }
  const h = u.hostname, p = u.pathname;
  if (u.protocol !== 'https:') return false;
  if (/(^|\.)(b23\.tv|bili2233\.cn)$/.test(h)) return true;
  if (/(^|\.)bilibili\.com$/.test(h)) return /\/(BV[0-9A-Za-z]{10}|av\d+)(\/|$)/i.test(p);
  return h === 'youtu.be' || /(^|\.)youtube\.com$/.test(h) && (p === '/watch' || /^\/(shorts|live)\//.test(p));
}
// Meme research: Wander looks the term up (read-only web search and Bilibili) and answers with an entry for the owner to review.
const CONFIDENCE = ['high', 'medium', 'low'];
export async function researchMeme(term, context, { base = WANDER_URL, token, signal, fetcher = fetch } = {}) {
  if (!token) throw new Error('Wander 令牌尚未配置');
  const response = await fetcher(`${wanderBase(base)}/api/research-meme`, { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ term, context: (context || []).slice(0, 8).map(l => String(l).slice(0, 160)) }), signal: AbortSignal.any([AbortSignal.timeout(180000), ...(signal ? [signal] : [])]) });
  const text = await response.text();
  if (text.length > 65536) throw new Error('Wander 响应过大');
  let j; try { j = JSON.parse(text); } catch { throw new Error(`Wander HTTP ${response.status}`); }
  if (j?.ok !== true) throw new Error(`Wander 未查到：${clean(j?.error || `HTTP ${response.status}`, 60)}`);
  const found = j.found === true, sources = found && Array.isArray(j.sources) ? j.sources.slice(0, 4).map(s => ({ title: note(s?.title, 80), url: cleanUrl(s?.url) })).filter(s => s.url.startsWith('https://')) : [];
  const result = { found, meaning: note(j.meaning, 200), origin: note(j.origin, 200), usage: note(j.usage, 200), example: note(j.example, 120), aliases: Array.isArray(j.aliases) ? j.aliases.slice(0, 5).map(a => note(a, 20)).filter(Boolean) : [], sources, confidence: found && CONFIDENCE.includes(j.confidence) ? j.confidence : 'low', nsfw: j.nsfw === true };
  if (!result.meaning) throw new Error('Wander 没有返回释义');
  return result;
}
export async function readLink(url, { base = WANDER_URL, token, signal, fetcher = fetch } = {}) {
  if (!token) throw new Error('Wander 令牌尚未配置');
  const response = await fetcher(`${wanderBase(base)}/api/read-link`, { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ url }), signal: AbortSignal.any([AbortSignal.timeout(30000), ...(signal ? [signal] : [])]) });
  const text = await response.text();
  if (text.length > 65536) throw new Error('Wander 响应过大');
  let j; try { j = JSON.parse(text); } catch { throw new Error(`Wander HTTP ${response.status}`); }
  if (j?.ok !== true) throw new Error(`Wander 未读到：${clean(j?.error || `HTTP ${response.status}`, 60)}`);
  const result = { url, site: SITES.includes(j.site) ? j.site : 'page', kind: KINDS.includes(j.kind) ? j.kind : 'page', title: note(j.title, 100), author: note(j.author, 40), note: note(j.note, 300) };
  if (!result.note) throw new Error('Wander 没有返回说明');
  // Optional (an older Wander sends none): whether subtitles were found, an excerpt of them, and top comments when there are none.
  if (['ok', 'none', 'failed'].includes(j.subtitle)) result.subtitle = j.subtitle;
  if (j.subtitle === 'failed' && j.subtitleError) result.subtitleError = note(j.subtitleError, 100);
  const transcript = lines(j.transcript, 1500), comments = !transcript && Array.isArray(j.comments) ? j.comments.slice(0, 5).map(c => ({ text: note(c?.text, 120), likes: Number.isSafeInteger(c?.likes) && c.likes > 0 ? c.likes : 0 })).filter(c => c.text) : [];
  if (transcript) result.transcript = transcript;
  if (comments.length) result.comments = comments;
  return result;
}
