// Per-reply length lean for the reply model. Left alone the model answers everything with one polished
// ~30-character sentence, while people in the group type a median of 8 characters (61% within 10, 23% within 4). The
// lean is drawn per reply, like SillyTavern's {{random}} macros, so lengths vary; a direct question or a request to
// explain always gets room. It goes in the reply's `data`, never in the cached instructions. The reply model gets no clock or
// date at all: with one it kept steering chat toward the time of day.
export const PACES = { react: '只给反应：一到几个字', short: '一句短话：十几个字以内', full: '可以完整一点：一两句' };
export const PACE_WEIGHTS = { react: .35, short: .45, full: .2 };
const ASKS = /[？?]|怎么|为什么|为啥|什么|吗|能不能|可不可以|是不是|解释|讲讲|说说|介绍|推荐|区别|比较|哪个|多少/;
export function replyPace(text, direct, random = Math.random) {
  if (direct && ASKS.test(String(text || ''))) return PACES.full;
  const r = random();return r < PACE_WEIGHTS.react ? PACES.react : r < PACE_WEIGHTS.react + PACE_WEIGHTS.short ? PACES.short : PACES.full;
}
// The one sentence the fixed reply instructions need so the model knows what the field means.
export const PACE_NOTE = 'pace 是这一条的长度倾向，内容确实需要时可以突破。';
