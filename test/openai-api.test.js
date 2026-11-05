import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { ClaudeApi, buildApiRequest, openaiConnection, toResponses } from '../src/claude-api.js';
import { Providers } from '../src/providers.js';
import { createApp } from '../src/server.js';
import { helperCharacter } from '../src/helper.js';
import { saveBackgroundSpecs, backgroundSpecs } from '../public/model-options.js';
import { fixtureStore, GROUP } from './fixture.js';

const spec = { provider: 'codex', transport: 'api', model: 'gpt-test', effort: 'high' }, prompt = { system: 'Immutable JSON task', data: { text: 'hi' }, budget: { limitChars: 16000 } };
const connection = openaiConnection({ apiKey: 'secret-test-key' }), said = text => ({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] });
const answer = (output, extra = {}) => ({ status: 'completed', output, ...extra });
// A client that answers each round from the list and keeps what was sent.
function client(answers) { const sent = [];const c = new ClaudeApi({ openaiApi: { apiKey: 'secret-test-key' } }, async (url, o) => { sent.push({ url, headers: o.headers, body: JSON.parse(o.body) });return new Response(JSON.stringify(answers[sent.length - 1])); }, { connection: s => openaiConnection(s.openaiApi), label: 'OpenAI API' });return { c, sent }; }
const run = (x, settings = {}) => x.c.complete(buildApiRequest(spec, prompt, settings, connection, 'reply'), undefined, { auditTools: async calls => calls.map(c => c.id) });

test('the OpenAI connection defaults to OpenAI and speaks the Responses API: instructions, input, effort, no storage, flat tools, images', () => {
 assert.equal(openaiConnection({ baseUrl: '' }).baseUrl, 'https://api.openai.com/v1');assert.equal(openaiConnection({ protocol: 'anthropic' }).protocol, 'responses');assert.throws(() => openaiConnection({ baseUrl: 'http://example.test/v1' }));
 const settings = { webTools: true, presets: [{ id: 'default', name: 'd', maxTokens: 4000, temperature: null, topP: null, stop: ['END'], blocks: [] }] };
 const request = buildApiRequest(spec, prompt, settings, connection, 'reply', ['data:image/png;base64,YQ==']), sent = toResponses(request.body);
 assert.equal(request.url, 'https://api.openai.com/v1/responses');assert.equal(sent.instructions, 'Immutable JSON task');assert.equal(sent.store, false);assert.equal(sent.max_output_tokens, 4000);assert.deepEqual(sent.reasoning, { effort: 'high' });assert.equal(sent.prompt_cache_key, 'qq-friend-reply');
 for (const chat of ['messages', 'max_tokens', 'stop', 'reasoning_effort']) assert.equal(sent[chat], undefined, chat);
 assert.deepEqual(sent.tools.map(t => [t.type, t.name, t.strict]), [['function', 'web_search', false], ['function', 'web_read', false]]);assert.equal(sent.tool_choice, 'auto');
 assert.equal(sent.input[0].role, 'user');assert.equal(sent.input[0].content[0].type, 'input_text');assert.deepEqual(sent.input[0].content[1], { type: 'input_image', image_url: 'data:image/png;base64,YQ==' });
 assert.equal(toResponses(buildApiRequest(spec, prompt, {}, connection, 'observer').body).tools, undefined, 'only replies get tools');});

