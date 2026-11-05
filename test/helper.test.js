import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { fixtureStore, GROUP, BOT, OWNER } from './fixture.js';
import { Engine } from '../src/engine.js';
import { Providers, CodexTransport } from '../src/providers.js';
import { HELPER_SYSTEM, helperPermission, helperCharacter, helperJson } from '../src/helper.js';
import { validatePresets } from '../src/claude-api.js';

const MEMBER = '10000009';
// answers: role → (prompt, n) → model answer. Records every call and every queued reply.
function setup(t, answers, { audit = () => ['task'], helper = {} } = {}) {
 const s = fixtureStore(), c = s.config(); c.paused = false; c.debug = false; Object.assign(c.personas.gpt, { prompt: '完整人格：毒舌但心软' }); c.wake = { ...c.wake, observerMinGapSeconds: 0, directReply: false }; c.helper = { ...c.helper, ...helper }; s.saveConfig(c);
 const calls = [], audits = [], rows = [], seen = {};
 const p = { stop() {}, async call(role, group, spec, prompt) { calls.push({ role, spec, prompt }); seen[role] = (seen[role] || 0) + 1; return (answers[role] || (() => ({ decision: 'respond', contextIds: [] })))(prompt, seen[role]); },
  async auditTools(list) { audits.push(list); return audit(list); } };
 const bot = new EventEmitter(); bot.send = async () => { throw Error('no sends in tests'); };
 const e = new Engine(s, p, bot); e.enqueue = row => { rows.push(row); return row; }; t.after(() => { e.stop(); s.close(); });
 let id = 1;
 const receive = async (text, user = MEMBER) => (await e.receive({ post_type: 'message', self_id: BOT, user_id: user, message_type: 'group', group_id: GROUP, message_id: id++, time: Math.floor(Date.now() / 1000), sender: { nickname: user === OWNER ? '主人' : '小明' }, message: [{ type: 'text', data: { text } }] })).id;
 const round = async () => { for (const x of e.timers.values()) clearTimeout(x); e.timers.clear(); e.lastReply.clear(); await e.respond(GROUP); };
 const settle = async () => { for (let i = 0; i < 200 && (e.tasks.size || s.list('helper-task', x => x.status === 'running' || !x.followed && x.status !== 'cancelled').length); i++) await new Promise(r => setTimeout(r, 5)); };
 return { s, e, calls, audits, rows, receive, round, settle };}

