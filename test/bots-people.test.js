import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { fixtureStore, GROUP, OWNER, BOT } from './fixture.js';
import { Engine } from '../src/engine.js';
import { normalizeEvent } from '../src/onebot.js';
import { compactPeople } from '../src/context.js';
import { wakeReason, isDirect, stronger, assertWake, WAKE_DEFAULTS } from '../src/wake.js';
import { visibleMemory } from '../src/memory-policy.js';

const OTHER = '30000004', BOTB = '40000004', HUMAN = '10000009';
function setup(t, { wake = {}, decision = () => ({ decision: 'respond', contextIds: [] }) } = {}) {
 const s = fixtureStore(), c = s.config(); c.paused = false; c.groups.push({ id: OTHER, name: '第二群', enabled: true, persona: 'gpt' });
 Object.assign(c.personas.gpt, { prompt: '完整人格' }); c.wake = { ...c.wake, observerMinGapSeconds: 0, botAccounts: [BOTB], botExchanges: 1, ...wake }; s.saveConfig(c);
 const calls = [], p = { stop() {}, async call(role, group, spec, prompt) { calls.push({ role, group, prompt }); return role === 'observer' ? decision(prompt) : { text: '好' }; } };
 const bot = new EventEmitter(); bot.send = async () => { throw Error('no sends in tests'); }; const e = new Engine(s, p, bot), queued = []; e.enqueue = row => { queued.push(row); return row; };
 t.after(() => { e.stop(); s.close(); }); let id = 1;
 const receive = (userId, text, { groupId = GROUP, card = '', nickname = '', at = false } = {}) => e.receive({ post_type: 'message', self_id: BOT, user_id: userId, message_type: 'group', group_id: groupId, message_id: id++, time: Math.floor(Date.now() / 1000), sender: { card, nickname: nickname || `昵称${userId.slice(-2)}` }, message: [...(at ? [{ type: 'at', data: { qq: BOT } }] : []), { type: 'text', data: { text } }] });
 const round = async (groupId = GROUP) => { for (const t of e.timers.values()) clearTimeout(t); e.timers.clear(); e.lastReply.clear(); await e.respond(groupId); };
 return { s, e, calls, queued, receive, round, observers: () => calls.filter(c => c.role === 'observer'), text: m => m.text.trim() };}

test('bot accounts: their own wake reason, never direct, the weakest pending reason, validated settings', () => {
 const opts = { botAccounts: [BOTB], isBotMessage: () => true };
 assert.equal(wakeReason({ groupId: GROUP, userId: BOTB, mentioned: true, replyId: '1' }, opts), 'bot');assert.equal(isDirect('bot'), false);
 assert.equal(stronger('bot', 'chatter'), 'chatter');assert.equal(stronger('chatter', 'bot'), 'chatter');assert.equal(stronger('bot', undefined), 'bot');
 assert.doesNotThrow(() => assertWake({ ...WAKE_DEFAULTS, botAccounts: [BOTB], botExchanges: 0 }));
 for (const bad of [{ botAccounts: ['abc'] }, { botAccounts: [BOTB, BOTB] }, { botAccounts: Array.from({ length: 51 }, (_, i) => String(10000 + i)) }, { botExchanges: 11 }, { botExchanges: -1 }]) assert.throws(() => assertWake({ ...WAKE_DEFAULTS, ...bad }), /其他机器人/, JSON.stringify(bad));});

test('a flagged bot @-ing us goes through the observer, labelled, and is answered at most botExchanges times in a row', async t => {
 const x = setup(t);
 await x.receive(BOTB, '你好呀', { at: true, card: '别家机器人' });await x.round();
 assert.equal(x.observers().length, 1, 'not a direct reply');assert.match(JSON.stringify(x.observers()[0].prompt.data.messages.rows), /别家机器人（机器人）/);assert.equal(x.queued.length, 1);
 await x.receive(BOTB, '你也好呀', { at: true, card: '别家机器人' });assert.equal(x.e.timers.size, 0, 'streak used up: nothing scheduled');await x.round();
 assert.equal(x.observers().length, 1, 'and no model call');assert.equal(x.queued.length, 1);
 await x.receive(HUMAN, '你们俩聊啥呢', { card: '小明' });await x.round();assert.equal(x.queued.length, 2, 'a human resets the streak');
 await x.receive(BOTB, '在聊天气', { card: '别家机器人' });await x.round();assert.equal(x.queued.length, 3, 'so the bot may be answered once more');assert.equal(x.e.botStreak.get(GROUP), 1);});

