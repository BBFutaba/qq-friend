import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { fixtureStore, GROUP, BOT, OWNER } from './fixture.js';
import { Engine } from '../src/engine.js';
import { visibleMemory } from '../src/memory-policy.js';

const FRIEND = '10000005', PRIVATE = `private:${FRIEND}`;
function setup(t, memory = () => ({ operations: [] })) {
 const s = fixtureStore(), c = s.config(); c.paused = false; c.debug = false; c.privateAllowlist = [OWNER, FRIEND]; Object.assign(c.personas.gpt, { prompt: '完整人格' });
 c.participation = { ...c.participation, cooldownSeconds: 600, hourlyReplies: 1 }; c.wake = { ...c.wake, observerMinGapSeconds: 3600 }; s.saveConfig(c);
 const calls = [], p = { stop() {}, async call(role, group, spec, prompt) { calls.push({ role, group, prompt }); return role === 'observer' ? { decision: 'respond', contextIds: [] } : role === 'memory' ? memory(prompt) : { text: '好' }; } };
 const bot = new EventEmitter(); bot.send = async () => { throw Error('no sends in tests'); };
 const e = new Engine(s, p, bot); e.enqueue = row => row; t.after(() => { e.stop(); s.close(); });
 let id = 1;
 const receive = async (text, where = 'private') => (await e.receive({ post_type: 'message', self_id: BOT, user_id: FRIEND, message_type: where, ...(where === 'group' ? { group_id: GROUP } : {}), message_id: id++, time: Math.floor(Date.now() / 1000), sender: { nickname: '小红' }, message: [{ type: 'text', data: { text } }] })).id;
 const quiet = () => { for (const x of e.timers.values()) clearTimeout(x); e.timers.clear(); };
 return { s, e, calls, receive, quiet };}

test('a whitelisted private chat is answered through the cooldown, the hourly reply cap and observer pacing that hold a group back', async t => {
 const x = setup(t);
 for (const gid of [PRIVATE, GROUP]) { x.s.create('outbox', { groupId: gid, category: 'reply', status: 'sent', createdAt: Date.now() - 60000, receipts: [] }); x.e.lastReply.set(gid, Date.now()); }
 await x.receive('在吗，想问你个事');x.quiet();await x.e.respond(PRIVATE);
 assert.equal(x.calls.filter(c => c.role === 'reply' && c.group === PRIVATE).length, 1, 'private: replied');
 await x.receive('群里随便聊聊', 'group');x.quiet();await x.e.respond(GROUP);
 assert.equal(x.calls.filter(c => c.group === GROUP).length, 0, 'group: still held by cooldown and the hourly cap');
 x.e.lastReply.delete(GROUP);await x.e.respond(GROUP);assert.equal(x.calls.filter(c => c.group === GROUP).length, 0, 'group: hourly cap alone still holds');});

test('private chat memories belong to the account, stay out of groups, and never touch its group memories', async t => {
 let offered;
 const x = setup(t, prompt => { offered = prompt.data.memories.rows.map(r => r[0]); const src = prompt.data.messages[0].id;
  return { operations: [{ action: 'update', targetId: groupFact.id, targetVersion: groupFact.version, userId: FRIEND, scope: 'shared', category: 'fact', key: `member:${FRIEND}:喜欢的游戏`, content: '其实不喜欢塔防了', sourceIds: [src] },
   { action: 'add', userId: '', scope: 'shared', category: 'fact', key: `member:${FRIEND}:城市`, content: '住在杭州', sourceIds: [src] }] }; });
 const groupFact = x.s.memory({ groupId: GROUP, userId: FRIEND, scope: 'shared', category: 'fact', key: `member:${FRIEND}:喜欢的游戏`, content: '喜欢塔防', sourceIds: [], protected: false }, 'owner');
 await x.receive('我搬到杭州了', 'group');
 for (const text of ['我其实不太玩塔防了', '最近搬到杭州了', '工作也换了', '周末一般在家']) await x.receive(text);
 for (let i = 0; i < 100 && (!x.calls.some(c => c.role === 'memory') || x.e.running.has(`memory:${PRIVATE}`)); i++) await new Promise(r => setTimeout(r, 10));
 x.quiet();
 assert.deepEqual(x.calls.filter(c => c.role === 'memory').map(c => c.group), [PRIVATE], 'four private messages are enough for a private batch');
 assert.ok(!offered.includes(groupFact.id), 'group memories are not offered to private extraction');
 assert.ok(x.e.context(PRIVATE, 'gpt', x.s.config()).memories.some(m => m.id === groupFact.id), 'the private reply can still read them');
 assert.equal(x.s.get(groupFact.id).version, groupFact.version);assert.equal(x.s.list('memory-change').length, 0, 'no change proposed to the group memory');
 const [mine] = x.s.list('memory', m => m.groupId === PRIVATE);
 assert.equal(mine.userId, FRIEND, 'a private fact is about the account');assert.equal(mine.status, 'pending');assert.equal(mine.content, '住在杭州');
 x.s.update(mine.id, { status: 'approved' });const approved = x.s.get(mine.id), c = x.s.config();
 assert.ok(visibleMemory(approved, PRIVATE, 'gpt', c));assert.ok(!visibleMemory(approved, GROUP, 'gpt', c), 'never shown in a group');
 assert.ok(!x.e.context(GROUP, 'gpt', c).memories.some(m => m.id === mine.id));
 assert.throws(() => x.s.proposeMemoryChange({ action: 'update', targetId: groupFact.id, targetVersion: groupFact.version, groupId: PRIVATE, userId: FRIEND, scope: 'shared', content: 'x', sourceIds: [x.s.list('message', m => m.groupId === PRIVATE)[0].id], debug: false }), /范围/, 'the store refuses a private write to a group memory');});