test('a member asks for a test: the reply says a word now, the helper does it in character after the audit, and the result comes back as a second reply', async t => {
 const x = setup(t, { observer: () => ({ decision: 'respond', contextIds: [] }), reply: (_, n) => n === 1 ? { text: '等我测一下', task: '按你的人设做一份 MBTI 测试，给出类型和理由' } : { text: '测完了，我是 INTP' },
  helper: () => ({ result: 'INTP：爱钻牛角尖但嘴硬', sources: ['https://example.com/mbti', 'javascript:alert(1)'] }) });
 const trigger = await x.receive('你去做个 MBTI 测试呗');await x.round();await x.settle();
 const [first, second] = x.calls.filter(c => c.role === 'reply'), helper = x.calls.find(c => c.role === 'helper');
 assert.match(first.prompt.system, /你还有一个帮手/);assert.match(first.prompt.system, /"task":"可选/);assert.equal(first.prompt.owner, false);
 assert.deepEqual(x.audits, [[{ id: 'task', name: 'helper_task', args: { request: '按你的人设做一份 MBTI 测试，给出类型和理由' } }]]);
 assert.deepEqual(helper.spec, { provider: 'claude', model: 'sonnet', effort: 'medium' });assert.equal(helper.prompt.system, HELPER_SYSTEM, 'the character is not in the prompt');assert.match(helper.prompt.helper.character, /毒舌但心软/);
 assert.equal(helper.prompt.data.request, '按你的人设做一份 MBTI 测试，给出类型和理由');assert.deepEqual(helper.prompt.data.context, first.prompt.data.context);assert.deepEqual({ ...helper.prompt.helper, character: undefined }, { maxTurns: 30, timeoutMs: 300000, character: undefined });
 assert.equal(second.prompt.system, first.prompt.system, 'same instructions: the prompt cache holds');
 assert.deepEqual(second.prompt.data.task, { request: '按你的人设做一份 MBTI 测试，给出类型和理由', status: 'done', result: 'INTP：爱钻牛角尖但嘴硬', sources: ['https://example.com/mbti'] });
 assert.deepEqual(x.rows.map(r => [r.text, r.triggerId, !!r.taskId]), [['等我测一下', trigger, false], ['测完了，我是 INTP', trigger, true]]);
 const task = x.s.list('helper-task')[0];assert.deepEqual([task.status, task.followed, task.owner], ['done', 'sent', false]);});

test('the owner asking skips the audit, and an empty text with a task waits quietly for the result', async t => {
 const x = setup(t, { reply: (_, n) => n === 1 ? { text: '', task: '查一下这周的新番' } : { text: '这周有三部' }, helper: () => ({ result: '三部', sources: [] }) });
 await x.receive('帮我看看这周新番', OWNER);await x.round();await x.settle();
 assert.deepEqual(x.audits, []);assert.equal(x.calls.find(c => c.role === 'reply').prompt.owner, true);
 assert.deepEqual(x.rows.map(r => r.text), ['这周有三部']);assert.equal(x.s.list('log', l => l.details?.decision === 'helper-task').length, 1);
 assert.equal(x.calls.filter(c => c.role === 'reply')[1].prompt.owner, true, 'the follow-up keeps the owner flag for its lookups');});

test('a declined task never reaches the helper, and the follow-up says it was not done', async t => {
 const x = setup(t, { reply: (_, n) => n === 1 ? { text: '我看看', task: '查某人住址' } : { text: '这个不查了' } }, { audit: () => [] });
 await x.receive('帮我查查他住哪');await x.round();await x.settle();
 assert.equal(x.calls.some(c => c.role === 'helper'), false);assert.equal(x.calls.filter(c => c.role === 'reply')[1].prompt.data.task.status, 'declined');
 assert.deepEqual(x.rows.map(r => r.text), ['我看看', '这个不查了']);});

test('one task per chat: while it runs the reply is told the helper is busy and a second task is ignored; a failed task is reported', async t => {
 let finish;const hold = new Promise(r => { finish = r; });
 const x = setup(t, { reply: (_, n) => n === 2 ? { text: '再查一个', task: '第二件事' } : { text: n === 1 ? '我去查' : '没查到', task: n === 1 ? '第一件事' : undefined }, helper: async () => { await hold; throw Error('模型已取消或超时'); } });
 await x.receive('查第一件');await x.round();
 await x.receive('再查第二件');await x.round();
 assert.equal(x.calls.filter(c => c.role === 'reply')[1].prompt.data.helper, 'busy');assert.equal(x.s.list('helper-task').length, 1);
 finish();await x.settle();
 const last = x.calls.filter(c => c.role === 'reply').at(-1).prompt.data.task;assert.deepEqual([last.request, last.status], ['第一件事', 'failed']);assert.match(last.result, /没办成：模型已取消或超时/);});

test('with the helper off the reply has no task field and a task in the answer is ignored', async t => {
 const x = setup(t, { reply: () => ({ text: '好', task: '做个测试' }) }, { helper: { enabled: false } });
 await x.receive('做个测试');await x.round();
 const reply = x.calls.find(c => c.role === 'reply').prompt;assert.doesNotMatch(reply.system, /帮手|"task"/);assert.equal(x.s.list('helper-task').length, 0);assert.deepEqual(x.rows.map(r => r.text), ['好']);});

test('the daily count caps tasks', async t => {
 const x = setup(t, { reply: () => ({ text: '好', task: '做个测试' }) }, { helper: { dailyTasks: 1 } });
 x.s.create('helper-task', { groupId: GROUP, persona: 'gpt', request: '旧的', status: 'done', followed: 'sent', startedAt: Date.now() - 60000 });
 await x.receive('做个测试');await x.round();
 assert.equal(x.calls.find(c => c.role === 'reply').prompt.data.helper, 'busy');assert.equal(x.s.list('helper-task').length, 1);});

test('when the Claude run fails the same task goes to Codex once, and the task says so', async t => {
 const x = setup(t, { reply: (_, n) => n === 1 ? { text: '我去查', task: '查一下这周的新番' } : { text: '这周有三部' }, helper: (_, n) => { if (n === 1) throw Error('Failed to authenticate: OAuth session expired'); return { result: '三部', sources: ['https://example.com/a'] }; } });
 await x.receive('查查这周新番');await x.round();await x.settle();
 const [claude, codex] = x.calls.filter(c => c.role === 'helper');
 assert.deepEqual([claude.spec, codex.spec], [{ provider: 'claude', model: 'sonnet', effort: 'medium' }, { provider: 'codex', model: 'gpt-6.1-sol', effort: 'medium' }]);assert.deepEqual(codex.prompt, claude.prompt, 'the same task, chat and character');
 const task = x.s.list('helper-task')[0];assert.deepEqual([task.status, task.result, task.via], ['done', '三部', 'codex']);assert.equal(x.s.list('log', l => /改用 Codex：Failed to authenticate/.test(l.message)).length, 1);
 assert.deepEqual(x.rows.map(r => r.text), ['我去查', '这周有三部']);});

test('with the fallback off, or when the task was cancelled, a failed Claude run is not retried', async t => {
 const off = setup(t, { reply: (_, n) => n === 1 ? { text: '我去查', task: '查一下' } : { text: '没查到' }, helper: () => { throw Error('Failed to authenticate'); } }, { helper: { fallback: false } });
 await off.receive('查查');await off.round();await off.settle();
 const task = off.s.list('helper-task')[0];assert.equal(off.calls.filter(c => c.role === 'helper').length, 1);assert.deepEqual([task.status, task.via], ['failed', undefined]);assert.match(task.result, /Failed to authenticate/);
 const cut = setup(t, { reply: () => ({ text: '我去查', task: '查一下' }), helper: () => { cut.e.tasks.get(GROUP).abort();throw Error('模型已取消或超时'); } });
 await cut.receive('查查');await cut.round();await cut.settle();
 assert.equal(cut.calls.filter(c => c.role === 'helper').length, 1);assert.equal(cut.s.list('helper-task')[0].status, 'cancelled');});

test('a Codex helper spec runs on the web-enabled Codex process with the task limits and character', async () => {
 const s = fixtureStore(), p = new Providers(s, {});
 try { let got;p.codexWeb.helper = async (spec, prompt, signal, h) => { got = { spec, h }; return { text: '{"result":"ok","sources":[]}', usage: null, model: spec.model }; };p.codex.complete = async () => { throw Error('the companion process must not get helper tasks'); };
  const r = await p.call('helper', GROUP, { provider: 'codex', model: 'gpt-6.1-sol', effort: 'medium' }, { system: 's', data: { request: 'r' }, budget: { limitChars: 60000 }, helper: { maxTurns: 30, timeoutMs: 300000, character: '人设' } });
  assert.deepEqual(r, { result: 'ok', sources: [] });assert.deepEqual(got.h, { maxTurns: 30, timeoutMs: 300000, character: '人设' });assert.equal(p.codexWeb.web, true);assert.equal(p.codex.web, false);
  assert.deepEqual(s.list('usage', u => u.role === 'helper').map(u => [u.provider, u.status]), [['codex', 'completed']]);
  await assert.rejects(p.codex.helper({ provider: 'codex', model: 'm' }, { system: 's', data: {} }, null, {}), /不能上网/); } finally { p.stop(); s.close(); }});

test('a Codex helper thread answers its character tool and lets web search through; a companion thread allows no tool at all', () => {
 const x = new CodexTransport(), sent = [];x.send = m => sent.push(m);x.stop = () => { x.stopped = true; };
 const turn = (allow, tools) => { const t = { allow, tools, used: [], text: '', resolve() {}, reject(e) { t.error = e.message; } };return t; }, helper = turn(['webSearch', 'dynamicToolCall'], { character: '人设' }), chat = turn([], null);
 x.turns.set('h', helper);x.turns.set('c', chat);const call = (id, threadId, tool) => x.message({ id, method: 'item/tool/call', params: { threadId, turnId: 'u', callId: 'k', tool, arguments: {} } });
 call(7, 'h', 'character');call(8, 'h', 'constructor');call(9, 'c', 'character');const none = { code: -32601, message: 'QQ companion exposes no tools' };
 assert.deepEqual(sent, [{ id: 7, result: { contentItems: [{ type: 'inputText', text: '人设' }], success: true } }, { id: 8, error: none }, { id: 9, error: none }]);
 x.message({ method: 'item/started', params: { threadId: 'h', item: { type: 'webSearch', id: 'w' } } });x.message({ method: 'item/completed', params: { threadId: 'h', item: { type: 'webSearch', id: 'w', action: { type: 'openPage', url: 'https://a.example' } } } });
 assert.equal(helper.error, undefined);assert.equal(x.stopped, undefined);assert.deepEqual(helper.used, [{ name: 'web_search.openPage', status: 'completed' }]);
 x.message({ method: 'item/started', params: { threadId: 'c', item: { type: 'webSearch', id: 'w' } } });assert.match(chat.error, /不允许的工具/);assert.equal(x.stopped, true);
 x.message({ method: 'item/started', params: { threadId: 'h', item: { type: 'commandExecution', id: 'x' } } });assert.match(helper.error, /不允许的工具/, 'the helper gets no shell either');});

test('the runner allows WebSearch, and WebFetch only for public pages; nothing else', async () => {
 const pub = async () => [{ address: '93.184.216.34', family: 4 }], priv = async () => [{ address: '192.168.1.1', family: 4 }];
 assert.equal((await helperPermission('WebSearch', { query: 'x' })).behavior, 'allow');assert.equal((await helperPermission('mcp__qq__character', {})).behavior, 'allow');
 assert.deepEqual(await helperPermission('WebFetch', { url: 'https://example.com/a', prompt: 'p' }, pub), { behavior: 'allow', updatedInput: { url: 'https://example.com/a', prompt: 'p' } });
 for (const url of ['http://127.0.0.1:4891/api/state', 'https://localhost/x', 'http://example.com:3000/', 'file:///C:/x']) assert.equal((await helperPermission('WebFetch', { url }, pub)).behavior, 'deny', url);
 assert.equal((await helperPermission('WebFetch', { url: 'https://router.example.com/' }, priv)).behavior, 'deny', 'a name that resolves inside the network');
 for (const name of ['Bash', 'Read', 'Write', 'mcp__x__y']) assert.equal((await helperPermission(name, {})).behavior, 'deny', name);});

test('the helper gets the persona and the preset blocks that reach replies or name it, never assistant examples', () => {
 const block = (content, extra) => ({ name: 'b', enabled: true, role: 'system', position: 'before', roles: [], content, ...extra });
 const c = { claudeApi: { presets: [{ id: 'p', blocks: [block('通用 {{role}}'), block('回复专用', { roles: ['reply'] }), block('帮手专用', { roles: ['helper'] }), block('观察员专用', { roles: ['observer'] }), block('示例回答', { role: 'assistant' }), block('关掉的', { enabled: false }), block('用户块', { role: 'user', position: 'after', roles: ['reply'] })] }] } };
 const persona = { provider: 'claude', transport: 'api', apiPreset: 'p', model: 'm', prompt: '人格本体' };
 assert.equal(helperCharacter(c, persona), '人格本体\n\n通用 helper\n\n回复专用\n\n帮手专用\n\n用户块');
 assert.equal(helperCharacter(c, { ...persona, transport: 'native' }), '人格本体', 'a native persona has no preset');
 assert.doesNotThrow(() => validatePresets([{ id: 'p', name: 'P', maxTokens: 100, temperature: null, topP: null, stop: [], blocks: [block('x', { roles: ['helper'] })] }]));});

test('the helper\'s answer becomes {result, sources} whatever shape it came in', () => {
 assert.deepEqual(JSON.parse(helperJson('好的，结果如下 {"result":"INTP","sources":["https://a.example"]} 完')), { result: 'INTP', sources: ['https://a.example'] });
 assert.deepEqual(JSON.parse(helperJson('就是 INTP')), { result: '就是 INTP', sources: [] });assert.deepEqual(JSON.parse(helperJson('{"x":1}')), { result: '{"x":1}', sources: [] });});

test('helper settings are validated', () => {
 const s = fixtureStore();
 try { for (const bad of [{ provider: 'codex' }, { model: '' }, { effort: 'huge' }, { dailyTasks: 0 }, { maxTurns: 500 }, { timeoutSeconds: 10 }, { enabled: 'yes' }, { fallback: 'yes' }, { fallbackModel: '' }, { fallbackEffort: 'huge' }]) assert.throws(() => s.saveConfig({ ...s.config(), helper: { ...s.config().helper, ...bad } }), /帮手设置无效/, JSON.stringify(bad));
  s.saveConfig({ ...s.config(), helper: { ...s.config().helper, model: 'opus', effort: 'high', fallbackEffort: 'ultra' } });assert.equal(s.config().helper.model, 'opus'); } finally { s.close(); }});

test('the owner\'s lookups skip the audit; everyone else\'s are audited', async () => {
 const s = fixtureStore(), p = new Providers(s, { claudeApi: { protocol: 'anthropic', baseUrl: 'https://api.example.test/v1', apiKey: 'k' } });
 try { s.saveConfig({ ...s.config(), claudeApi: { webTools: true } });let hooks, audited = 0;p.claudeApi.complete = async (_, __, h) => { hooks = h; return { text: '{"text":"ok"}' }; };p.auditTools = async () => { audited++; return []; };
  const spec = { provider: 'claude', transport: 'api', model: 'm', effort: '' }, prompt = { system: 's', data: { x: 1 }, budget: { limitChars: 16000 } };
  await p.call('reply', GROUP, spec, { ...prompt, owner: true });assert.deepEqual(await hooks.auditTools([{ id: 'a' }, { id: 'b' }]), ['a', 'b']);assert.equal(audited, 0);
  assert.equal(s.list('log', l => l.type === 'tool-audit' && l.details.owner).length, 1);
  await p.call('reply', GROUP, spec, prompt);assert.deepEqual(await hooks.auditTools([{ id: 'a' }]), []);assert.equal(audited, 1); } finally { p.stop(); s.close(); }});

test('nothing tells her to report a failed lookup; the reply is told to keep looking things up out of sight', async () => {
 const { WEB_TOOLS } = await import('../src/chat-web.js'), { TASK_NOTE } = await import('../src/helper.js'), { buildApiRequest } = await import('../src/claude-api.js'), s = fixtureStore();
 try { const e = new Engine(s, { stop() {} }, new EventEmitter()), system = e.replySystem(s.config(), { prompt: '人格' });
  const request = buildApiRequest({ provider: 'claude', transport: 'api', model: 'm', effort: '' }, { system: 's', data: { x: 1 }, budget: { limitChars: 16000 } }, { webTools: true }, { protocol: 'anthropic', baseUrl: 'https://api.example.test/v1', apiKey: 'k' }, 'reply');
  for (const text of [TASK_NOTE, ...WEB_TOOLS.map(t => t.description), JSON.stringify(request.body.messages)]) assert.doesNotMatch(text, /照实|如实|须说明|明确说明|不可声称/, text.slice(0, 30));
  assert.match(system, /回复里不提自己搜过/);assert.match(JSON.stringify(request.body.messages), /回复里不提查询过程/);e.stop(); } finally { s.close(); }});

test('the reply instructions carry no quoted stock phrases to parrot, and say the persona\'s examples only set the tone', async () => {
 const { TASK_NOTE, TASK_FORMAT } = await import('../src/helper.js'), { PACE_NOTE, PACES } = await import('../src/pace.js'), s = fixtureStore();
 try { const e = new Engine(s, { stop() {} }, new EventEmitter()), system = e.replySystem(s.config(), { prompt: '人格' });
  for (const text of [TASK_NOTE, TASK_FORMAT, PACE_NOTE, ...Object.values(PACES)]) assert.doesNotMatch(text, /[“「『]/, text.slice(0, 30));
  assert.match(system, /例句只示意语气/);assert.doesNotMatch(system, /(^|[^\w])topic 为|回复简短/);e.stop(); } finally { s.close(); }});
