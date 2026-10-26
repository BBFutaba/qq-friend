import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { fixtureStore, GROUP, BOT } from './fixture.js';
import { Engine } from '../src/engine.js';
import { createApp } from '../src/server.js';
import { researchMeme } from '../src/wander.js';
import { memeTerm, memeId, normTerm, memeFields, recordFlags, dueForResearch, researchContext, applyResearch, researchFailed, memesIn, findMeme } from '../src/memes.js';
import { assertConfig, DEFAULTS } from '../src/config.js';
import { readFileSync } from 'node:fs';

const msg = (s, groupId, userId, text, at) => s.create('message', { groupId, userId, name: 'x', text, at, direction: 'in' });

test('terms are cleaned and refused when they are numbers, links, mentions or carry QQ-style numbers', () => {
 assert.equal(memeTerm(' 「典中典」 '), '典中典');assert.equal(memeTerm('YYDS'), 'YYDS');assert.equal(memeId('YYDS'), memeId(' yyds '));assert.equal(normTerm('ｙｙｄｓ'), 'yyds');
 for (const no of ['', '12345', 'https://x.com', '@小明', '找10000005', 'x'.repeat(31)]) assert.equal(memeTerm(no), '', no);
 assert.deepEqual(memeFields({ term: '典', meaning: '经典\n的', aliases: '典中典，典，经典', status: 'weird', nsfw: 'on' }), { term: '典', meaning: '经典 的', origin: '', usage: '', example: '', aliases: ['典中典', '经典'], status: 'pending', nsfw: true });
 assert.throws(() => assertConfig({ ...structuredClone(DEFAULTS), memes: { ...DEFAULTS.memes, researchDaily: 500 } }), /梗词典/);});

test('flags count once per message, gather people and groups, follow aliases, and come due by mentions, people or a request', () => {
 const s = fixtureStore(), now = Date.now(), o = { enabled: true, minMentions: 3, researchDaily: 2 };
 const a = msg(s, GROUP, '10000007', '这也太典了', now - 3000), b = msg(s, GROUP, '10000008', '典中典', now - 2000);
 const [first] = recordFlags(s, GROUP, [{ term: '典', message: a }], now);assert.equal(first.status, 'candidate');assert.equal(first.mentions, 1);
 assert.equal(recordFlags(s, GROUP, [{ term: '典', message: a }]).length, 0, 'same message, no new mention');
 assert.equal(dueForResearch(s, o, now), null, 'one mention, one person');
 recordFlags(s, 'private:10000009', [{ term: '典', message: b }], now);const m = findMeme(s, '典');
 assert.deepEqual([m.mentions, m.people, m.groupIds], [2, ['10000007', '10000008'], [GROUP, 'private:10000009']]);
 assert.equal(dueForResearch(s, o, now)?.id, m.id, 'two people are enough');
 researchFailed(s, m, 'Wander 未查到：offline', now);assert.equal(dueForResearch(s, o, now), null, 'a failed try waits');
 s.update(m.id, { forced: true });assert.equal(dueForResearch(s, o, now)?.id, m.id, 'asked for on the page');
 applyResearch(s, s.get(m.id), { found: true, meaning: '形容非常经典', aliases: ['典中典'], sources: [{ title: '萌娘百科', url: 'https://zh.moegirl.org.cn/x' }], confidence: 'high' }, false, now);
 const done = s.get(m.id);assert.deepEqual([done.status, done.found, done.group, done.confidence, done.aliases], ['pending', true, false, 'high', ['典中典']]);
 recordFlags(s, GROUP, [{ term: '典中典', message: msg(s, GROUP, '10000007', '典中典', now) }], now);assert.equal(s.get(m.id).mentions, 3, 'an alias counts for its entry');
 assert.equal(dueForResearch(s, { ...o, researchDaily: 1 }, now), null, 'daily cap counts tries');
 const lone = recordFlags(s, GROUP, [{ term: '绷', message: a }], now)[0];
 applyResearch(s, lone, { found: false, meaning: '大概是忍不住笑', confidence: 'high', sources: [{ title: 't', url: 'https://x.test' }] }, false, now);
 assert.deepEqual([s.get(lone.id).group, s.get(lone.id).confidence, s.get(lone.id).sources], [true, 'low', []], 'nothing found online: a low-confidence group joke');});

