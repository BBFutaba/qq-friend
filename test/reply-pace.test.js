import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { fixtureStore, GROUP } from './fixture.js';
import { Engine } from '../src/engine.js';
import { PACES, PACE_NOTE } from '../src/pace.js';

function setup(t, random) {
 const s = fixtureStore(), c = s.config();c.paused = false;c.personas.gpt.prompt = '一个可靠的群友';s.saveConfig(c);
 const calls = [], p = { stop() {}, async call(role, group, spec, prompt) { calls.push({ role, prompt });return role === 'observer' ? { decision: 'respond' } : { text: '好' }; } };
 const bot = new EventEmitter();bot.send = async () => { throw Error('no sends in tests'); };
 const e = new Engine(s, p, bot);e.enqueue = row => row;e.random = random;t.after(() => { e.stop();s.close(); });
 let at = Date.now() - 30000;
 const say = (text, extra = {}) => { const m = s.create('message', { groupId: GROUP, userId: '10000009', name: '小明', text, media: [], at: at += 100, direction: 'in', externalId: String(at), ...extra });e.noteWake(m, s.config());return m; };
 const reply = async () => { e.lastReply.clear();await e.respond(GROUP);return calls.filter(x => x.role === 'reply').at(-1).prompt; };
 return { say, reply };}

test('each reply carries the group clock and a drawn length lean; a direct question gets room', async t => {
 const x = setup(t, () => 0);
 x.say('笑死', { mentioned: true });const react = await x.reply();
 assert.equal(react.data.pace, PACES.react);assert.match(react.data.now, /^\d{1,2}月\d{1,2}日 周[一二三四五六日] \d\d:\d\d$/);
 x.say('你觉得这本书哪里写得好？', { mentioned: true });const asked = await x.reply();assert.equal(asked.data.pace, PACES.full);
 assert.ok(react.system.includes(PACE_NOTE));assert.equal(asked.system, react.system, 'the instructions stay byte-identical across paces (prompt caching)');
 assert.ok(!/pace|now/.test(JSON.stringify(Object.keys(react).filter(k => k !== 'data'))), 'only data carries the per-reply fields');});
