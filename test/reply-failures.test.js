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

test('tool calls after tools were switched off are rejected, and no reply runs more than 12 rounds', async () => {
 const off = await run([use('web_search', { query: 'a' }), use('web_search', { query: 'b' }, 'u2')], { audit: () => [] });
 assert.match(off.result.message, /工具已关闭仍请求 web_search/);
 const endless = await run([n => use('web_search', { query: 'q' + n }, 'u' + n)]);assert.match(endless.result.message, /工具查询轮数过多/);assert.equal(endless.bodies.length, 12);});
