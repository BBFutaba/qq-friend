import { estimateTextTokens } from './vendor/usage.js';
import { categoryOf, memoryOptions, visibleMemory } from './memory-policy.js';

// Chinese bigrams plus Latin words: deterministic local retrieval, no model/embedding call.
export function terms(text) {
  const result = new Set();
  for (const word of String(text || '').normalize('NFKC').toLowerCase().match(/[a-z0-9_]{2,}|[\p{Script=Han}]+/gu) || []) {
    if (/\p{Script=Han}/u.test(word)) {
      for (let i = 0; i < word.length - 1; i++) result.add(word.slice(i, i + 2));
    } else result.add(word);
  }
  return result;
}
export function relevance(text, query) {
  if (!query.size) return 0;
  const found = terms(text); let count = 0;
  for (const term of query) if (found.has(term)) count++;
  return count / Math.sqrt(Math.max(1, found.size));
}
export function participants(messages, members) {
  const ids = new Set(messages.map(m => m.userId).filter(Boolean));
  const text = messages.map(m => m.text || '').join('\n');
  for (const match of text.matchAll(/\[@(\d+)\]/g)) ids.add(match[1]);
  for (const p of members) if (p.name?.length >= 2 && text.includes(p.name)) ids.add(p.userId);
  return ids;
}
export function rankMemories(rows, messages, members, groupId, persona, c) {
  const ids = participants(messages, members), query = terms(messages.slice(-8).map(m => m.text).join('\n'));
  return rows.filter(m => visibleMemory(m, groupId, persona, c)).map(m => {
    const lexical = relevance(`${m.key || ''} ${m.content}`, query);
    const person = m.userId && ids.has(m.userId), group = !m.userId && categoryOf(m) !== 'topic';
    // A topic needs an actual lexical match; a repeated speaker alone is not the same topic.
    return { m, score: lexical * 8 + (person ? 3 : 0) + (group ? .15 : 0), relevant: categoryOf(m) === 'topic' ? lexical > 0 : lexical > 0 || person || group };
  }).filter(x => x.relevant).sort((a, b) => b.score - a.score || b.m.updated - a.m.updated || a.m.id.localeCompare(b.m.id))
    .slice(0, memoryOptions(c).maxCandidates).map(x => x.m);
}
export function compactMemories(memories, withIds = false) {
  const columns = [...(withIds ? ['id', 'version'] : []), 'qq', 'type', 'scope', 'fact'];
  return { columns, rows: memories.map(m => [...(withIds ? [m.id, m.version] : []), m.userId || 'group', categoryOf(m), m.scope === 'persona' ? `persona:${m.persona}` : m.scope, m.content]) };
}
export function compactPeople(people) {
  return { columns: ['qq', 'name', 'profile', 'notes'], rows: people.map(p => [p.userId, p.name, p.profile || '', p.notes || '']) };
}
export const promptText = prompt => `${prompt.system}\n${JSON.stringify(prompt.data)}`;
export function promptStats(prompt) {
  const text = promptText(prompt), blocks = {};
  for (const [key, value] of Object.entries(prompt.data || {})) blocks[key] = JSON.stringify(value).length;
  return { chars: text.length, estimatedTextTokens: estimateTextTokens(text), systemChars: prompt.system.length, blocks };
}
function arraysAt(data, name) {
  const values = [];
  function visit(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return;
    for (const [key, value] of Object.entries(obj)) {
      if (key === name && Array.isArray(value)) values.push(value);
      else if (key === name && Array.isArray(value?.rows)) values.push(value.rows);
      else if (key === 'context') visit(value);
    }
  }
  visit(data); return values;
}
// Hard bound on application-owned text, including instructions/persona/media descriptions.
// Provider hidden instructions and image tokens cannot be bounded by this character limit.
export function fitPrompt(input, maxChars, { requiredIds = [] } = {}) {
  const prompt = structuredClone({ system: input.system, data: input.data });
  const before = promptStats(prompt), dropped = {}, required = new Set(requiredIds);
  const tooLarge = () => promptText(prompt).length > maxChars;
  const record = key => dropped[key] = (dropped[key] || 0) + 1;
  for (const name of ['recent', 'feeds', 'privateInterests', 'memories', 'people']) {
    for (const array of arraysAt(prompt.data, name)) while (tooLarge() && array.length) { array.pop(); record(name); }
  }
  for (const name of ['messages', 'context']) {
    for (const array of arraysAt(prompt.data, name)) {
      while (tooLarge() && array.length > 1) {
        const index = array.findIndex(m => !required.has(m.id));
        if (index < 0) break;
        array.splice(index, 1); record(name);
      }
    }
  }
  // Keep IDs, timestamps, media status and a visible truncation marker.
  for (const name of ['media', 'messages', 'context']) for (const array of arraysAt(prompt.data, name)) {
    for (const row of array) for (const key of ['text', 'description', 'transcript', 'mediaSummary']) {
      if (!tooLarge() || typeof row[key] !== 'string' || row[key].length <= 80) continue;
      const cut = Math.max(80, row[key].length - (promptText(prompt).length - maxChars) - 60);
      row[key] = row[key].slice(0, cut) + ' [内容因预算截断]'; row.truncated = true; record(`${name}Text`);
    }
  }
  if (tooLarge()) throw new Error(`人格、系统说明或必要资料超过最终输入预算 ${maxChars} 字符；请在后台提高预算或缩短人格`);
  const after = promptStats(prompt);
  prompt.budget = { limitChars: maxChars, beforeChars: before.chars, ...after, dropped, requiredIds: [...required] };
  return prompt;
}
export function suppliedMemoryIds(prompt) {
  const memory = prompt.data.memories || prompt.data.context?.memories;
  return new Set(Array.isArray(memory?.rows) && memory.columns[0] === 'id' ? memory.rows.map(r => r[0]) : []);
}
