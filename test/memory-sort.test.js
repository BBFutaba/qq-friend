import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { fixtureStore, GROUP } from './fixture.js';
import { Engine } from '../src/engine.js';
import { createApp } from '../src/server.js';
import { sortBatches, planItems, applyItem } from '../src/memory-sort.js';
import { rankMemories } from '../src/context.js';

const A = '10000007', B = '10000008';
const mem = (s, content, extra = {}) => s.create('memory', { groupId: GROUP, userId: A, scope: 'shared', persona: '', content, category: 'fact', key: '', status: 'approved', debug: false, sourceIds: [], actor: 'owner', ...extra });

test('the audit covers live memories only, a person at a time', () => {
 const s = fixtureStore();
 for (let i = 0; i < 5; i++) mem(s, `A 的事实 ${i}`);mem(s, 'B 的事实', { userId: B });mem(s, '群里的事', { userId: '', category: 'event' });
 mem(s, '过期话题', { category: 'topic', expiresAt: Date.now() - 1000 });mem(s, '已归档', { archived: true });mem(s, '待审', { status: 'pending' });mem(s, '拒绝', { status: 'rejected' });mem(s, '调试分支', { debug: true });mem(s, '别的群', { groupId: '30000009' });
 const batches = sortBatches(s, GROUP, false, 3);
 assert.deepEqual(batches.map(b => [b[0].userId, b.length]).sort(), [['', 1], [A, 2], [A, 3], [B, 1]]);});

test('plan items keep only real, safe changes', () => {
 const s = fixtureStore(), a1 = mem(s, '喜欢原神，经常玩原神', { key: 'member:1:游戏' }), a2 = mem(s, '爱玩原神'), a3 = mem(s, '今天在聊天气', { category: 'topic' }), b1 = mem(s, 'B 喜欢猫', { userId: B }), p = mem(s, '有点傲娇', { scope: 'persona', persona: 'claude', category: 'impression' });
 const items = planItems([a1, a2, a3, b1, p], { items: [
  { id: a2.id, action: 'merge', into: a1.id, reason: '重复' }, { id: a1.id, action: 'update', content: '喜欢玩原神', key: 'member:10000007:喜欢的游戏' },
  { id: a3.id, action: 'archive', category: 'topic' }, { id: b1.id, action: 'merge', into: a1.id }, { id: 'nope', action: 'expire' }, { id: a1.id, action: 'expire' },
  { id: b1.id, action: 'keep', category: 'impression' }, { id: p.id, action: 'update', content: '有点傲娇' }] });
 assert.deepEqual(items.map(i => [i.memoryId, i.action]), [[a2.id, 'merge'], [a1.id, 'update'], [a3.id, 'archive']], 'cross-person merge, unknown id, second item, impossible category and no-op rewrite dropped');
 assert.equal(items[0].into, a1.id);assert.deepEqual(items[1].after, { category: 'fact', key: 'member:10000007:喜欢的游戏', content: '喜欢玩原神' });assert.throws(() => planItems([a1], {}), /格式无效/);});

test('applying merges and expires, archives, rewrites, keeps protection and actor, and skips changed memories', () => {
 const s = fixtureStore(), a1 = mem(s, '喜欢原神，经常玩原神'), a2 = mem(s, '爱玩原神', { actor: 'memory-agent', protected: false }), a3 = mem(s, '今天在聊天气', { category: 'topic' });
 const [merge, update, archive] = planItems([a1, a2, a3], { items: [{ id: a2.id, action: 'merge', into: a1.id }, { id: a1.id, action: 'update', content: '喜欢玩原神' }, { id: a3.id, action: 'archive' }] });
 assert.ok(applyItem(s, update));assert.ok(applyItem(s, merge));assert.ok(applyItem(s, archive));
 assert.deepEqual([s.get(a1.id).content, s.get(a1.id).actor], ['喜欢玩原神', 'owner']);
 assert.ok(s.get(a2.id).expiresAt <= Date.now());assert.equal(s.get(a2.id).mergedInto, a1.id);assert.equal(s.get(a2.id).protected, false, 'an unprotected memory stays unprotected');
 assert.equal(s.get(a3.id).archived, true);assert.equal(s.get(a3.id).content, '今天在聊天气');
 assert.equal(s.list('revision', r => r.actor === 'owner-sort').length, 3);
 assert.equal(applyItem(s, update), false, 'the version moved on: skipped');});

test('an archived memory is recalled only when the chat clearly touches it, at most three at a time', () => {
 const s = fixtureStore(), c = { ...s.config(), debug: false }, members = [{ userId: A, name: '小明', nickname: '小明' }];
 const live = mem(s, '喜欢猫'), archived = mem(s, '上周在讨论显卡涨价和矿卡翻新', { archived: true });
 const rank = text => rankMemories(s.list('memory'), [{ userId: A, text }], members, GROUP, 'gpt', c).map(m => m.id);
 assert.ok(rank('随便聊聊').includes(live.id));assert.ok(!rank('随便聊聊').includes(archived.id), 'its person speaking is not enough');
 assert.ok(!rank('显卡').includes(archived.id), 'one shared pair is not enough');assert.ok(rank('最近显卡涨价好厉害，矿卡还能买吗').includes(archived.id));
 for (let i = 0; i < 5; i++) mem(s, `显卡涨价话题 ${i} 矿卡`, { archived: true });
 assert.equal(rank('显卡涨价了，矿卡呢').filter(id => s.get(id).archived).length, 3);});

