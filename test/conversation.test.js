import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { fixtureStore, GROUP, BOT } from './fixture.js';
import { Engine } from '../src/engine.js';
import { OneBot } from '../src/onebot.js';
import { ClaudeApi, buildApiRequest } from '../src/claude-api.js';
import { wakeReason, isDirect, stronger, assertWake, WAKE_DEFAULTS } from '../src/wake.js';

const H = '10000009', O = '10000010';
function setup(t, { wake = {}, decision = () => ({ decision: 'respond', contextIds: [] }), reply = () => ({ text: '好' }) } = {}) {
 const s = fixtureStore(), c = s.config(); c.paused = false; Object.assign(c.personas.gpt, { prompt: '完整人格' }); c.wake = { ...c.wake, ...wake }; s.saveConfig(c);
 const calls = [], p = { stop() {}, async call(role, group, spec, prompt) { calls.push({ role, prompt }); return role === 'observer' ? decision(prompt) : reply(prompt); } };
 const bot = new EventEmitter(); bot.send = async () => { throw Error('no sends in tests'); }; const e = new Engine(s, p, bot), queued = []; e.enqueue = row => { queued.push(row); return row; };
 t.after(() => { e.stop(); s.close(); }); let at = Date.now() - 30000;
 const say = (userId, text, name = userId === H ? '小明' : '小红') => { const m = s.create('message', { groupId: GROUP, userId, name, text, media: [], at: at += 100, direction: 'in', externalId: String(at) }); e.upsertMember(GROUP, userId, name); return { m, reason: e.noteWake(m, s.config()) }; };
 const round = async () => { for (const x of e.timers.values()) clearTimeout(x); e.timers.clear(); e.lastReply.clear(); await e.respond(GROUP); };
 return { s, e, calls, queued, say, round, observers: () => calls.filter(x => x.role === 'observer') };}

test('wake: partners in a conversation follow up (not direct, weaker than a real wake), new defaults and validation', () => {
 assert.equal(wakeReason({ groupId: GROUP, userId: H, text: '然后呢' }, { isPartner: id => id === H }), 'followup');
 assert.equal(wakeReason({ groupId: GROUP, userId: H, text: '然后呢', mentioned: true }, { isPartner: () => true }), 'mention');
 assert.equal(isDirect('followup'), false);assert.equal(stronger('followup', 'chatter'), 'followup');assert.equal(stronger('name', 'followup'), 'name');
 assert.deepEqual([WAKE_DEFAULTS.observerMinGapSeconds, WAKE_DEFAULTS.observerHourly, WAKE_DEFAULTS.eagerness, WAKE_DEFAULTS.conversationSeconds, WAKE_DEFAULTS.conversationTurns], [15, 60, 'normal', 120, 8]);
 for (const bad of [{ eagerness: 'loud' }, { conversationSeconds: 601 }, { conversationTurns: 0 }]) assert.throws(() => assertWake({ ...WAKE_DEFAULTS, ...bad }), /活跃度或对话模式/, JSON.stringify(bad));});

test('conversation mode: the person answered is judged at once despite tight limits, others wait, "over" ends it', async t => {
 let over = false;const x = setup(t, { wake: { observerMinGapSeconds: 600, observerHourly: 1 }, decision: () => ({ decision: 'respond', contextIds: [], ...(over ? { conversation: 'over' } : {}) }) });
 x.say(H, '在吗');await x.round();assert.equal(x.queued.length, 1);assert.deepEqual([...x.e.conversation(GROUP).partners], [H]);
 const follow = x.say(H, '你觉得这个怎么样');assert.equal(follow.reason, 'followup');assert.equal(x.e.wakeDelay(GROUP, x.s.config()), x.s.config().participation.debounceMs);
 await x.round();assert.equal(x.observers().length, 2, 'not held back by the 600 s gap or the hourly cap');assert.equal(x.queued.length, 2);
 assert.match(x.observers()[1].prompt.data.conversation, /正在和 小明 聊天，这段你已回 1 次/);assert.match(x.observers()[1].prompt.data.participation, /你最近 1 小时发言 \d+ 次，群友 \d+ 条/);
 x.say(O, '我路过');await x.round();assert.equal(x.observers().length, 2, 'someone else still waits for the observer gap');
 over = true;x.say(H, '好吧我去吃饭了');await x.round();assert.equal(x.e.conversation(GROUP), null, 'the observer ended the conversation');
 assert.ok(x.s.list('log', l => l.details?.decision === 'conversation-over').length);assert.equal(x.say(H, '我回来了').reason, 'chatter');});

