import test from 'node:test';
import assert from 'node:assert/strict';
import { ClaudeApi, buildApiRequest } from '../src/claude-api.js';

const connection = { protocol: 'anthropic', baseUrl: 'https://api.example.test/v1', apiKey: 'k' }, spec = { provider: 'claude', transport: 'api', model: 'm', effort: 'low' };
const request = () => buildApiRequest(spec, { system: 's', data: { context: 'x' }, budget: { limitChars: 16000 } }, { webTools: true }, connection, 'reply');
const text = t => ({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: t }] });
const use = (name, input, id = 'u1') => ({ stop_reason: 'tool_use', content: [{ type: 'thinking', thinking: '' }, { type: 'tool_use', id, name, input }] });
async function run(answers, { audit = calls => calls.map(c => c.id), execute = async () => ({ results: [] }) } = {}) {
 const bodies = [], audited = [], executed = [];const client = new ClaudeApi({ claudeApi: connection }, async (_, o) => { bodies.push(JSON.parse(o.body)); const a = answers[Math.min(bodies.length, answers.length) - 1]; return new Response(JSON.stringify(typeof a === 'function' ? a(bodies.length) : a)); });
 client.web = { execute: async (name, args) => { executed.push([name, args]); return execute(name, args); } };
 const result = await client.complete(request(), undefined, { auditTools: async calls => { audited.push(calls.map(c => c.name)); return audit(calls); } }).catch(e => e);
 return { bodies, audited, executed, result };}

test('an unknown tool name gets an error result naming the real tools, and the answer still comes through', async () => {
 const r = await run([use('browse', { url: 'https://example.com' }), text('{"text":"好"}')]);
 assert.equal(r.result.text, '{"text":"好"}');assert.deepEqual(r.audited, [], 'nothing unknown reaches the audit');assert.deepEqual(r.executed, []);
 const result = r.bodies[1].messages.at(-1).content.find(b => b.type === 'tool_result');assert.equal(result.is_error, true);assert.match(result.content, /没有这个工具：browse。只能用 web_search 或 web_read/);
 assert.equal(r.bodies[1].tool_choice.type, 'auto', 'one wrong name does not take the real tools away');assert.deepEqual(r.result.tools, [{ name: 'browse', status: 'failed' }]);});

test("Anthropic's web_fetch name is treated as web_read with only its URL, and still audited", async () => {
 const r = await run([use('web_fetch', { url: 'https://example.com/a', max_length: 9 }), text('{"text":"看了"}')]);
 assert.deepEqual(r.audited, [['web_read']]);assert.deepEqual(r.executed, [['web_read', { url: 'https://example.com/a' }]]);assert.equal(r.result.text, '{"text":"看了"}');});

test('an empty turn is retried once without tools, with a line that allows declining; a second empty turn says exactly what came back', async () => {
 const once = await run([{ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }] }, text('{"text":""}')]);
 assert.equal(once.result.text, '{"text":""}');assert.deepEqual(once.bodies[1].tool_choice, { type: 'none' });
 const last = once.bodies[1].messages.at(-1).content;assert.match(last.at(-1).text, /不想接话就输出 \{"text":""\}/);assert.equal(last.filter(b => b.cache_control).length, 1, 'the moving cache mark sits on the newest block only');
 const toolStop = await run([{ stop_reason: 'tool_use', content: [] }, text('{"text":"嗯"}')]);assert.equal(toolStop.result.text, '{"text":"嗯"}');
 const twice = await run([{ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }] }]);
 assert.equal(twice.bodies.length, 2, 'only one retry');assert.equal(twice.result.message, 'API 未返回文本（end_turn · 内容块：thinking · 第 2 轮），结果已丢弃');});

test('a tool call after the tools were closed gets one error round and the answer still comes through; a second one ends it', async () => {
 const off = await run([use('web_search', { query: 'a' }), use('web_search', { query: 'b' }, 'u2'), text('{"text":"没查到"}')], { audit: () => [] });
 assert.equal(off.result.text, '{"text":"没查到"}');assert.deepEqual(off.audited, [['web_search']], 'a closed round skips the audit');assert.deepEqual(off.executed, []);
 assert.match(off.bodies[2].messages.at(-1).content.find(b => b.type === 'tool_result').content, /已经关了/);
 const stubborn = await run([use('web_search', { query: 'a' }), use('web_search', { query: 'b' }, 'u2'), use('web_search', { query: 'c' }, 'u3')], { audit: () => [] });
 assert.match(stubborn.result.message, /工具已关闭仍请求 web_search/);});

test('after 12 tool rounds the tools close and the model answers from what it found; an endless caller still ends', async () => {
 const wrapped = await run([n => n <= 12 ? use('web_search', { query: 'q' + n }, 'u' + n) : text('{"text":"就查到这些"}')]);
 assert.equal(wrapped.result.text, '{"text":"就查到这些"}');assert.equal(wrapped.bodies.length, 13);assert.deepEqual(wrapped.bodies[12].tool_choice, { type: 'none' });assert.match(JSON.stringify(wrapped.bodies[12].messages.at(-1)), /查询到此为止/);
 const endless = await run([n => use('web_search', { query: 'q' + n }, 'u' + n)]);assert.match(endless.result.message, /工具已关闭仍请求 web_search/);assert.equal(endless.bodies.length, 14);});

test('a failed lookup tells the model why, and the log keeps the reason and host', async () => {
 const r = await run([use('web_read', { url: 'https://news.example.com/a' }), text('{"text":"打不开"}')], { execute: async () => { throw Error('网页返回 HTTP 403'); } });
 assert.match(r.bodies[1].messages.at(-1).content.find(b => b.type === 'tool_result').content, /查询失败（网页返回 HTTP 403）/);
 assert.deepEqual(r.result.tools, [{ name: 'web_read', status: 'failed', reason: '网页返回 HTTP 403', host: 'news.example.com' }]);});