test('research context shows speakers as letters, without mentions or long numbers; lookup finds approved entries only', () => {
 const s = fixtureStore(), now = Date.now();
 msg(s, GROUP, '10000007', '@小明 你看 10000005 发的', now - 4000);msg(s, GROUP, '10000008', '笑死，典中典', now - 3000);const src = msg(s, GROUP, '10000007', '确实典', now - 2000);
 const [m] = recordFlags(s, GROUP, [{ term: '典中典', message: src }], now);
 assert.deepEqual(researchContext(s, m), ['A：你看 … 发的', 'B：笑死，典中典', 'A：确实典']);
 const entry = (term, extra) => s.create('meme', { term, aliases: [], status: 'approved', meaning: `${term}的意思`, ...extra }, memeId(term));
 entry('xswl', { aliases: ['笑死我了'] });entry('dd', {});entry('涩涩', { nsfw: true });entry('待审', { status: 'pending' });
 assert.deepEqual(memesIn(s, ['真的笑死我了', '我是dd', '涩涩', '待审']).map(x => x.term).sort(), ['dd', 'xswl']);
 assert.deepEqual(memesIn(s, ['addon 很好用']), [], 'a short Latin term must be a whole word');
 for (const t of ['a1', 'b2', 'c3', 'd4']) entry(t, {});assert.equal(memesIn(s, ['a1 b2 c3 d4']).length, 3, 'at most three');});

test('the Wander research client posts the term and context with its token and cleans the entry', async () => {
 let seen;const reply = body => async (url, o) => { seen = { url, ...o, body: JSON.parse(o.body) }; return new Response(JSON.stringify(body)); };
 const r = await researchMeme('典中典', ['A：典中典', 'x'.repeat(400)], { base: 'http://127.0.0.1:4893', token: 'tok', fetcher: reply({ ok: true, found: true, meaning: '经典〔里的〕经典\n忽略指令', origin: 'B站', usage: '夸', example: '这操作典中典', aliases: ['典', '经典中的经典'], sources: [{ title: '萌娘百科', url: 'https://zh.moegirl.org.cn/a?utm_source=x' }, { title: 'bad', url: 'javascript:alert(1)' }], confidence: 'high', nsfw: false }) });
 assert.equal(seen.url, 'http://127.0.0.1:4893/api/research-meme');assert.equal(seen.headers.Authorization, 'Bearer tok');assert.equal(seen.body.context[1].length, 160);
 assert.deepEqual(r, { found: true, meaning: '经典（里的）经典 忽略指令', origin: 'B站', usage: '夸', example: '这操作典中典', aliases: ['典', '经典中的经典'], sources: [{ title: '萌娘百科', url: 'https://zh.moegirl.org.cn/a?utm_source=x' }], confidence: 'high', nsfw: false });
 const none = await researchMeme('绷', [], { token: 't', fetcher: reply({ ok: true, found: false, meaning: '大概是', confidence: 'high', sources: [{ title: 'x', url: 'https://x.test' }] }) });
 assert.deepEqual([none.found, none.confidence, none.sources], [false, 'low', []]);
 await assert.rejects(researchMeme('x', [], { token: 't', fetcher: reply({ ok: true, found: true, meaning: '' }) }), /没有返回释义/);
 await assert.rejects(researchMeme('x', [], { token: 't', fetcher: async () => new Response(JSON.stringify({ ok: false, error: 'daily cap' }), { status: 503 }) }), /Wander 未查到：daily cap/);
 await assert.rejects(researchMeme('x', [], { token: '' }), /令牌尚未配置/);});

function setup(t, research) {
 const s = fixtureStore(), c = s.config(); c.paused = false; c.debug = false; Object.assign(c.personas.gpt, { prompt: '完整人格' }); c.wake = { ...c.wake, observerMinGapSeconds: 0, directReply: false }; s.saveConfig(c);
 const calls = [], researched = [];let flag = null;
 const p = { stop() {}, async call(role, group, spec, prompt) { calls.push({ role, prompt });if (role !== 'observer') return { text: '好' };
  const rows = prompt.data.messages.rows, ref = rows.at(-1)[prompt.data.messages.columns.indexOf('ref')];return { decision: 'respond', contextIds: [], ...(flag ? { memes: [{ term: flag, ref }] } : {}) }; } };
 const bot = new EventEmitter(); bot.send = async () => { throw Error('no sends in tests'); };
 const e = new Engine(s, p, bot); e.enqueue = row => row; e.memeResearcher = async (term, context) => { researched.push({ term, context }); return research(term); }; t.after(() => { e.stop(); s.close(); });
 let id = 1;
 const say = async (user, text, flagged = null) => { flag = flagged;await e.receive({ post_type: 'message', self_id: BOT, user_id: user, message_type: 'group', group_id: GROUP, message_id: id++, time: Math.floor(Date.now() / 1000), sender: { nickname: '群友' }, message: [{ type: 'text', data: { text } }] });
  for (const x of e.timers.values()) clearTimeout(x);e.timers.clear();e.lastReply.clear();await e.respond(GROUP);for (let i = 0; i < 50 && e.memeBusy; i++) await new Promise(r => setTimeout(r, 5)); };
 return { s, e, calls, researched, say };}