test('conversation mode ends after conversationTurns replies or conversationSeconds of silence', async t => {
 const x = setup(t, { wake: { observerMinGapSeconds: 0, conversationTurns: 2 } });
 x.say(H, '一');await x.round();x.say(H, '二');await x.round();assert.equal(x.queued.length, 2);assert.equal(x.e.conversation(GROUP), null, 'two replies used the turn budget');
 x.say(H, '三');await x.round();assert.ok(x.e.conversation(GROUP));x.e.conversations.get(GROUP).until = Date.now() - 1;assert.equal(x.e.conversation(GROUP), null, 'silence ends it');});

test('a message during the reply cooldown is rescheduled instead of dropped; partners only wait the debounce', async t => {
 const x = setup(t, { wake: { observerMinGapSeconds: 0 } });
 x.say(H, '在吗');await x.round();x.e.lastReply.set(GROUP, Date.now());x.say(O, '我也在');await x.e.respond(GROUP);
 assert.equal(x.observers().length, 1);assert.ok(x.e.timers.has(GROUP), 'rescheduled for after the cooldown');
 x.say(H, '那我们聊聊');x.e.lastReply.set(GROUP, Date.now() - x.s.config().participation.debounceMs - 10);await x.e.respond(GROUP);assert.equal(x.observers().length, 2, 'a partner only waits the debounce');});

test('activity level changes the observer wording; the summary nudges a quiet bot in a busy group', async t => {
 const x = setup(t, { wake: { observerMinGapSeconds: 0 }, decision: () => ({ decision: 'ignore' }) });
 for (let i = 0; i < 12; i++) x.say(i % 2 ? H : O, `聊天${i}`);await x.round();
 const first = x.observers()[0].prompt;assert.match(first.system, /你是群里的一员，不是只在被点名时才说话/);assert.match(first.data.participation, /你最近 1 小时发言 0 次，群友 12 条/);assert.match(first.data.participation, /群聊正热|一直没说话/);
 const c = x.s.config();c.wake.eagerness = 'lively';x.s.saveConfig(c);x.say(H, '再说一句');await x.round();assert.match(x.observers()[1].prompt.system, /不要习惯性潜水/);});

test('a finished reply is kept when newer messages arrive: it quotes the message it answers and the rest is judged next', async t => {
 let x;x = setup(t, { wake: { observerMinGapSeconds: 0 }, reply: () => { x.say(O, '插一句'); return { text: '好' }; } });
 const { m } = x.say(H, '今晚打游戏吗');await x.round();
 assert.equal(x.queued.length, 1);assert.equal(x.queued[0].triggerId, m.id);assert.equal(x.queued[0].quote, m.externalId);assert.ok(x.e.timers.has(GROUP), 'the newer message is judged next');
 const y = setup(t, { wake: { observerMinGapSeconds: 0 }, decision: () => { y.say(O, '我先说'); return { decision: 'respond', contextIds: [] }; } });
 y.say(H, '有人吗');await y.round();assert.equal(y.queued.length, 1, 'a newer message during the observer call no longer throws the decision away');});

test('Claude API: a tool_use stop without any tool call is retried once without tools', async () => {
 const connection = { protocol: 'anthropic', baseUrl: 'https://api.example.test/v1', apiKey: 'k' }, spec = { provider: 'claude', transport: 'api', model: 'm', effort: '' };
 const request = buildApiRequest(spec, { system: 's', data: { context: 'x' }, budget: { limitChars: 16000 } }, { webTools: true }, connection, 'reply');
 const run = async answers => { const bodies = [];const client = new ClaudeApi({ claudeApi: connection }, async (_, o) => { bodies.push(JSON.parse(o.body));return new Response(JSON.stringify(answers[bodies.length - 1])); });return { bodies, result: await client.complete(request).catch(e => e) }; };
 const ok = await run([{ content: [], stop_reason: 'tool_use' }, { content: [{ type: 'text', text: '{"text":"好"}' }], stop_reason: 'end_turn' }]);
 assert.equal(ok.result.text, '{"text":"好"}');assert.equal(ok.result.rounds, 2);assert.deepEqual(ok.bodies[1].tool_choice, { type: 'none' });assert.equal(ok.bodies[0].tool_choice.type, 'auto');
 const twice = await run([{ content: [], stop_reason: 'tool_use' }, { content: [], stop_reason: 'tool_use' }]);assert.match(twice.result.message, /tool_use · 内容块：无/);assert.equal(twice.bodies.length, 2, 'only one retry');});

test('OneBot send quotes the answered message only with a valid QQ message id', async () => {
 const o = new OneBot({ httpUrl: 'http://127.0.0.1:1', token: 't' }, BOT), sent = [];o.probe = async () => ({});o.action = async (action, payload) => { sent.push(payload.message);return { message_id: 1 }; };
 await o.send('group', '30000003', '好', '777');await o.send('group', '30000003', '好', '');await o.send('group', '30000003', '好', 'x]');
 assert.deepEqual(sent.map(m => m.map(s => s.type)), [['reply', 'text'], ['text'], ['text']]);assert.equal(sent[0][0].data.id, '777');});
