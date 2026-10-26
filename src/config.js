import { validatePresets, publicApiConnection } from './claude-api.js';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { MEMORY_DEFAULTS, memoryOptions } from './memory-policy.js';
import { WAKE_DEFAULTS, wakeOptions, assertWake } from './wake.js';
export const ROOT = resolve(import.meta.dirname, '..');
export const DATA = resolve(process.env.QQ_FRIEND_DATA || join(ROOT, 'data'));
const localZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai'; } catch { return 'Asia/Shanghai'; } };
export const DEFAULT_OBSERVER = { provider: 'codex', model: 'gpt-6.1-sol', effort: 'low' };
// A fresh install has no QQ identity; the dashboard's 「连接与环境」 page or scripts/configure.js fills it in.
export const DEFAULTS = {
  revision: 1, ownerId: '', botId: '', privateAllowlist: [],
  paused: true, debug: true,
  groups: [],
  personas: {
    gpt: { name: 'GPT', provider: 'codex', model: 'gpt-6.1-sol', effort: 'medium', prompt: '' },
    claude: { name: 'Claude', provider: 'claude', model: 'claude-fable-5-1', effort: 'medium', prompt: '' },
    deepseek: { name: 'DeepSeek', provider: 'deepseek', model: '', effort: '', prompt: '' }
  },
  // perception (画面识别) describes images and video frames before the observer sees them, so it needs a model that can see.
  roles: { observer: 'observer', memory: 'gpt', auditor: 'gpt', discovery: 'gpt', perception: 'perception' },
  roleModels: { observer: { ...DEFAULT_OBSERVER }, perception: { ...DEFAULT_OBSERVER }, gpt: { provider: 'codex', model: 'gpt-6.1-sol', effort: 'medium' }, fable: { provider: 'claude', model: 'claude-fable-5-1', effort: 'medium' } },
  participation: { debounceMs: 3500, cooldownSeconds: 25, maxContextChars: 16000, maxContextMessages: 40, maxReplyAgeSeconds: 90, dailyCalls: 160, hourlyReplies: 20 },
  memory: { ...MEMORY_DEFAULTS },
  wake: { ...WAKE_DEFAULTS },
  output: { splitOn: '，。！？；,.!?;\n', stripEnd: '，。；,.;;', maxParts: 5, maxPartChars: 220, delayMs: 1600 },
  proactive: { enabled: false, intervalMinutes: 120, maxDaily: 3, approvalMinutes: 60, quietStart: 23, quietEnd: 8, timezone: localZone() },
  // forwards: read merged chat records; nsfwReply: the canned answer to one that hits the NSFW list ('' = stay silent).
  media: { images: true, audio: true, video: true, forwards: true, links: true, nsfwReply: '不爱看这种', nsfwWords: [] },
  // 梗词典: research a flagged term after minMentions flags (or two people), at most researchDaily Wander researches a day.
  memes: { enabled: true, minMentions: 2, researchDaily: 10 },
  browser: { enabled: false, maxItems: 20 },
  environment: { arbitraryExecution: false },
};
export function assertConfig(c) {
  validatePresets(c.claudeApi?.presets);
  if(c.claudeApi?.webTools!==undefined&&typeof c.claudeApi.webTools!=='boolean')throw Error('聊天查询工具开关无效');
  if(c.claudeApi?.cache!==undefined&&!['off','5m','1h'].includes(c.claudeApi.cache))throw Error('提示词缓存设置无效');
  for(const spec of [...Object.values(c.personas||{}),...Object.values(c.roleModels||{})]){if(spec.transport!==undefined&&(!['native','api'].includes(spec.transport)||spec.provider!=='claude'))throw new Error('调用模式无效');if(spec.transport==='api'&&(!(c.claudeApi?.presets||[{id:'default'}]).some(p=>p.id===(spec.apiPreset||'default'))||!spec.model.trim()||!['','low','medium','high','xhigh','max'].includes(spec.effort)))throw new Error('API 模型、推理强度或预设无效');}
  const memory=memoryOptions(c);
  if(typeof memory.debugReadApproved!=='boolean'||!Number.isInteger(memory.maxCandidates)||memory.maxCandidates<1||memory.maxCandidates>60||!Number.isInteger(memory.topicTtlHours)||memory.topicTtlHours<1||memory.topicTtlHours>48)throw new Error('记忆检索或短期话题设置无效');
  assertWake(wakeOptions(c));
  const id = x => typeof x === 'string' && /^\d{5,15}$/.test(x);
  if (c.ownerId !== '' || c.botId !== '') { if (!id(c.ownerId) || !id(c.botId) || c.ownerId === c.botId) throw new Error('审批 QQ 与机器人 QQ 必须是不同的有效号码'); }
  if (!Array.isArray(c.privateAllowlist) || c.privateAllowlist.length > 50 || !c.privateAllowlist.every(id) || c.privateAllowlist.includes(c.botId) || (c.ownerId && !c.privateAllowlist.includes(c.ownerId))) throw new Error('私聊白名单必须是有效 QQ 号、包含审批 QQ，且不能包含机器人自己');
  if (!Array.isArray(c.groups) || c.groups.length > 20 || c.groups.some(g => !id(g.id) || !c.personas[g.persona] || typeof g.name !== 'string' || !g.name.trim() || g.name.length > 40) || new Set(c.groups.map(g=>g.id)).size!==c.groups.length) throw new Error('群配置无效：群号需为 5-15 位数字、名称 1-40 字且不重复');
  if (!c.paused && !identityReady(c)) throw new Error('请先在「连接与环境」填写机器人 QQ、审批 QQ，并启用至少一个群');
  for (const name of ['gpt', 'claude', 'deepseek']) { const p=c.personas[name]; if (!p || typeof p.name!=='string'||!p.name.trim()||p.name.length>40||typeof p.prompt!=='string' || p.prompt.length>12000 || (p.brief!==undefined&&(typeof p.brief!=='string'||p.brief.length>400)) || p.provider!==({gpt:'codex',claude:'claude',deepseek:'deepseek'})[name] || typeof p.model!=='string'||typeof p.effort!=='string') throw new Error('人格配置无效'); }
  if (Object.values(c.roles).some(x => !c.roleModels[x])) throw new Error('后台角色模型无效');
  if(['observer','memory','auditor','discovery','perception'].some(k=>!c.roleModels[c.roles[k]]))throw new Error('后台角色缺失');
  if(c.roleModels[c.roles.perception].provider==='deepseek')throw new Error('画面识别需要能看图的模型（GPT / Codex 或 Claude），DeepSeek 只能读文字');
  for(const p of Object.values(c.roleModels)) if(!p||!['codex','claude','deepseek'].includes(p.provider)||typeof p.model!=='string'||typeof p.effort!=='string')throw new Error('后台模型配置无效');
  const bounds = [[c.participation.debounceMs,500,30000],[c.participation.cooldownSeconds,0,3600],[c.participation.maxContextChars,2000,50000],[c.participation.maxContextMessages,5,150],[c.participation.maxReplyAgeSeconds,10,600],[c.participation.dailyCalls===-1?1:c.participation.dailyCalls,1,10000],[c.participation.hourlyReplies,1,100],[c.output.maxParts,1,10],[c.output.maxPartChars,20,1000],[c.output.delayMs,0,10000],[c.proactive.intervalMinutes,15,1440],[c.proactive.maxDaily,1,30],[c.proactive.approvalMinutes,1,1440],[c.proactive.quietStart,0,23],[c.proactive.quietEnd,0,23],[c.browser.maxItems,1,50]];
  if(bounds.some(([v,a,b])=>!Number.isInteger(v)||v<a||v>b))throw new Error('频率、预算或输出长度超出允许范围');
  for(const v of [c.paused,c.debug,c.proactive.enabled,c.browser.enabled,c.media.images,c.media.audio,c.media.video,c.media.forwards??true,c.media.links??true,...c.groups.map(g=>g.enabled)]) if(typeof v!=='boolean')throw new Error('开关必须为布尔值');
  const memes={...DEFAULTS.memes,...c.memes};if(typeof memes.enabled!=='boolean'||!Number.isInteger(memes.minMentions)||memes.minMentions<1||memes.minMentions>10||!Number.isInteger(memes.researchDaily)||memes.researchDaily<0||memes.researchDaily>100)throw new Error('梗词典设置无效');
  const nsfw={...DEFAULTS.media,...c.media};if(typeof nsfw.nsfwReply!=='string'||nsfw.nsfwReply.length>40||/[\r\n]/.test(nsfw.nsfwReply)||!Array.isArray(nsfw.nsfwWords)||nsfw.nsfwWords.length>100||nsfw.nsfwWords.some(w=>typeof w!=='string'||!w.trim()||w.length>20))throw new Error('不适内容设置无效：回复最多 40 字，屏蔽词最多 100 个、每个 1–20 字');
  if(typeof c.output.splitOn!=='string'||typeof c.output.stripEnd!=='string'||c.output.splitOn.length>50||c.output.stripEnd.length>50)throw new Error('标点设置无效');
  new Intl.DateTimeFormat('en',{timeZone:c.proactive.timezone});
  if(c.environment.arbitraryExecution!==false)throw new Error('任意代码执行尚未开放');
  return c;
}
export const identityReady = c => !!(c.ownerId && c.botId && c.groups.some(g => g.enabled));
export function ensureSecrets() {
  mkdirSync(DATA,{recursive:true});
  const file=join(DATA,'connections.json');
  if(!existsSync(file))writeFileSync(file,JSON.stringify({httpUrl:'',wsUrl:'',token:'',wsToken:'',adminToken:randomBytes(32).toString('hex'),browserToken:randomBytes(32).toString('hex'),eventToken:randomBytes(32).toString('hex'),claudeSdk:'',deepseekCommand:''},null,2));
  return JSON.parse(readFileSync(file,'utf8'));
}
export function saveSecrets(v){writeFileSync(join(DATA,'connections.json'),JSON.stringify(v,null,2));}
export function publicConnections(s){return {claudeApi:publicApiConnection(s.claudeApi),httpUrl:s.httpUrl,wsUrl:s.wsUrl,tokenConfigured:!!s.token,wsTokenConfigured:!!s.wsToken,claudeSdk:s.claudeSdk,deepseekCommand:s.deepseekCommand,wanderUrl:s.wanderUrl||'',wanderTokenConfigured:!!s.wanderToken};}
