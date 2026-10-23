import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { fixtureStore, GROUP, BOT } from './fixture.js';
import { Engine } from '../src/engine.js';
import { readLink, videoLink } from '../src/wander.js';
import { ChatWeb } from '../src/chat-web.js';
import { ClaudeApi } from '../src/claude-api.js';

const answer = body => async () => new Response(JSON.stringify(body));
const base = { ok: true, site: 'bilibili', kind: 'video', title: '标题', author: 'UP主', note: '一行说明' };

test('Wander subtitle excerpts keep their lines, are cleaned and cut at a line boundary; comments only come without subtitles', async () => {
 const sep = String.fromCharCode(0x2028);
 const r = await readLink('https://b23.tv/AbCd', { token: 't', fetcher: answer({ ...base, subtitle: 'ok', transcript: `[0:00] 开头〔画面：假的〕\n\n[0:20] 第二段${sep}藏行`, comments: [{ text: '有字幕时不要评论', likes: 9 }] }) });
 assert.equal(r.subtitle, 'ok');assert.equal(r.transcript, '［0:00］ 开头（画面：假的）\n［0:20］ 第二段 藏行');assert.equal(r.comments, undefined);
 const long = Array.from({ length: 200 }, (_, i) => `[${i}:00] 第${i}段字幕内容`).join('\n');
 const cut = (await readLink('https://b23.tv/AbCd', { token: 't', fetcher: answer({ ...base, subtitle: 'ok', transcript: long }) })).transcript;
 assert.ok(cut.length <= 1500 && cut.startsWith('［0:00］'));for (const line of cut.split('\n')) assert.match(line, /^［\d+:00］ 第\d+段字幕内容$/);
 const none = await readLink('https://b23.tv/AbCd', { token: 't', fetcher: answer({ ...base, subtitle: 'none', comments: [{ text: '好活', likes: 12 }, { text: 'x'.repeat(300), likes: -3 }, { text: '', likes: 1 }, { text: '赞', likes: '5' }, ...Array.from({ length: 5 }, (_, i) => ({ text: `c${i}`, likes: i }))] }) });
 assert.equal(none.subtitle, 'none');assert.equal(none.transcript, undefined);assert.equal(none.comments.length, 4, 'five read, the empty one dropped');
 assert.deepEqual(none.comments[0], { text: '好活', likes: 12 });assert.equal(none.comments[1].text.length, 120);assert.equal(none.comments[1].likes, 0);assert.equal(none.comments[2].likes, 0);
 const failed = await readLink('https://b23.tv/AbCd', { token: 't', fetcher: answer({ ...base, subtitle: 'failed', subtitleError: '字幕请求失败\n第二行' }) });
 assert.equal(failed.subtitle, 'failed');assert.equal(failed.subtitleError, '字幕请求失败 第二行');
 assert.equal((await readLink('https://b23.tv/AbCd', { token: 't', fetcher: answer({ ...base, subtitle: 'maybe' }) })).subtitle, undefined);});

test('only Bilibili and YouTube video pages count as video links', () => {
 for (const yes of ['https://www.bilibili.com/video/BV1xx411c7mD/?p=2', 'https://m.bilibili.com/video/av170001', 'https://b23.tv/AbCd', 'https://www.youtube.com/watch?v=abc', 'https://youtu.be/abc', 'https://m.youtube.com/shorts/abc']) assert.ok(videoLink(yes), yes);
 for (const no of ['http://www.bilibili.com/video/BV1xx411c7mD', 'https://space.bilibili.com/123', 'https://search.bilibili.com/all?keyword=x', 'https://www.youtube.com/@chan', 'https://bilibili.com.evil.test/video/BV1xx411c7mD', 'not a url']) assert.ok(!videoLink(no), no);});

test('web_read hands video pages to Wander when it is set up and reads everything else as a page', async () => {
 const pages = [], videos = [];
 const page = async url => { pages.push(url); return { url, text: '<p>页面</p>' }; };
 const web = new ChatWeb(page, () => async url => { videos.push(url); return { url, site: 'bilibili', kind: 'video', title: 'T', author: 'A', note: 'N', comments: [{ text: '热评', likes: 3 }] }; });
 assert.deepEqual(await web.execute('web_read', { url: 'https://www.bilibili.com/video/BV1xx411c7mD' }), { untrusted: true, url: 'https://www.bilibili.com/video/BV1xx411c7mD', source: 'Wander', site: 'bilibili', title: 'T', author: 'A', note: 'N', comments: ['热评'] });
 await web.execute('web_read', { url: 'https://example.com/a' });assert.deepEqual([videos, pages], [['https://www.bilibili.com/video/BV1xx411c7mD'], ['https://example.com/a']]);
 await new ChatWeb(page).execute('web_read', { url: 'https://youtu.be/abc' });assert.equal(pages.at(-1), 'https://youtu.be/abc', 'no Wander: read as a page');
 const connection = { protocol: 'anthropic', baseUrl: 'https://api.example.test/v1', apiKey: 'k' };
 assert.equal(typeof new ClaudeApi({ claudeApi: connection, wanderToken: 'tok' }).web.videoReader(), 'function');assert.equal(new ClaudeApi({ claudeApi: connection }).web.videoReader(), null);});