test('a tool round replays reasoning and calls in order, leaves encrypted reasoning out of the text budget, and adds up usage with cache writes', async () => {
 const usage = (input, cached, write, output) => ({ input_tokens: input, output_tokens: output, total_tokens: input + output, input_tokens_details: { cached_tokens: cached, cache_write_tokens: write }, output_tokens_details: { reasoning_tokens: 1 } });
 const x = client([answer([{ type: 'reasoning', id: 'rs_1', summary: [], encrypted_content: 'E'.repeat(200000) }, { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'web_search', arguments: '{"query":"x"}', status: 'completed' }], { usage: usage(10, 4, 3, 2) }),
  answer([{ type: 'message', role: 'assistant', phase: 'commentary', content: [{ type: 'output_text', text: '先想想' }] }, { ...said('{"text":"好"}'), phase: 'final_answer' }], { usage: usage(20, 8, 0, 3) })]);
 let asked;x.c.web = { execute: async (name, args) => { asked = [name, args];return { results: [] }; } };
 const r = await run(x, { webTools: true });
 assert.equal(r.text, '{"text":"好"}', 'commentary is not the answer');assert.equal(r.rounds, 2);assert.deepEqual(r.tools, [{ name: 'web_search', status: 'completed' }]);assert.deepEqual(asked, ['web_search', { query: 'x' }]);
 assert.equal(x.sent[0].url, 'https://api.openai.com/v1/responses');assert.equal(x.sent[0].headers.Authorization, 'Bearer secret-test-key');
 const input = x.sent[1].body.input.slice(-3);assert.deepEqual(input.map(i => i.type), ['reasoning', 'function_call', 'function_call_output']);assert.equal(input[0].encrypted_content.length, 200000);assert.equal(input[2].call_id, 'call_1');assert.deepEqual(JSON.parse(input[2].output), { results: [] });
 assert.deepEqual([r.usage.inputTokens, r.usage.cachedInputTokens, r.usage.cacheWriteInputTokens, r.usage.outputTokens, r.usage.reasoningOutputTokens], [30, 12, 3, 5, 2]);});

test('an unfinished, refused or hosted-tool answer is discarded with its reason; an empty one gets one retry', async () => {
 const fails = async (answers, message) => assert.rejects(run(client(answers)), message);
 await fails([{ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [] }], /未完成内容（max_output_tokens/);
 await fails([{ status: 'failed', error: { code: 'server_error', message: 'x' }, output: [] }], /未完成内容（server_error/);
 await fails([answer([{ type: 'message', content: [{ type: 'refusal', refusal: '不行' }] }])], /模型拒绝回复/);
 await fails([answer([{ type: 'web_search_call', id: 'ws_1' }, said('{"text":"好"}')])], /未开放的工具请求/);
 await fails([answer([{ type: 'function_call', id: 'fc', call_id: 'c', name: 'web_search', arguments: '{"query":"x"}' }])], /工具未开放/);
 const x = client([answer([{ type: 'reasoning', id: 'rs' }]), answer([said('{"text":""}')])]);
 assert.equal((await run(x)).text, '{"text":""}');assert.equal(x.sent[1].body.input.at(-1).role, 'user');});

test('API-mode GPT uses the OpenAI connection and key, native GPT stays on Codex, and a missing key names the connection', async () => {
 const s = fixtureStore(), p = new Providers(s, { claudeApi: { protocol: 'anthropic', baseUrl: 'https://api.example.test/v1', apiKey: 'claude-key' }, openaiApi: { apiKey: 'openai-key' } }), none = new Providers(s, {});
 try { const seen = [];let native = 0;p.codex.complete = async () => { native++;return { text: '{"native":true}' }; };p.claudeApi.fetcher = async () => { throw Error('the Claude connection was called'); };
  p.openaiApi.fetcher = async (url, o) => { seen.push([url, o.headers.Authorization, o.headers['x-api-key']]);return new Response(JSON.stringify(answer([said('{"ok":true}')]))); };
  assert.deepEqual(await p.call('observer', GROUP, spec, prompt), { ok: true });assert.deepEqual(seen, [['https://api.openai.com/v1/responses', 'Bearer openai-key', undefined]]);assert.equal(native, 0);
  const row = s.list('usage')[0];assert.deepEqual([row.provider, row.transport, row.status], ['codex', 'api', 'completed']);
  assert.deepEqual(await p.call('observer', GROUP, { provider: 'codex', model: 'gpt-test', effort: 'low' }, prompt), { native: true });assert.equal(seen.length, 1);
  await assert.rejects(none.call('observer', GROUP, spec, prompt), /OpenAI API 的密钥/);
  p.openaiApi.fetcher = async () => new Response(JSON.stringify({ data: [{ id: 'gpt-test' }, { id: 'gpt-test-audio' }, { id: 'text-embedding-3' }, { id: 'gpt-image-1' }, { id: 'whisper-1' }] }));
  assert.deepEqual((await p.catalog('openai-api')).map(m => m.id), ['gpt-test'], 'text models only'); } finally { p.stop();none.stop();s.close(); }});

