import test from 'node:test';
import assert from 'node:assert/strict';
import { PACES, PACE_WEIGHTS, replyPace, localNow, systemZone, PACE_NOTE } from '../src/pace.js';

test('the length lean follows the weights, and a direct question always gets room', () => {
 assert.equal(replyPace('哈哈哈', false, () => 0), PACES.react);assert.equal(replyPace('哈哈哈', false, () => .34), PACES.react);
 assert.equal(replyPace('哈哈哈', false, () => .35), PACES.short);assert.equal(replyPace('哈哈哈', false, () => .79), PACES.short);
 assert.equal(replyPace('哈哈哈', false, () => .8), PACES.full);
 for (const q of ['这个怎么弄', '你觉得哪个好？', '能不能讲讲这本书', '是不是要下雨了']) assert.equal(replyPace(q, true, () => 0), PACES.full, q);
 assert.equal(replyPace('你觉得哪个好？', false, () => 0), PACES.react, 'a question to the group is still drawn');
 assert.equal(replyPace('笑死', true, () => 0), PACES.react, 'a direct remark that is not a question is still drawn');
 assert.ok(Math.abs(Object.values(PACE_WEIGHTS).reduce((a, b) => a + b) - 1) < 1e-9);
 let seed = 7;const lcg = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648, counts = {};
 for (let i = 0; i < 20000; i++) { const p = replyPace('嗯', false, lcg);counts[p] = (counts[p] || 0) + 1; }
 for (const [k, w] of Object.entries(PACE_WEIGHTS)) assert.ok(Math.abs(counts[PACES[k]] / 20000 - w) < .02, k);});

test('local time is the group\'s clock (China time by default), and the note names both fields', () => {
 const d = new Date('2026-10-21T15:05:00Z');assert.equal(localNow(d), localNow(d, systemZone()), 'the system time zone by default');
 assert.equal(localNow(d, 'Asia/Shanghai'), '10月21日 周三 23:05');
 assert.equal(localNow(new Date('2026-01-03T23:30:00Z'), 'Asia/Shanghai'), '1月4日 周日 07:30', 'crosses midnight into the next day');
 const was = process.env.QQ_FRIEND_TZ;process.env.QQ_FRIEND_TZ = 'Asia/Tokyo';try { assert.equal(localNow(d), '10月22日 周四 00:05', 'an explicit override wins'); } finally { if (was === undefined) delete process.env.QQ_FRIEND_TZ; else process.env.QQ_FRIEND_TZ = was; }
 assert.equal(localNow(new Date('2026-10-21T15:05:00Z'), 'America/New_York'), '10月21日 周三 11:05');
 assert.match(PACE_NOTE, /pace/);assert.match(PACE_NOTE, /now/);});
