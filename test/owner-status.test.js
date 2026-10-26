import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { fixtureStore, GROUP, BOT, OWNER } from './fixture.js';
import { Engine } from '../src/engine.js';

function setup(t, config = c => c) {
 const s = fixtureStore(), c = s.config();c.paused = false;c.debug = false;c.personas.claude.prompt = '人格';c.groups[0].persona = 'claude';
 c.roleModels['role:observer'] = { provider: 'deepseek', model: JSON.stringify(['deepseek-account', 'deepseek-flash']), effort: 'off' };c.roles.observer = 'role:observer';c.wake = { ...c.wake, observerSession: true };s.saveConfig(config(c));
 const sent = [], bot = Object.assign(new EventEmitter(), { state: { status: 'connected', note: '账号已验证，正在接收消息', lastEventAt: Date.now() - 120000 }, async send(type, target, text) { sent.push({ type, target, text });return { message_id: 1 }; } });
 const e = new Engine(s, { stop() {}, async call() { return { decision: 'ignore' }; } }, bot);t.after(() => { e.stop(); s.close(); });
 let id = 1;
 const say = (user, text, where = 'group') => e.receive({ post_type: 'message', self_id: BOT, user_id: user, message_type: where, ...(where === 'group' ? { group_id: GROUP } : {}), message_id: id++, time: Math.floor(Date.now() / 1000), sender: { nickname: 'x' }, message: [{ type: 'text', data: { text } }] });
 return { s, e, sent, say };
}

test('the owner\'s #sl in a group gets a private status and leaves no trace in the chat; anyone else\'s is ordinary chat', async t => {
 const x = setup(t);
 assert.deepEqual(await x.say(OWNER, ' #SL '), { status: true });
 assert.equal(x.sent.length, 1);assert.deepEqual([x.sent[0].type, x.sent[0].target], ['private', OWNER]);
 assert.equal(x.s.list('message').length, 0, 'not stored');assert.equal(x.e.timers.size, 0, 'nothing scheduled, so no reply in the group');
 const other = await x.say('10000007', '#sl');assert.ok(other.id, 'stored as a normal message');assert.equal(x.sent.length, 1, 'no status for anyone else');
 await x.say(OWNER, '#sl 一下');assert.equal(x.sent.length, 1, 'only the bare command');
 assert.deepEqual(await x.say(OWNER, '#sl', 'private'), { status: true });assert.equal(x.sent.length, 2, 'works in private too');});

test('the status answers while paused and names uptime, QQ connection, calls and the models', async t => {
 const x = setup(t, c => ({ ...c, paused: true, participation: { ...c.participation, dailyCalls: -1 } }));
 for (let i = 0; i < 3; i++) x.s.create('usage', { role: 'observer', groupId: GROUP, startedAt: Date.now() - 1000, status: 'completed' });
 await x.say(OWNER, '#sl', 'private');
 const lines = x.sent[0].text.split('\n');
 assert.equal(lines[0], 'QQ群友 · 已暂停 · 正式模式');assert.match(lines[1], /^已运行 \d+(天\d+小时|小时\d+分|分钟)$/);
 assert.equal(lines[2], 'QQ：已连接 · 账号已验证，正在接收消息 · 2分钟前有事件');assert.equal(lines[3], '近 24 小时调用 3 / 不限');
 assert.equal(lines[4], '观察员 DeepSeek deepseek-flash（长会话）');assert.match(lines[5], /^回复 .+ Claude/);assert.equal(lines[6], '画面识别 GPT gpt-6.1-sol low');});
