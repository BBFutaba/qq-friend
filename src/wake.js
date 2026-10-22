// Cheap rules decide when a model is asked at all, after qq-bridge's wake triggers: messages aimed at the bot
// go straight to the reply; other chatter is batched and judged by the observer at a bounded rate.
// observerSession (DeepSeek observer only) keeps one session per group that receives only what is new each turn,
// rotated after observerSessionTurns turns or observerSessionMaxTokens of context. botAccounts are other bots in the group,
// flagged by the owner: they are never "direct", and at most botExchanges replies in a row may answer them before a human
// speaks again, so two bots cannot talk to each other forever. eagerness picks how readily the observer joins in (after
// qq-bridge's 积极性 line). Conversation mode: once the bot replies, the people it answered are its partners; their
// messages are judged at once ("followup") until conversationSeconds pass without either side speaking, the bot has replied
// conversationTurns times, or the observer says the conversation is over.
export const WAKE_DEFAULTS = { directReply: true, names: [], keywords: [], batchMs: 8000, unfinishedMs: 12000, observerMinGapSeconds: 15, observerHourly: 60, observerMessages: 16, stickerEvery: 3, stickerHourly: 6, observerSession: false, observerSessionTurns: 30, observerSessionMaxTokens: 40000, botAccounts: [], botExchanges: 2, eagerness: 'normal', conversationSeconds: 120, conversationTurns: 8 };
export const wakeOptions = c => ({ ...WAKE_DEFAULTS, ...c.wake });
export const EAGERNESS = { quiet: '安静', normal: '正常', lively: '活跃' };
export const REASONS = { private: '私聊', mention: '@ 机器人', reply: '回复机器人', name: '叫了名字', keyword: '关键词', followup: '对话中接话', chatter: '普通聊天', bot: '其他机器人' };
const PRIORITY = { private: 5, mention: 4, reply: 3, name: 2, keyword: 1, followup: 0.5, chatter: 0, bot: -1 };
export const stronger = (a, b) => (PRIORITY[a] ?? 0) >= (PRIORITY[b] ?? -2) ? a : b;
export const isDirect = reason => !!reason && !['chatter', 'bot', 'followup'].includes(reason);
const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Short ASCII words need word boundaries, so "gpt" does not fire inside "chatgpt".
export function mentions(text, word) {
  const w = String(word || '').trim(); if (!w) return false;
  if (/^[\x20-\x7e]{1,4}$/.test(w)) return new RegExp(`(^|[^a-z0-9])${escape(w)}([^a-z0-9]|$)`, 'i').test(text);
  return String(text).toLowerCase().includes(w.toLowerCase());
}
export function wakeReason(m, { names = [], keywords = [], isBotMessage = () => false, botAccounts = [], isPartner = () => false } = {}) {
  if (String(m.groupId).startsWith('private:')) return 'private';
  if (botAccounts.includes(String(m.userId))) return 'bot';
  if (m.mentioned) return 'mention';
  if (m.replyId && isBotMessage(String(m.replyId))) return 'reply';
  const text = String(m.text || '');
  if (names.some(n => mentions(text, n))) return 'name';
  if (keywords.some(k => mentions(text, k))) return 'keyword';
  if (isPartner(String(m.userId))) return 'followup';
  return 'chatter';
}
// A message that looks cut off (trailing comma or connective) gets a longer quiet window, after qq-bridge's v2-wait.
export const unfinished = text => /(?:[，,、：:～~]|…+|\.{3,}|但是|然后|就是|因为|所以|而且|不过|还有|那个|或者|如果|其实|感觉|我觉得)\s*$/.test(String(text || '').replace(/\[[^\]]*\]/g, '').trim());
export function assertWake(w) {
  const words = a => Array.isArray(a) && a.length <= 20 && a.every(s => typeof s === 'string' && s.trim().length >= 1 && s.length <= 20);
  const int = (v, a, b) => Number.isInteger(v) && v >= a && v <= b;
  if (typeof w.directReply !== 'boolean' || !words(w.names) || !words(w.keywords)) throw new Error('点名回复设置无效：名字和关键词各最多 20 个，每个 1–20 字');
  if (!int(w.batchMs, 1000, 60000) || !int(w.unfinishedMs, w.batchMs, 60000) || !int(w.observerMinGapSeconds, 0, 3600) || !int(w.observerHourly, 1, 120) || !int(w.observerMessages, 6, 40) || !int(w.stickerEvery, 1, 20) || !int(w.stickerHourly, 0, 60)) throw new Error('观察员频率、合并窗口或表情包频率超出允许范围');
  if (!Array.isArray(w.botAccounts) || w.botAccounts.length > 50 || w.botAccounts.some(q => typeof q !== 'string' || !/^\d{5,12}$/.test(q)) || new Set(w.botAccounts).size !== w.botAccounts.length || !int(w.botExchanges, 0, 10)) throw new Error('其他机器人设置无效：最多 50 个 5–12 位 QQ 号，连续回应 0–10 次');
  if (typeof w.observerSession !== 'boolean' || !int(w.observerSessionTurns, 2, 200) || !int(w.observerSessionMaxTokens, 4000, 200000)) throw new Error('观察员长会话设置无效：轮数 2–200，上下文 4000–200000 token');
  if (!Object.hasOwn(EAGERNESS, w.eagerness) || !int(w.conversationSeconds, 0, 600) || !int(w.conversationTurns, 1, 30)) throw new Error('活跃度或对话模式设置无效：对话等待 0–600 秒，每段最多回复 1–30 次');
  return w;
}