test('a bot message after a human neither steals nor cancels the reply to the human', async t => {
 const x = setup(t, { wake: { botExchanges: 0 } });
 const human = await x.receive(HUMAN, '今晚打游戏吗', { card: '小明' });await x.receive(BOTB, '【自动回复】查询中', { card: '别家机器人' });await x.round();
 assert.equal(x.queued.at(-1).triggerId, human.id);assert.equal(x.e.latestFor(GROUP, human.id).id, human.id, 'the newer bot message does not supersede it');
 await x.receive(BOTB, '【自动回复】查询完成', { card: '别家机器人' });await x.round();assert.equal(x.queued.length, 1, 'the human message is not answered twice');
 const ctx = x.e.context(GROUP, 'gpt', x.s.config());assert.deepEqual(ctx.messages.map(m => !!m.bot), [false, true, true]);});

test('people are tracked by QQ nickname, and person facts follow the QQ account into other groups', async t => {
 const x = setup(t, { decision: () => ({ decision: 'ignore' }) });
 const m = normalizeEvent({ post_type: 'message', self_id: BOT, user_id: HUMAN, message_type: 'group', group_id: GROUP, message_id: 9, time: 1, sender: { card: '群里叫小明', nickname: '明明' }, message: [{ type: 'text', data: { text: 'hi' } }] }, x.s.config());
 assert.deepEqual([m.name, m.nickname], ['群里叫小明', '明明']);
 const a = await x.receive(HUMAN, '我最喜欢塔防游戏', { card: 'A群名片', nickname: '明明' });await x.receive(HUMAN, '晚上好', { groupId: OTHER, card: 'B群名片', nickname: '明明' });
 assert.deepEqual([x.s.get(`member:${GROUP}:${HUMAN}`).nickname, x.s.get(`member:${OTHER}:${HUMAN}`).name], ['明明', 'B群名片']);
 const fact = x.s.memory({ groupId: GROUP, userId: HUMAN, content: '喜欢塔防游戏', key: `member:${HUMAN}:喜欢的游戏`, sourceIds: [a.id], debug: x.s.config().debug }, 'memory-agent');x.s.update(fact.id, { status: 'approved' });
 const event = x.s.memory({ groupId: GROUP, content: 'A群周五开黑', debug: x.s.config().debug });
 const ctx = x.e.context(OTHER, 'gpt', x.s.config());
 assert.deepEqual(ctx.memories.map(r => r.content), ['喜欢塔防游戏'], 'the person fact crosses over, the group event does not');assert.ok(!ctx.memories.some(r => r.id === event.id));
 assert.deepEqual(compactPeople(ctx.people).columns, ['qq', 'nickname', 'name', 'profile', 'notes']);assert.deepEqual(compactPeople(ctx.people).rows[0].slice(0, 3), [HUMAN, '明明', 'B群名片']);
 const b = await x.receive(HUMAN, '我还是最喜欢塔防游戏', { groupId: OTHER, nickname: '明明' });
 assert.equal(x.s.memory({ groupId: OTHER, userId: HUMAN, content: '喜欢塔防游戏', sourceIds: [b.id], debug: x.s.config().debug }, 'memory-agent').id, fact.id, 'learned again in another group: same memory row');
 const change = x.s.proposeMemoryChange({ targetId: fact.id, targetVersion: x.s.get(fact.id).version, groupId: OTHER, userId: HUMAN, scope: 'shared', persona: '', debug: x.s.config().debug, action: 'update', content: '最喜欢塔防游戏', sourceIds: [b.id] });
 assert.equal(change.sourceGroupId, OTHER);x.s.reviewMemoryChange(change.id, true, change.version);assert.equal(x.s.get(fact.id).content, '最喜欢塔防游戏');
 const privateFact = { ...x.s.get(fact.id), groupId: `private:${HUMAN}` };assert.equal(visibleMemory(privateFact, OTHER, 'gpt', x.s.config()), false, 'what is said in a private chat stays there');});
