// Publish to the public repository from a separate clean clone, so the private working copy (live data, owner-only notes,
// untracked drafts) is never what gets pushed. Copies this checkout's tracked files into the clone, removes files the
// clone tracks that are gone here, then scans the copy for personal data: the markers in data/release-markers.txt plus
// identifiers read from the live config (QQ numbers of the bot, owner, allowlist and members, group numbers and names,
// persona and prompt-preset text). Hits are reported as file and kind only, never the value. Commit and push in the clone.
//   node scripts/publish.js <path-to-public-clone>
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, copyFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ROOT, DATA } from '../src/config.js';
const target = resolve(process.argv[2] || ''), git = (cwd, ...a) => execFileSync('git', ['-c', 'core.quotepath=false', ...a], { cwd, encoding: 'utf8' });
if (!process.argv[2] || !existsSync(join(target, '.git')) || target === resolve(ROOT)) throw new Error('用法：node scripts/publish.js <公开版仓库的单独克隆目录>（不能是当前目录）');
const NEVER = /^(data|workspace|verification|node_modules|dist|\.venv|docs\/presets)\//;
const tracked = git(ROOT, 'ls-files').split('\n').filter(Boolean), files = tracked.filter(f => !NEVER.test(f)), skipped = tracked.filter(f => NEVER.test(f));
const before = git(target, 'ls-files').split('\n').filter(Boolean), keep = new Set(files);
const removed = before.filter(f => !keep.has(f));
for (const f of removed) rmSync(join(target, f), { force: true });
for (const f of files) { mkdirSync(dirname(join(target, f)), { recursive: true }); copyFileSync(join(ROOT, f), join(target, f)); }
// What must never appear: owner-written markers, then what the live config knows about real people and groups.
const checks = [];
const markerFile = join(DATA, 'release-markers.txt');
if (existsSync(markerFile)) for (const m of new Set(readFileSync(markerFile, 'utf8').split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#')))) checks.push({ kind: '发行标记', test: t => t.includes(m) });
const dbFile = join(DATA, 'friend.sqlite');
if (existsSync(dbFile)) {
  const db = new DatabaseSync(dbFile, { readOnly: true });
  try {
    const c = JSON.parse(db.prepare("SELECT body FROM records WHERE id='config'").get().body);
    const members = db.prepare("SELECT body FROM records WHERE kind='member'").all().map(r => JSON.parse(r.body).userId);
    const numbers = new Set([c.botId, c.ownerId, ...(c.privateAllowlist || []), ...(c.groups || []).map(g => g.id), ...members].map(String).filter(q => /^\d{6,12}$/.test(q)));
    for (const q of numbers) { const re = new RegExp(`(^|\\D)${q}(\\D|$)`); checks.push({ kind: 'QQ 号或群号', test: t => re.test(t) }); }
    for (const g of c.groups || []) if (String(g.name || '').trim().length >= 3) checks.push({ kind: '群名', test: t => t.includes(g.name.trim()) });
    // Persona and preset text, as 16-character fragments: any one of them in a published file means the text leaked.
    const texts = [...Object.values(c.personas || {}).flatMap(p => [p.prompt, p.brief]), ...(c.claudeApi?.presets || []).flatMap(p => p.blocks.map(b => b.content))];
    for (const text of texts) { const s = String(text || '').replace(/\s+/g, ''); for (let i = 0; i + 16 <= s.length; i += 16) { const frag = s.slice(i, i + 16); checks.push({ kind: '人格或提示词原文', test: t => t.replace(/\s+/g, '').includes(frag) }); } }
  } finally { db.close(); }
}
if (!checks.length) throw new Error('没有可用的检查项：缺少 data/release-markers.txt 和 data/friend.sqlite，不发布');
const BINARY = /\.(png|jpe?g|gif|webp|ico|zip|woff2?)$/i, hits = [];
for (const f of files) {
  if (BINARY.test(f)) continue;
  const text = readFileSync(join(target, f), 'utf8'), kinds = new Set(checks.filter(x => x.test(text)).map(x => x.kind));
  for (const kind of kinds) hits.push(`${f}: ${kind}`);
}
const status = git(target, 'status', '--porcelain').split('\n').filter(Boolean).length;
console.log(JSON.stringify({ target, copied: files.length, removed, skippedPrivatePaths: skipped.length, checks: checks.length, changedInClone: status, hits }, null, 1));
if (hits.length) { console.error('公开版副本里发现个人信息，不要提交；先在源文件里删掉再重新运行。'); process.exit(1); }
