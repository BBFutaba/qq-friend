// Synthetic QQ identity shared by tests. These numbers are placeholders, never real accounts.
import { Store } from '../src/store.js';
import { DEFAULTS } from '../src/config.js';
export const OWNER = '10000001', BOT = '20000002', GROUP = '30000003';
export const IDENTITY = { ownerId: OWNER, botId: BOT, privateAllowlist: [OWNER], groups: [{ id: GROUP, name: '测试群', enabled: true, persona: 'gpt' }] };
export const CONFIG = { ...structuredClone(DEFAULTS), ...structuredClone(IDENTITY) };
// Configured in place so revision stays 1, as a fresh store would have before any dashboard save.
export function fixtureStore() { const s = new Store(':memory:'); s.update('config', structuredClone(IDENTITY)); return s; }
