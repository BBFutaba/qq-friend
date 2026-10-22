// Per-reply length lean and local time for the reply model. Left alone the model answers everything with one polished
// ~30-character sentence, while people in the group type a median of 8 characters (61% within 10, 23% within 4). The
// lean is drawn per reply, like SillyTavern's {{random}} macros, so lengths vary; a direct question or a request to
// explain always gets room. Both go in the reply's `data`, never in the cached instructions.
export const PACES = { react: '只给反应：一到几个字', short: '一句短话：十几个字以内', full: '可以完整一点：一两句' };
export const PACE_WEIGHTS = { react: .35, short: .45, full: .2 };
const ASKS = /[？?]|怎么|为什么|为啥|什么|吗|能不能|可不可以|是不是|解释|讲讲|说说|介绍|推荐|区别|比较|哪个|多少/;
export function replyPace(text, direct, random = Math.random) {
  if (direct && ASKS.test(String(text || ''))) return PACES.full;
  const r = random();return r < PACE_WEIGHTS.react ? PACES.react : r < PACE_WEIGHTS.react + PACE_WEIGHTS.short ? PACES.short : PACES.full;
}
// The group's clock, not this computer's: QQ groups live on China time even when the host runs elsewhere (this one's
// activity is 0% between 02:00 and 07:00 Shanghai time). QQ_FRIEND_TZ overrides it for other deployments.
export const TIME_ZONE = process.env.QQ_FRIEND_TZ || 'Asia/Shanghai';
export function localNow(d = new Date(), timeZone = TIME_ZONE) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('zh-CN', { timeZone, month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map(x => [x.type, x.value]));
  return `${p.month}月${p.day}日 ${p.weekday} ${p.hour}:${p.minute}`;
}
// The one sentence the fixed reply instructions need so the model knows what the two fields mean.
export const PACE_NOTE = 'pace 是这一条的长度倾向，内容确实需要时可以突破；now 是现在的本地时间，只在和话题有关时自然用上，不用来编造自己的作息。';
