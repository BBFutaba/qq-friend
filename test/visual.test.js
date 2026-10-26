import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { fixtureStore, GROUP } from './fixture.js';
import { Engine } from '../src/engine.js';
import { createApp } from '../src/server.js';
import { notesToCatalogue, applyCatalog, editEntry, knownFor, catalogueEntries } from '../src/visual.js';

const hash = n => String(n).repeat(64).slice(0, 64);
const media = (s, n, source, description, editedAt = 1000 + n) => s.create('media', { hash: hash(n), type: 'image', mime: 'image/png', description, source, editedAt, stored: true }, `media:${hash(n)}`);

test('only interpretations the owner wrote are catalogued, once per wording', () => {
 const s = fixtureStore();media(s, 1, 'owner', '这是小鲨鱼在哭');media(s, 2, 'model', '一只猫');media(s, 3, 'owner', '');media(s, 4, 'owner', '小鲨鱼戴墨镜');
 assert.deepEqual(notesToCatalogue(s).map(m => m.hash), [hash(1), hash(4)]);
 applyCatalog(s, { entries: [] }, notesToCatalogue(s));assert.deepEqual(notesToCatalogue(s), [], 'done, even with nothing to keep');
 assert.equal(notesToCatalogue(s, true).length, 2, 'a rebuild reads them all again');
 s.update(`media:${hash(4)}`, { description: '小鲨鱼戴墨镜耍酷', editedAt: 9999 });assert.deepEqual(notesToCatalogue(s).map(m => m.hash), [hash(4)], 'a rewritten note is read again');});

test('catalogue answers make or merge entries by name or alias; an entry the owner edited only gains pictures', () => {
 const s = fixtureStore(), items = [1, 2, 3].map(n => media(s, n, 'owner', `note ${n}`));
 applyCatalog(s, { entries: [{ name: '小鲨鱼', aliases: ['鲨鲨'], look: '蓝色鲨鱼玩偶，大眼睛', notes: '群主的头像角色', images: [1, 2] }, { name: '路人', images: [3] }, { name: '', look: 'x' }] }, items);
 assert.deepEqual(catalogueEntries(s), [{ name: '小鲨鱼', aliases: ['鲨鲨'], look: '蓝色鲨鱼玩偶，大眼睛', notes: '群主的头像角色' }], 'no look or notes: not kept');
 const [shark] = s.list('visual');assert.deepEqual(shark.hashes, [hash(1), hash(2)]);assert.equal(shark.source, 'model');
 applyCatalog(s, { entries: [{ name: '鲨鲨', look: '蓝色鲨鱼，常戴墨镜', images: [3] }] }, items);
 assert.equal(s.list('visual').length, 1, 'an alias is the same entry');assert.equal(s.get(shark.id).look, '蓝色鲨鱼，常戴墨镜');assert.equal(s.get(shark.id).hashes.length, 3);
 const edited = editEntry(s, shark.id, { name: '鲨鱼宝宝', aliases: '小鲨鱼，鲨鲨', look: '主人写的外观', notes: '主人写的说明', version: s.get(shark.id).version });assert.equal(edited.source, 'owner');
 applyCatalog(s, { entries: [{ name: '小鲨鱼', look: '模型想改', notes: '模型想改', images: [1] }] }, [media(s, 5, 'owner', 'n5')]);
 assert.deepEqual([s.get(shark.id).look, s.get(shark.id).notes, s.get(shark.id).hashes.includes(hash(5))], ['主人写的外观', '主人写的说明', true]);
 applyCatalog(s, { entries: [{ name: '另一个', look: '红色', images: [] }] }, []);
 assert.throws(() => editEntry(s, s.list('visual').find(e => e.name === '另一个').id, { name: '鲨鲨' }), /同名/);
 assert.throws(() => applyCatalog(s, { nope: 1 }, []), /格式无效/);});

test('image analysis gets the catalogue, most-seen first and bounded', () => {
 const s = fixtureStore();
 for (let i = 0; i < 40; i++) s.create('visual', { name: `角色${i}`, aliases: [], look: '特征'.repeat(40), notes: '', hashes: Array.from({ length: i % 5 }, (_, k) => hash(k + 1)), source: 'model' }, `visual:${i}`);
 const known = knownFor(s);assert.ok(known.length < 40 && JSON.stringify(known).length <= 3100);assert.equal(known[0].name.length > 0, true);
 assert.ok(known.every((k, i) => i === 0 || s.list('visual').find(e => e.name === known[i - 1].name).hashes.length >= s.list('visual').find(e => e.name === k.name).hashes.length));});

