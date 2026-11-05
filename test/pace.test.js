import test from 'node:test';
import assert from 'node:assert/strict';
import { PACES, PACE_WEIGHTS, replyPace, PACE_NOTE } from '../src/pace.js';

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

test('the note names the length lean and nothing about time', () => {
 assert.match(PACE_NOTE, /pace/);assert.doesNotMatch(PACE_NOTE, /now|时间|作息/);});
