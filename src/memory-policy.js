// Stored evidence is data, never instructions. Scope checks precede every ranking step.
export const MEMORY_DEFAULTS = { debugReadApproved: false, maxCandidates: 24, topicTtlHours: 6 };
export const memoryOptions = c => ({ ...MEMORY_DEFAULTS, ...c.memory });
export const categoryOf = m => m.category || (m.scope === 'persona' ? 'impression' : m.userId ? 'fact' : 'event');
export const protectedMemory = m => m.protected ?? m.actor === 'owner';
export const expiredMemory = (m, now = Date.now()) => Number.isFinite(m.expiresAt) && m.expiresAt <= now;
// Facts about a person learned in a group follow that QQ account into every group and private chat. Group events, short
// topics, the owner's private interests and anything learned in a private chat stay where they were learned.
export const crossGroupMemory = m => !!m.userId && categoryOf(m) !== 'topic' && m.scope !== 'private' && !String(m.groupId).startsWith('private:');
export function visibleMemory(m, groupId, persona, c, now = Date.now()) {
  if ((m.groupId !== groupId && !crossGroupMemory(m)) || m.status !== 'approved' || expiredMemory(m, now)) return false;
  const branch = m.debug === c.debug || (c.debug && memoryOptions(c).debugReadApproved && m.debug === false);
  return branch && (m.scope === 'shared' || (m.scope === 'persona' && m.persona === persona) ||
    (groupId === `private:${c.ownerId}` && m.scope === 'private' && m.userId === c.ownerId));
}
export function sameMemoryScope(a, b) {
  return (a.groupId === b.groupId || crossGroupMemory(a) && crossGroupMemory(b)) && a.debug === b.debug && a.scope === b.scope &&
    (a.persona || '') === (b.persona || '') && (a.userId || '') === (b.userId || '');
}
// Preserve decimal points, minus signs and punctuation inside facts: 1.5 must not dedup as 15.
export const normalizedFact = text => String(text).normalize('NFKC').toLowerCase().replace(/[\p{Z}\s]/gu, '').replace(/[。.!?，,;；！？]+$/u, '');
export function memoryFields(input, previous = {}) {
  const category = input.category ?? categoryOf(previous), key = input.key ?? previous.key ?? '';
  const expiresAt = input.expiresAt === undefined ? previous.expiresAt ?? null : input.expiresAt;
  if (!['fact', 'event', 'impression', 'topic'].includes(category) || typeof key !== 'string' || key.length > 120 ||
      (expiresAt !== null && (!Number.isSafeInteger(expiresAt) || expiresAt <= 0)) ||
      (input.protected !== undefined && typeof input.protected !== 'boolean')) throw new Error('记忆类型、键、保护或有效期无效');
  if (category === 'impression' && previous.scope !== 'persona') throw new Error('主观印象必须属于人格专有记忆');
  if (category === 'topic' && expiresAt === null) throw new Error('短期话题必须设置有效期');
  return { category, key: key.trim(), expiresAt };
}