function engine(t, answers) {
 const s = fixtureStore(), calls = [];
 const p = { stop() {}, async call(role, group, spec, prompt, signal, images = []) { calls.push({ role, spec, prompt, images });return role === 'catalog' ? answers.shift() || { entries: [] } : { description: '一只蓝色鲨鱼在哭' }; } };
 const e = new Engine(s, p, Object.assign(new EventEmitter(), { send: async () => { throw Error('no sends'); } }), { ready: () => true, pixels: async h => h === hash(9) ? [] : [`IMG:${h.slice(0, 2)}`], read: async () => ({ images: ['PX'], notes: [{ type: 'image', status: 'pixels_loaded' }], fresh: [] }) });
 t.after(() => { e.stop(); s.close(); });return { s, e, calls };
}
test('the cataloguer sends owner notes four at a time with their pictures to the 画面识别 model, and image analysis uses the result', async t => {
 const x = engine(t, [{ entries: [{ name: '小鲨鱼', look: '蓝色鲨鱼玩偶', notes: '群主头像', images: [1, 5] }] }]);
 for (const n of [1, 2, 3, 4, 9]) media(x.s, n, 'owner', `主人解读 ${n}`);media(x.s, 6, 'model', '模型写的');
 assert.equal(await x.e.catalogue(), 5);
 const runs = x.calls.filter(c => c.role === 'catalog');assert.equal(runs.length, 2);assert.deepEqual(runs[0].spec, x.e.role('perception', x.s.config()));
 assert.deepEqual(runs[0].prompt.data.items.map(i => i.note), ['主人解读 1', '主人解读 2', '主人解读 3', '主人解读 4']);assert.deepEqual(runs[0].images, ['IMG:11', 'IMG:22', 'IMG:33', 'IMG:44']);
 assert.deepEqual(runs[1].prompt.data.items, [{ n: 1, note: '主人解读 9', image: false }], 'no stored picture: the note alone');assert.deepEqual(runs[1].images, []);
 assert.deepEqual(runs[1].prompt.data.catalogue.map(e => e.name), ['小鲨鱼'], 'the next batch sees what the first one made');
 assert.ok(!JSON.stringify(runs).includes('模型写的'));assert.equal(await x.e.catalogue(), 0, 'nothing left');
 await x.e.describeMedia({ groupId: GROUP, text: '看', media: [{ type: 'image' }] }, x.s.config(), AbortSignal.timeout(5000));
 const seen = x.calls.find(c => c.role === 'perception').prompt;assert.deepEqual(seen.data.known, [{ name: '小鲨鱼', look: '蓝色鲨鱼玩偶', notes: '群主头像' }]);assert.match(seen.system, /known 是主人确认过的/);});

test('the 画面图鉴 API: owner edits, deletes, a background rebuild, and counts in the state', async () => {
 class Bot extends EventEmitter { state = { status: 'mock' }; start() {} stop() {} }
 const s = fixtureStore();media(s, 1, 'owner', '小鲨鱼');const entry = s.create('visual', { name: '小鲨鱼', aliases: [], look: '蓝', notes: '', hashes: [hash(1)], source: 'model' }, 'visual:a');
 const app = createApp({ store: s, secrets: { adminToken: 'admin' }, onebot: new Bot(), providers: { stop() {}, async call() { return { entries: [] }; } } }), addr = await app.start(0), base = `http://127.0.0.1:${addr.port}`;
 try {
  const login = await fetch(base + '/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"token":"admin"}' }), headers = { Cookie: login.headers.get('set-cookie').split(';')[0], 'Content-Type': 'application/json', 'X-QQ-Friend': '1' };
  const call = async (path, method, body) => (await fetch(base + '/api/' + path, { method, headers, body: JSON.stringify(body) })).json();
  const st = await (await fetch(base + '/api/state', { headers })).json();assert.deepEqual([st.visuals.length, st.visualTodo, st.ownerNotes], [1, 1, 1]);
  const edited = await call('visual', 'PUT', { id: entry.id, version: entry.version, name: '鲨鲨', look: '蓝色', notes: '头像', aliases: '小鲨鱼' });assert.deepEqual([edited.name, edited.aliases, edited.source], ['鲨鲨', ['小鲨鱼'], 'owner']);
  assert.equal((await call('visual/rebuild', 'POST', {})).count, 1);
  assert.equal((await call('visual', 'DELETE', { id: entry.id })).ok, true);assert.equal(s.list('visual').length, 0);
 } finally { await app.close(); }});
