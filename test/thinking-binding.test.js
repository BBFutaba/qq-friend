import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ClaudeApi, buildApiRequest, compactToolHistory, stripThinking } from '../src/claude-api.js';

const connection = { protocol: 'anthropic', baseUrl: 'https://api.example.test/v1', apiKey: 'secret-test-key' }, spec = { provider: 'claude', transport: 'api', model: 'test-model', effort: '' };
const prompt = { system: 'Return JSON', data: { text: 'software release' }, budget: { limitChars: 16000 } };
const BOUND = i => ({ type: 'error', error: { type: 'invalid_request_error', message: `messages.${i}.content.0: Invalid \`signature\` in \`thinking\` block. The block is bound to a different conversation. Remove the block, or set \`thinking.block_binding.prefix_mismatch_behavior\` to "drop_block".` } });
// Like the API: a thinking block is bound to system, tools and every message before it; cache_control and tool_choice are not part of it.
const prefix = (body, i) => createHash('sha256').update(JSON.stringify([body.system, body.tools, body.messages.slice(0, i)], (k, v) => k === 'cache_control' ? undefined : v)).digest('hex');
function fakeApi({ toolRounds, resultChars = 4400 }) {
 const bound = new Map(), seen = { requests: 0, rejected: 0, bodies: [] };let n = 0;
 const fetcher = async (url, o) => {
  const body = JSON.parse(o.body);seen.requests++;seen.bodies.push(body);
  for (const [i, m] of body.messages.entries()) if (m.role === 'assistant') for (const b of m.content) if (b.type === 'thinking' && bound.get(b.signature) !== prefix(body, i)) { seen.rejected++; return new Response(JSON.stringify(BOUND(i)), { status: 400 }); }
  const sig = `sig-${++n}`;bound.set(sig, prefix(body, body.messages.length));
  const thinking = { type: 'thinking', thinking: '想一想', signature: sig };
  const content = n <= toolRounds ? [thinking, { type: 'tool_use', id: `call${n}`, name: 'web_read', input: { url: `https://example.com/${n}` } }] : [thinking, { type: 'text', text: '{"text":"查到了"}' }];
  return new Response(JSON.stringify({ stop_reason: n <= toolRounds ? 'tool_use' : 'end_turn', content, usage: { input_tokens: 10, output_tokens: 2 } }));
 };
 const client = new ClaudeApi({ claudeApi: connection }, fetcher);client.web = { execute: async (name, args) => ({ untrusted: true, url: args.url, text: '页'.repeat(resultChars) }) };
 return { client, seen };
}
const run = client => client.complete(buildApiRequest(spec, prompt, { webTools: true }, connection), undefined, { auditTools: async calls => calls.map(c => c.id) });

test('a long web-lookup chain that compacts its history drops the thinking blocks instead of replaying invalid ones', async () => {
 const { client, seen } = fakeApi({ toolRounds: 7 });
 const r = await run(client);
 assert.equal(r.text, '{"text":"查到了"}');assert.equal(seen.rejected, 0, 'no thinking block replayed after an edit');
 const last = seen.bodies.at(-1);assert.match(JSON.stringify(last.messages), /\\"truncated\\":true/, 'old tool results were compacted');
 assert.ok(last.messages.filter(m => m.role === 'assistant').every(m => m.content.some(b => b.type === 'tool_use')), 'tool calls stay');});

test('without compaction thinking blocks are replayed unchanged; a binding 400 strips them and retries once', async () => {
 const short = fakeApi({ toolRounds: 2, resultChars: 50 });await run(short.client);
 assert.equal(short.seen.rejected, 0);assert.ok(short.seen.bodies.at(-1).messages.filter(m => m.role === 'assistant').every(m => m.content[0].type === 'thinking'), 'kept while history is append-only');
 let calls = 0;const always = new ClaudeApi({ claudeApi: connection }, async (url, o) => { calls++;const body = JSON.parse(o.body);
  if (calls === 1) return new Response(JSON.stringify({ stop_reason: 'tool_use', content: [{ type: 'thinking', thinking: 'x', signature: 's' }, { type: 'tool_use', id: 'c1', name: 'web_search', input: { query: 'q' } }], usage: { input_tokens: 1, output_tokens: 1 } }));
  if (JSON.stringify(body.messages).includes('"thinking"')) return new Response(JSON.stringify(BOUND(1)), { status: 400 });
  return new Response(JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{"text":"好"}' }], usage: { input_tokens: 1, output_tokens: 1 } })); });
 always.web = { execute: async () => ({ untrusted: true, results: [] }) };
 assert.equal((await run(always)).text, '{"text":"好"}');assert.equal(calls, 3, 'one retry without thinking');
 const stuck = new ClaudeApi({ claudeApi: connection }, async () => new Response(JSON.stringify(BOUND(1)), { status: 400 }));
 await assert.rejects(run(stuck), /bound to a different conversation/, 'nothing to strip: the error stands');});

test('stripThinking removes thinking and redacted thinking from assistant turns only; compaction under budget leaves them', () => {
 const body = { messages: [{ role: 'user', content: [{ type: 'text', text: 'q' }] }, { role: 'assistant', content: [{ type: 'thinking', thinking: 'a', signature: 's' }, { type: 'redacted_thinking', data: 'x' }, { type: 'tool_use', id: '1', name: 'web_search', input: {} }] }] };
 const small = structuredClone(body);compactToolHistory(small, 1, 1e6);assert.deepEqual(small, body);
 assert.equal(stripThinking(body), 2);assert.deepEqual(body.messages[1].content.map(b => b.type), ['tool_use']);assert.equal(stripThinking(body), 0);});