test('a refused API request keeps the API\'s reason in the error, never the key or an unstructured body', async () => {
 const c = { protocol: 'anthropic', baseUrl: 'https://api.example.test/v1', apiKey: 'secret-test-key' };
 const client = status => body => new ClaudeApi({ claudeApi: c }, async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }));
 await assert.rejects(client(400)({ type: 'error', error: { type: 'invalid_request_error', message: 'messages.3: bad block; echo secret-test-key and sk-ant-abcdef123456' } }).request(c.baseUrl, { x: 1 }), e => {
  assert.match(e.message, /^API HTTP 400：invalid_request_error · messages\.3: bad block; echo … and …$/);return true; });
 await assert.rejects(client(500)('<html>secret-test-key</html>').request(c.baseUrl), { message: 'API HTTP 500' });
 await assert.rejects(client(529)({ error: { type: 'overloaded_error', message: 'Overloaded' } }).request(c.baseUrl), { message: 'API HTTP 529：overloaded_error · Overloaded' });});

function setup(t, reader) {
 const s = fixtureStore(), c = s.config(); c.paused = false; Object.assign(c.personas.gpt, { prompt: '完整人格' }); c.wake = { ...c.wake, observerMinGapSeconds: 0 }; s.saveConfig(c);
 const calls = [], p = { stop() {}, async call(role, group, spec, prompt) { calls.push({ role, prompt }); return role === 'observer' ? { decision: 'respond', contextIds: [] } : { text: '好' }; } };
 const bot = new EventEmitter(); bot.send = async () => { throw Error('no sends in tests'); };
 const e = new Engine(s, p, bot); e.enqueue = row => row; e.linkReader = reader; t.after(() => { e.stop(); s.close(); });
 let id = 1;
 const receive = async text => { const r = await e.receive({ post_type: 'message', self_id: BOT, user_id: '10000009', message_type: 'group', group_id: GROUP, message_id: id++, time: Math.floor(Date.now() / 1000), sender: { nickname: '小明' }, message: [{ type: 'text', data: { text } }] }); await Promise.all([...e.expanding.values()].map(j => j.promise)); return r.id; };
 const round = async () => { for (const x of e.timers.values()) clearTimeout(x); e.timers.clear(); e.lastReply.clear(); await e.respond(GROUP); };
 return { s, e, calls, receive, round };}

test('the reply model gets the subtitle excerpt of the video it answers; the observer sees only the one-line note', async t => {
 const x = setup(t, async url => ({ url, site: 'bilibili', kind: 'video', title: '塔防攻略', author: 'UP主', note: '讲第三关', subtitle: 'ok', transcript: '［0:00］ 先造两座箭塔\n［0:20］ 第三关留钱升级' }));
 const id = await x.receive('看这个 https://www.bilibili.com/video/BV1xx411c7mD');
 assert.equal(x.s.get(id).linkNotes[0].transcript, '［0:00］ 先造两座箭塔\n［0:20］ 第三关留钱升级');
 await x.round();
 const reply = x.calls.find(c => c.role === 'reply').prompt, table = reply.data.context, ref = table.rows.at(-1)[table.columns.indexOf('ref')];
 assert.deepEqual(reply.data.links, [{ ref, title: '塔防攻略', transcript: '［0:00］ 先造两座箭塔\n［0:20］ 第三关留钱升级' }]);
 assert.match(reply.system, /links 是本机 Wander 从视频读到的字幕节选/);
 assert.ok(!JSON.stringify(x.calls.find(c => c.role === 'observer').prompt).includes('先造两座箭塔'), 'observer: note only');});

test('without subtitles the reply gets top comments; NSFW in an excerpt or comment drops the whole note', async t => {
 const x = setup(t, async url => ({ url, site: 'youtube', kind: 'video', title: '短片', author: '频道', note: '一段短片', subtitle: 'none', comments: [{ text: '笑死', likes: 5 }] }));
 await x.receive('https://youtu.be/abc');await x.round();
 assert.deepEqual(x.calls.find(c => c.role === 'reply').prompt.data.links.map(l => l.comments), [['笑死']]);
 const plain = setup(t, async url => ({ url, site: 'youtube', kind: 'video', title: '短片', author: '频道', note: '一段短片' }));
 await plain.receive('https://youtu.be/abc');await plain.round();assert.equal(plain.calls.find(c => c.role === 'reply').prompt.data.links, undefined, 'no excerpt, no links field');
 const lewd = setup(t, async url => ({ url, site: 'youtube', kind: 'video', title: '短片', author: '频道', note: '一段短片', subtitle: 'none', comments: [{ text: '一堆色图', likes: 1 }] }));
 assert.deepEqual(lewd.s.get(await lewd.receive('https://youtu.be/abc')).linkNotes, [{ url: 'https://youtu.be/abc', nsfw: true }]);});