test('settings: GPT may use API mode with its own efforts, DeepSeek may not; background roles keep the mode, and a persona in API mode brings its preset', () => {
 const s = fixtureStore();
 try { const c = s.config();c.personas.gpt = { ...c.personas.gpt, transport: 'api', apiPreset: 'default', model: 'gpt-test', effort: 'none' };assert.doesNotThrow(() => s.saveConfig(c));
  assert.throws(() => s.saveConfig({ ...s.config(), personas: { ...s.config().personas, deepseek: { ...s.config().personas.deepseek, transport: 'api' } } }), /调用模式无效/);
  assert.throws(() => s.saveConfig({ ...s.config(), personas: { ...s.config().personas, gpt: { ...s.config().personas.gpt, effort: 'ultra' } } }), /API 模型/);
  assert.throws(() => s.saveConfig({ ...s.config(), personas: { ...s.config().personas, claude: { ...s.config().personas.claude, transport: 'api', apiPreset: 'default', model: 'm', effort: 'none' } } }), /API 模型/, 'none is for GPT only');
  const d = s.config(), specs = backgroundSpecs(d);specs.observer = { provider: 'codex', transport: 'api', apiPreset: 'default', model: 'gpt-test', effort: 'low' };specs.memory = { provider: 'codex', model: 'gpt-test', effort: 'low', transport: 'native', apiPreset: 'default' };saveBackgroundSpecs(d, specs);
  assert.equal(d.roleModels['role:observer'].transport, 'api');assert.equal(d.roleModels['role:memory'].transport, undefined, 'native Codex stores no mode');assert.doesNotThrow(() => s.saveConfig(d));
  assert.equal(helperCharacter({ claudeApi: { presets: [{ id: 'default', blocks: [{ enabled: true, role: 'system', roles: [], content: '预设块' }] }] } }, { provider: 'codex', transport: 'api', model: 'm', prompt: '人格' }), '人格\n\n预设块'); } finally { s.close(); }});

test('HTTP: the OpenAI key is saved apart from the Claude one and never returned', async () => {
 class Bot extends EventEmitter { state = { status: 'mock' };start() {} stop() {} }
 const s = fixtureStore(), claudeApi = { protocol: 'anthropic', baseUrl: 'https://api.example.test/v1', apiKey: 'claude-key' }, secrets = { adminToken: 'admin', claudeApi };let writes = 0, persisted;
 const app = createApp({ store: s, secrets, onebot: new Bot(), providers: { stop() {}, catalog: async () => [{ id: 'gpt-test', name: 'gpt-test', efforts: [] }] }, persistSecrets(v) { writes++;persisted = v; } }), addr = await app.start(0), base = `http://127.0.0.1:${addr.port}`;
 try { const login = await fetch(base + '/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"token":"admin"}' }), headers = { Cookie: login.headers.get('set-cookie').split(';')[0], 'Content-Type': 'application/json', 'X-QQ-Friend': '1' };
  const put = body => fetch(base + '/api/openai-api/connection', { method: 'PUT', headers, body: JSON.stringify(body) }), state = async () => (await (await fetch(base + '/api/state', { headers })).json()).connections;
  assert.deepEqual((await state()).openaiApi, { protocol: 'responses', baseUrl: 'https://api.openai.com/v1', keyConfigured: false });
  let r = await put({ baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-openai-secret' });assert.equal(r.status, 200);assert.ok(!(await r.text()).includes('sk-openai-secret'));assert.equal(writes, 1);assert.equal(persisted.openaiApi.apiKey, 'sk-openai-secret');assert.equal(persisted.claudeApi.apiKey, 'claude-key');assert.equal(secrets.openaiApi.protocol, 'responses');
  const after = await state();assert.equal(after.openaiApi.keyConfigured, true);assert.equal(after.claudeApi.keyConfigured, true);assert.ok(!JSON.stringify(after).includes('sk-openai-secret'));
  r = await put({ baseUrl: 'https://other.example.test/v1', apiKey: '' });assert.equal(r.status, 400, 'a new address needs its own key');assert.equal(writes, 1);
  r = await put({ baseUrl: 'https://api.openai.com/v1', apiKey: '', clearKey: true });assert.equal(r.status, 200);assert.equal(secrets.openaiApi.apiKey, '');
  r = await fetch(base + '/api/models', { method: 'POST', headers, body: '{"provider":"openai-api"}' });assert.equal(r.status, 200); } finally { await app.close(); }});
