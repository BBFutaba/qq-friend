import test from 'node:test';
import assert from 'node:assert/strict';
import { splitReply, splitChatReply, hasLink } from '../src/format.js';
import { DEFAULTS } from '../src/config.js';

test('the link pattern finds schemes, www. and bare domains, but not versions, emails, file names or paths', () => {
 for (const yes of ['看 https://www.bilibili.com/video/BV1x', 'http://x.co', '去 www.example.org 看', 'b23.tv/AbCd 这个', '看b23.tv/AbCd吧', 'youtube.com/watch?v=abc', '链接：bilibili.com/video/BV1x，看看', 'GITHUB.COM/a/b']) assert.ok(hasLink(yes), yes);
 for (const no of ['版本 1.5.2 发布', '邮箱 a@b.com', 'node.js 很好用', '看 readme.md', 'e.g. 举例', 'i.e. 就是', '3.14', 'C:\\work\\a.txt', '/usr/local/bin', '普通聊天。真的！', '']) assert.ok(!hasLink(no), no);});

test('a reply with a link goes out as one message with its punctuation intact; without one it still splits', () => {
 const o = DEFAULTS.output;
 assert.deepEqual(splitReply('这个讲得挺清楚的，b23.tv/AbCd，第三关那段看看。', o), ['这个讲得挺清楚的，b23.tv/AbCd，第三关那段看看']);
 assert.deepEqual(splitReply('第一句。第二句！第三句', o), ['第一句', '第二句！', '第三句']);
 const many = Array.from({ length: 8 }, (_, i) => `第${i}句`).join('。') + '。https://www.youtube.com/watch?v=abc';
 assert.deepEqual(splitReply(many, o), [many], 'more sentences than maxParts: still one message');
 assert.deepEqual(splitChatReply(many, o), [many]);});

test('a link message longer than all parts together goes to shortening instead of being packed or cut', () => {
 const o = { ...DEFAULTS.output, maxParts: 2, maxPartChars: 40 }, long = '很长的说明'.repeat(20) + ' https://nodejs.org';
 assert.throws(() => splitReply(long, o), /回复拆分后超过 2 条的长度（含链接，不能拆分）/);
 assert.throws(() => splitChatReply(long, o), /回复拆分后超过/, 'not packed into pieces');
 const fits = '说明'.repeat(20) + ' https://nodejs.org';assert.deepEqual(splitReply(fits, o), [fits]);});
