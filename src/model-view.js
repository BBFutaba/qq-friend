// Model-facing chat view, after qq-bridge's qq-model-view: short refs instead of record ids, minutes ago instead of
// timestamps, nothing empty, long texts kept as head + tail, media as placeholders or their saved reading.
export const CHAT_COLUMNS = ['ref', 'who', 'ago', 'text', 're'];
const PLACEHOLDER = { image: '[图片]', video: '[视频]', record: '[语音]' }, LINK_SITES = { bilibili: 'B站', x: 'X', youtube: 'YouTube' };
export function messageText(m, { botId = '', limit = 200, tail = 120 } = {}) {
  let t = String(m.text || '').replace(/\[(image|video|record)\]/g, (_, k) => PLACEHOLDER[k]);
  if (botId) t = t.split(`[@${botId}]`).join('@你');
  t = t.replace(/\[@(\d+)\]/g, '@$1');
  // A QQ market sticker carries its own caption ("[动画表情]"); a described image carries its saved reading.
  const hint = m.media?.find(x => x.type === 'image' && x.summary)?.summary;
  if (m.mediaSummary) t = t.replace(/\[(图片|视频)\]/, '') + ` 〔画面：${m.mediaSummary}〕`;
  else if (hint) t = t.replace('[图片]', hint.startsWith('[') ? hint : `[${hint}]`);
  // A fetched chat record replaces its placeholder; one that hit the NSFW list shows only that it was skipped.
  if (m.forward) { const f = m.forward.nsfw ? '[聊天记录：不适内容，已跳过]' : `[聊天记录 ${m.forward.count} 条${m.forward.preview ? '（预览）' : ''}：${(m.forward.lines || []).join(' / ')}]`; t = /\[聊天记录[^\]]*\]/.test(t) ? t.replace(/\[聊天记录[^\]]*\]/, () => f) : `${t} ${f}`; }
  // Notes Wander wrote about Bilibili/X/YouTube links; one that hit the NSFW list only says it was skipped.
  for (const n of m.linkNotes || []) t += n.nsfw ? ' 〔链接：不适内容，已跳过〕' : ` 〔链接 ${LINK_SITES[n.site] || '网页'}「${n.title}」${n.author ? ' ' + n.author : ''}：${n.note}〕`;
  t = t.replace(/\s+/g, ' ').trim();
  if (t.length > limit + tail + 1) t = `${t.slice(0, limit)}…${t.slice(-tail)}`;
  return t || '[空消息]';
}
// The newest `recent` messages keep up to recentLimit chars; older ones are clipped harder. A long-lived session numbers
// on from `start` and resolves replies through the refs it already sent (`known`: external id → ref).
export function chatView(messages, { now = Date.now(), botId = '', recent = 6, limit = 200, recentLimit = 800, tail = 120, prefix = 'm', start = 0, known = null } = {}) {
  const refs = new Map(), byExternal = new Map(known || []), ref = i => `${prefix}${start + i + 1}`;
  messages.forEach((m, i) => { refs.set(ref(i), m); if (m.externalId) byExternal.set(String(m.externalId), ref(i)); });
  const rows = messages.map((m, i) => {
    const full = i >= messages.length - recent;
    return [ref(i), m.direction === 'out' ? '你' : String(m.name || m.userId || '?').slice(0, 24) + (m.bot ? '（机器人）' : ''), Math.max(0, Math.round((now - m.at) / 60000)), messageText(m, { botId, limit: full ? recentLimit : limit, tail }), m.replyId ? byExternal.get(String(m.replyId)) || '更早' : ''];
  });
  return { table: { columns: CHAT_COLUMNS, rows }, refs, refOf: id => [...refs].find(([, m]) => m.id === id)?.[0] };
}
// Refs the model returned, mapped back to messages; record ids are accepted too.
export function resolveRefs(view, picked) {
  if (!Array.isArray(picked)) return [];
  return picked.map(x => view.refs.get(String(x)) || [...view.refs.values()].find(m => m.id === x)).filter(Boolean);
}
