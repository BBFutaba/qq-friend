// Merged forwards (合并转发, "聊天记录"): read once through OneBot get_forward_msg, as qq-bridge does, and kept on the
// message as a short transcript — sender name and text, one level deep, media as placeholders, every field cleaned like a
// share card so it cannot fake an @, [图片] or a new prompt line. A record whose text hits the NSFW word list is never kept
// or shown to a model; the bot answers it with a canned line instead (media.nsfwReply), with no model call at all.
import { clean, cardText } from './links.js';
const PLACEHOLDER = { image: '[图片]', record: '[语音]', video: '[视频]', face: '', mface: '[表情]' };
// User-written text: control characters out, brackets made full-width; the app's placeholders are added afterwards.
const CONTROL = new RegExp('[' + String.fromCharCode(0) + '-' + String.fromCharCode(31, 127, 0x2028, 0x2029) + ']', 'g');
const escape = v => String(v ?? '').replace(CONTROL, ' ').replace(/\[/g, '［').replace(/\]/g, '］');
const tidy = (v, max) => { const t = v.replace(/\s+/g, ' ').trim(); return t.length > max ? t.slice(0, max - 1) + '…' : t; };
export const forwardId = d => { const s = String(d?.id ?? d?.res_id ?? d?.resid ?? d?.file_id ?? d?.forward_id ?? '').trim(); return /^[\w:.\-/=+@]{1,256}$/.test(s) ? s : ''; };
// The id to fetch and the preview lines QQ puts on the card (the first few messages), from a forward segment or a
// com.tencent.multimsg ark card. The preview is the fallback when fetching fails, and is checked for NSFW too.
export function forwardRef(s) {
  const d = s?.data && typeof s.data === 'object' ? s.data : {};
  if (s?.type === 'forward') { const id = forwardId(d); return id ? { id, preview: [] } : null; }
  if (s?.type !== 'json') return null;
  let j; try { j = JSON.parse(String(d.data ?? '').slice(0, 32000)); } catch { return null; }
  if (j?.app !== 'com.tencent.multimsg') return null;
  const detail = j.meta?.detail || {}, preview = (Array.isArray(detail.news) ? detail.news : []).slice(0, 6).map(n => clean(n?.text, 80)).filter(Boolean);
  return { id: forwardId({ id: detail.resid ?? j.meta?.resid }), preview };
}
function segmentText(s) {
  if (!s || typeof s !== 'object') return '';
  const d = s.data && typeof s.data === 'object' ? s.data : {};
  if (s.type === 'text') return escape(d.text);
  if (s.type === 'at') return `@${escape(d.name || d.qq || '')}`;
  if (Object.hasOwn(PLACEHOLDER, s.type)) return PLACEHOLDER[s.type];
  return cardText(s) || '';
}
const contentText = c => typeof c === 'string' ? c.split(/\[CQ:[^\]]*\]/i).map(escape).join('[媒体]') : Array.isArray(c) ? c.map(segmentText).join('') : c && typeof c === 'object' ? (c.type ? segmentText(c) : contentText(c.content ?? c.text ?? '')) : '';
// get_forward_msg answers differ by gateway: {messages:[…]} or a bare list; each node keeps its text in message, content
// or data.content and its sender in sender or data.nickname. Returns every line (for the NSFW check) and a capped
// transcript for the models: at most 20 lines and about 1,200 characters.
export function forwardTranscript(data) {
  const nodes = Array.isArray(data) ? data : Array.isArray(data?.messages) ? data.messages : [], all = [], lines = [];
  let total = 0;
  for (const node of nodes.slice(0, 200)) {
    const d = node?.data && typeof node.data === 'object' ? node.data : {}, sender = node?.sender && typeof node.sender === 'object' ? node.sender : {};
    const text = tidy(contentText(node?.message ?? node?.content ?? d.message ?? d.content ?? d.text ?? ''), 200);
    if (!text) continue;
    const line = `${clean(sender.card || sender.nickname || d.nickname || d.name || node?.nickname || '?', 16)}：${text.slice(0, 80)}`;
    all.push(text);
    if (lines.length < 20 && total + line.length <= 1200) { lines.push(line); total += line.length; } else if (lines.at(-1) !== '…') lines.push('…');
  }
  return { count: nodes.length, lines, all };
}
// High-precision words only: a skipped record costs nothing, a false hit hides an ordinary one. Chinese words are matched
// with spacing and separators removed (色 图, 色.图); Latin words only as whole words, so "Essex" is not "sex".
const CJK = ['色图', '涩图', '瑟图', '黄图', '黄片', '毛片', '黄漫', '成人视频', '成人网站', '黄色网站', '福利姬', '约炮', '裸照', '裸聊', '露点', '自慰', '做爱', '性爱', '性交', '口交', '肛交', '乳交', '内射', '颜射', '潮吹', '巨乳', '爆乳', '奶子', '鸡巴', '阴茎', '阴道', '阴蒂', '操逼', '嫖娼', '卖淫', '援交', '迷奸', '强奸', '乱伦', '里番', '18禁', 'r18', 'av女优'];
const LATIN = ['porn', 'porno', 'hentai', 'nsfw', 'nude', 'nudes', 'xxx', 'onlyfans', 'sex', 'blowjob', 'r-18'];
const SEPARATORS = new RegExp('[\\s*_.\\-·•|/\\\\' + String.fromCharCode(0x200b, 0x200c, 0x200d, 0xfeff) + ']+', 'g');
export function nsfwHit(text, extra = []) {
  const t = String(text || '').normalize('NFKC').toLowerCase(), squeezed = t.replace(SEPARATORS, '');
  if ([...CJK, ...extra.map(w => String(w).toLowerCase().trim()).filter(Boolean)].some(w => squeezed.includes(w.replace(SEPARATORS, '')))) return true;
  return LATIN.some(w => new RegExp(`(^|[^a-z0-9])${w.replace('-', '\\-')}([^a-z0-9]|$)`).test(t));
}
