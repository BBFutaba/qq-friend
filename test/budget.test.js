import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtureStore } from './fixture.js';
import { Providers } from '../src/providers.js';

function seeded(recent, old = 0, rounds = 0) {
 const s = fixtureStore(), now = Date.now();s.db.exec('BEGIN');
 for (let i = 0; i < recent; i++) s.create('usage', { role: 'observer', startedAt: now - 1000 - i, status: 'completed' });
 // Started over a day ago but finished (updated) just now: outside the window.
 for (let i = 0; i < old; i++) s.create('usage', { role: 'observer', startedAt: now - 90000000 - i, status: 'completed' });
 for (let i = 0; i < rounds; i++) s.create('api-round', { usageId: 'u', at: now - 500 - i });
 s.db.exec('COMMIT');return s;}
const limit = (s, dailyCalls) => s.saveConfig({ ...s.config(), participation: { ...s.config().participation, dailyCalls } });

test('the rolling 24 h call count is exact past the old 500 / 3000 caps and ignores older calls', () => {
 const s = seeded(3500, 20, 40);try { assert.equal(s.callsSince(Date.now() - 86400000), 3540); } finally { s.close(); }});

test('dailyCalls caps model calls up to 10000, and -1 removes the cap', async () => {
 const s = seeded(3540), p = new Providers(s, {});
 try {
  limit(s, 3600);assert.equal(p.overBudget(s.config()), false);
  limit(s, 3540);assert.equal(p.overBudget(s.config()), true);
  await assert.rejects(p.call('observer', 'g', { provider: 'codex', model: 'x' }, { system: 's', data: {} }), /每日模型调用预算/);
  limit(s, -1);assert.equal(p.overBudget(s.config()), false);
  limit(s, 10000);assert.equal(s.config().participation.dailyCalls, 10000);
 } finally { p.stop();s.close(); }});
