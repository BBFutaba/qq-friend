import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fixtureStore } from './fixture.js';
import { Providers } from '../src/providers.js';

// Like the ACP client: kill() ends with closed set and stopping cleared again, which is what the provider used to miss.
class FakeConn extends EventEmitter {
 constructor(dir) { super(); this.dir = dir; this.closed = false; this.stopping = false; this.n = 0; this.killed = null; }
 async start() {}
 async kill(error) { this.killed = error; this.closed = true; this.stopping = false; }
 async newSession() { if (this.closed) throw new Error('deepseek is not running'); return `sess-${this.dir.slice(-4)}-${++this.n}`; }
 sessionState() { return { configOptions: [], modelId: 'flash', context: { usedTokens: 10 } }; }
 async closeSession() {}
 async prompt(sid) {
  if (this.closed) throw new Error('deepseek is not running');
  this.emit('update', sid, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '{"decision":"ignore"}' } });
  writeFileSync(join(this.dir, sid + '.json'), JSON.stringify({ record: { rows: { tokenUsage: { val: { totals: { uncachedInputTokens: 5, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } } } } } }));
  return { stopReason: 'end_turn' };
 }
}

test('a killed shared DeepSeek process is replaced: its sessions answer SESSION_LOST once and reopen on a new process', async t => {
 const dir = mkdtempSync(join(tmpdir(), 'qq-friend-dsh-')), s = fixtureStore(), providers = new Providers(s, {}), conns = [];
 t.after(() => { providers.stop(); s.close(); rmSync(dir, { recursive: true, force: true }); });
 providers.dshDir = dir; providers.deepseekConnection = () => { const c = new FakeConn(dir); conns.push(c); return c; };
 const spec = { provider: 'deepseek', model: 'flash' }, key = 'observer:g';
 assert.deepEqual(await providers.turn('observer', 'g', spec, key, { system: '完整', data: {}, fresh: true }), { decision: 'ignore' });
 conns[0].emit('update', 'sess-x', { sessionUpdate: 'tool_call', kind: 'execute', title: 'rm -rf /' });await new Promise(r => setImmediate(r));
 assert.match(conns[0].killed.message, /意外请求工具（execute）/);assert.equal(conns[0].closed, true);assert.equal(conns[0].stopping, false);
 assert.equal(providers.sessionInfo(key), null, 'a session on a dead process is gone');
 await assert.rejects(providers.turn('observer', 'g', spec, key, { system: '提醒', data: {} }), e => e.code === 'SESSION_LOST');
 assert.deepEqual(await providers.turn('observer', 'g', spec, key, { system: '完整', data: {}, fresh: true }), { decision: 'ignore' });
 assert.equal(conns.length, 2, 'a new process');assert.ok(s.list('log', l => /DeepSeek 共享进程已退出/.test(l.message)).length);
 assert.deepEqual(await providers.turn('observer', 'g', spec, key, { system: '提醒', data: {} }), { decision: 'ignore' });assert.equal(conns.length, 2, 'and it is reused');});