function engine(t, answer) {
 const s = fixtureStore(), c = s.config();c.debug = false;s.saveConfig(c);const calls = [];
 const e = new Engine(s, { stop() {}, async call(role, group, spec, prompt) { calls.push({ role, spec, prompt });return answer(prompt); } }, new EventEmitter());
 t.after(() => { e.stop(); s.close(); });return { s, e, calls };
}
const settle = async e => { for (let i = 0; i < 100 && e.sorting; i++) await new Promise(r => setTimeout(r, 5)); };
test('a sorting pass runs a person at a time with the memory model and leaves a plan to review', async t => {
 const x = engine(t, p => ({ items: p.data.memories.rows.filter(r => r[5].includes('重复')).map(r => ({ id: r[0], action: 'archive' })) }));
 mem(x.s, '重复一');mem(x.s, '不变');mem(x.s, 'B 重复', { userId: B });
 const plan = x.e.sortMemories(GROUP);assert.equal(plan.status, 'running');assert.equal(plan.total, 3);assert.throws(() => x.e.sortMemories(GROUP), /正在整理/);
 await settle(x.e);
 const done = x.s.get(plan.id);assert.equal(done.status, 'ready');assert.deepEqual(done.items.map(i => i.after.content).sort(), ['B 重复', '重复一']);
 assert.equal(x.calls.length, 2);assert.deepEqual(x.calls[0].spec, x.e.role('memory', x.s.config()));assert.match(x.calls[0].prompt.system, /审计并精简/);
 x.e.sortMemories(GROUP);await settle(x.e);assert.equal(x.s.get(plan.id).status, 'discarded', 'a new pass replaces an unapplied plan');
 assert.throws(() => x.e.sortMemories('30000009'), /不存在/);});

test('the sort API: start, apply the ticked items (a merge only with its kept memory\'s rewrite), discard, archive by hand', async () => {
 class Bot extends EventEmitter { state = { status: 'mock' }; start() {} stop() {} }
 const s = fixtureStore(), c = s.config();c.debug = false;s.saveConfig(c);
 const a1 = mem(s, '喜欢原神，经常玩原神'), a2 = mem(s, '爱玩原神'), a3 = mem(s, '今天在聊天气'), a4 = mem(s, '别的事实');
 const answer = { items: [{ id: a2.id, action: 'merge', into: a1.id }, { id: a1.id, action: 'update', content: '喜欢玩原神' }, { id: a3.id, action: 'archive' }] };
 const app = createApp({ store: s, secrets: { adminToken: 'admin' }, onebot: new Bot(), providers: { stop() {}, async call() { return answer; } } }), addr = await app.start(0), base = `http://127.0.0.1:${addr.port}`;
 try {
  const login = await fetch(base + '/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"token":"admin"}' }), headers = { Cookie: login.headers.get('set-cookie').split(';')[0], 'Content-Type': 'application/json', 'X-QQ-Friend': '1' };
  const call = async (path, method, body) => (await fetch(base + '/api/' + path, { method, headers, body: JSON.stringify(body) })).json();
  const plan = await call('memory/sort', 'POST', { groupId: GROUP });for (let i = 0; i < 100 && s.get(plan.id).status === 'running'; i++) await new Promise(r => setTimeout(r, 5));
  const ready = s.get(plan.id), id = a => ready.items.find(i => i.memoryId === a.id).id;
  assert.deepEqual(await call('memory/sort/apply', 'POST', { id: plan.id, itemIds: [id(a2), id(a3)] }), { applied: 1, skipped: 1 }, 'the merge waits for its rewrite');
  assert.equal(s.get(a2.id).expiresAt, undefined);assert.equal(s.get(a3.id).archived, true);
  const st = await (await fetch(base + '/api/state', { headers })).json();assert.equal(st.memories.length, 4);assert.equal(st.memorySorts[0].status, 'applied');
  const again = await call('memory/sort', 'POST', { groupId: GROUP });for (let i = 0; i < 100 && s.get(again.id).status === 'running'; i++) await new Promise(r => setTimeout(r, 5));
  assert.equal((await call('memory/sort', 'DELETE', { id: again.id })).ok, true);assert.equal(s.get(again.id).status, 'discarded');
  const back = await call('memory/archive', 'PUT', { id: a3.id, version: s.get(a3.id).version, archived: false });assert.equal(back.archived, false);
  assert.match((await call('memory/archive', 'PUT', { id: a3.id, version: s.get(a3.id).version, archived: 'yes' })).error, /归档状态无效/);
 } finally { await app.close(); }});

test('the dashboard gets every memory, not only the newest 300', async () => {
 class Bot extends EventEmitter { state = { status: 'mock' }; start() {} stop() {} }
 const s = fixtureStore();for (let i = 0; i < 320; i++) mem(s, `事实 ${i}`);
 const app = createApp({ store: s, secrets: { adminToken: 'admin' }, onebot: new Bot(), providers: { stop() {} } }), addr = await app.start(0), base = `http://127.0.0.1:${addr.port}`;
 try {
  const login = await fetch(base + '/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"token":"admin"}' });
  const st = await (await fetch(base + '/api/state', { headers: { Cookie: login.headers.get('set-cookie').split(';')[0], 'X-QQ-Friend': '1' } })).json();assert.equal(st.memories.length, 320);
 } finally { await app.close(); }});