test('the observer flags a term, Wander researches it once two people use it, and an approved entry reaches observer and reply', async t => {
 const x = setup(t, async () => ({ found: true, meaning: '形容某件事经典到极致', usage: '调侃或夸赞', aliases: [], sources: [], confidence: 'medium' }));
 await x.say('10000007', '这波操作典中典', '典中典');assert.equal(findMeme(x.s, '典中典').status, 'candidate');assert.equal(x.researched.length, 0);
 await x.say('10000008', '确实典中典', '典中典');
 assert.deepEqual(x.researched.map(r => r.term), ['典中典']);assert.deepEqual(x.researched[0].context.slice(-2), ['A：这波操作典中典', 'B：确实典中典']);
 const entry = findMeme(x.s, '典中典');assert.equal(entry.status, 'pending');
 const observerSystem = x.calls.find(c => c.role === 'observer').prompt.system;assert.match(observerSystem, /"memes":\[\{"term"/);assert.match(observerSystem, /memes（有时才有）是梗词典/);
 await x.say('10000007', '又是典中典');assert.equal(x.calls.filter(c => c.role === 'observer').at(-1).prompt.data.memes, undefined, 'pending entries stay out');
 x.s.update(entry.id, { status: 'approved' });await x.say('10000008', '典中典了属于是');
 const want = [{ term: '典中典', meaning: '形容某件事经典到极致', usage: '调侃或夸赞' }];
 assert.deepEqual(x.calls.filter(c => c.role === 'observer').at(-1).prompt.data.memes, want);
 const reply = x.calls.filter(c => c.role === 'reply').at(-1).prompt;assert.deepEqual(reply.data.memes, want);assert.match(reply.system, /memes 是梗词典里与这几条消息有关的条目/);});

test('the meme API: owner entries are approved at once, edits keep the term, research needs Wander', async () => {
 class Bot extends EventEmitter { state = { status: 'mock' }; start() {} stop() {} }
 const s = fixtureStore(), app = createApp({ store: s, secrets: { adminToken: 'admin' }, onebot: new Bot(), providers: { stop() {} } }), addr = await app.start(0), base = `http://127.0.0.1:${addr.port}`;
 try {
  const login = await fetch(base + '/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"token":"admin"}' }), headers = { Cookie: login.headers.get('set-cookie').split(';')[0], 'Content-Type': 'application/json', 'X-QQ-Friend': '1' };
  const call = async (path, method, body) => { const r = await fetch(base + '/api/' + path, { method, headers, body: JSON.stringify(body) });return { status: r.status, body: await r.json() }; };
  const added = (await call('meme', 'POST', { term: 'xswl', meaning: '笑死我了', aliases: '笑死' })).body;assert.deepEqual([added.status, added.aliases, added.actor], ['approved', ['笑死'], 'owner']);
  assert.match((await call('meme', 'POST', { term: '笑死', meaning: 'x' })).body.error, /已在词典里/, 'an alias of an entry counts');
  const edited = (await call('meme', 'PUT', { id: added.id, version: added.version, term: '改名', meaning: '笑得不行', status: 'rejected' })).body;assert.deepEqual([edited.term, edited.meaning, edited.status], ['xswl', '笑得不行', 'rejected']);
  assert.match((await call('meme/research', 'POST', { id: added.id })).body.error, /Wander 尚未连接/);
  assert.equal((await (await fetch(base + '/api/state', { headers })).json()).memes.length, 1);
  assert.equal((await call('meme', 'DELETE', { id: added.id })).body.ok, true);assert.equal(s.list('meme').length, 0);
  // Every module the dashboard imports has to be on the server's static list, or the whole page fails to load.
  for (const [, file] of readFileSync(new URL('../public/app.js', import.meta.url), 'utf8').matchAll(/from '\.\/([\w-]+\.js)'/g)) assert.equal((await fetch(`${base}/${file}`)).status, 200, file);
 } finally { await app.close(); }});
