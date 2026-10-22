// Never turn missing provider telemetry into zero, or context occupancy into spend.
export const tokenFields = ["inputTokens", "outputTokens", "totalTokens", "cachedInputTokens", "cacheWriteInputTokens", "reasoningOutputTokens"];
export const count = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;

export function tokensFrom(value) {
  if (!value || typeof value !== "object") return null;
  const t = {
    inputTokens: count(value.inputTokens ?? value.input_tokens ?? value.prompt_tokens),
    outputTokens: count(value.outputTokens ?? value.output_tokens ?? value.completion_tokens),
    totalTokens: count(value.totalTokens ?? value.total_tokens),
    cachedInputTokens: count(value.cachedInputTokens ?? value.cachedReadTokens ?? value.cacheReadTokens ?? value.cacheReadInputTokens ?? value.cache_read_input_tokens ?? value.input_tokens_details?.cached_tokens ?? value.prompt_tokens_details?.cached_tokens),
    cacheWriteInputTokens: count(value.cacheWriteInputTokens ?? value.cachedWriteTokens ?? value.cacheWriteTokens ?? value.cacheCreationInputTokens ?? value.cache_creation_input_tokens),
    reasoningOutputTokens: count(value.reasoningOutputTokens ?? value.output_tokens_details?.reasoning_tokens ?? value.completion_tokens_details?.reasoning_tokens),
  };
  // Anthropic's input count excludes cache reads/writes; OpenAI's includes them.
  const exclusiveCache = ["cachedReadTokens", "cachedWriteTokens", "cacheReadInputTokens", "cacheCreationInputTokens", "cache_read_input_tokens", "cache_creation_input_tokens"].some((k) => Object.hasOwn(value, k));
  // DSH's generic cache counters do not tell us whether input includes them.
  // Keep its reported total authoritative instead of guessing from components.
  const ambiguousCache = ["cacheReadTokens", "cacheWriteTokens"].some((k) => Object.hasOwn(value, k));
  // Normalized snapshots carry null explicitly. Re-normalizing one must not
  // turn an unknown total into a guessed input+output total without cache.
  const totalExplicitlyUnknown = value.totalTokens === null || value.total_tokens === null;
  if (t.totalTokens === null && t.inputTokens !== null && t.outputTokens !== null &&
      !totalExplicitlyUnknown && !ambiguousCache && (!exclusiveCache || t.cachedInputTokens !== null && t.cacheWriteInputTokens !== null)) {
    t.totalTokens = t.inputTokens + t.outputTokens + (exclusiveCache ? t.cachedInputTokens + t.cacheWriteInputTokens : 0);
  }
  return tokenFields.some((k) => t[k] !== null) ? t : null;
}

// Native adapters can expose richer per-model accounting than their main-loop
// usage object. Keep both, but never add one scope to the other.
export function nativeUsageFrom(result = {}) {
  const quota = result?._meta?.quota;
  const models = quota?.model_usage;
  const entries = Array.isArray(models) ? models : models && typeof models === "object"
    ? Object.entries(models).map(([model, value]) => ({ model, token_count: value?.token_count ?? value })) : [];
  const byModel = new Map();
  for (const entry of entries) {
    const modelId = entry?.model;
    const tokens = tokensFrom(entry?.token_count);
    if (typeof modelId !== "string" || !modelId.trim() || !tokens) continue;
    if (!byModel.has(modelId)) byModel.set(modelId, { modelId, tokens });
    else {
      const prior = byModel.get(modelId).tokens;
      for (const k of tokenFields) prior[k] = prior[k] !== null && tokens[k] !== null ? prior[k] + tokens[k] : null;
    }
  }
  const modelUsage = [...byModel.values()];
  return { tokens: tokensFrom(result?.usage) ?? tokensFrom(quota?.token_count), modelUsage,
    modelUsageSource: modelUsage.length ? "native-turn-models" : null };
}

export function contextSnapshot(used, limit, source = "provider") {
  const usedTokens = count(used), limitTokens = count(limit);
  return { usedTokens, limitTokens, remainingTokens: usedTokens !== null && limitTokens !== null ? Math.max(0, limitTokens - usedTokens) : null,
    percent: usedTokens !== null && limitTokens > 0 ? usedTokens / limitTokens * 100 : null, source, updatedAt: Date.now() };
}

// A text-only heuristic, explicitly separate from billed tokens; excludes hidden prompts/tools.
export function estimateTextTokens(text) {
  let latin = 0, wide = 0;
  for (const char of String(text || "")) /[\u2e80-\u9fff\uf900-\ufaff]/u.test(char) ? wide++ : latin++;
  return Math.ceil(latin / 4 + wide);
}

export function flattenOptions(options = []) {
  return options.flatMap((o) => Array.isArray(o.options) ? flattenOptions(o.options) : [o]);
}

export function sessionMetadata(result = {}, previous = {}) {
  const configOptions = result.configOptions ?? previous.configOptions ?? [];
  const modelOption = configOptions.find((o) => o.category === "model" || o.id === "model");
  const modelId = modelOption?.currentValue ?? result.models?.currentModelId ?? previous.modelId ?? null;
  const selected = flattenOptions(modelOption?.options).find((o) => o.value === modelId);
  return { ...previous, configOptions, modelId, modelName: selected?.name || modelId,
    modes: result.modes ?? previous.modes ?? null, models: result.models ?? previous.models ?? null };
}

export function usageSummary(records) {
  const rows = new Map();
  for (const r of records) {
    const reportedModels = Array.isArray(r.modelUsage) ? r.modelUsage.filter((m) => typeof m?.modelId === "string" && m.modelId && tokensFrom(m.tokens)) : [];
    const shares = reportedModels.length ? reportedModels.map((m) => ({ ...r, modelId: m.modelId, tokens: tokensFrom(m.tokens),
      source: r.modelUsageSource || "native-turn-models", estimatedTextTokens: m.modelId === r.modelId ? r.estimatedTextTokens : 0,
      context: m.modelId === r.modelId ? r.context : null })) : [{ ...r, source: "request-usage" }];
    for (const share of shares) {
      const key = JSON.stringify([share.agentId, share.modelId, share.purpose]);
      if (!rows.has(key)) rows.set(key, { agentId: share.agentId, modelId: share.modelId, purpose: share.purpose, sources: [],
        requests: 0, completed: 0, failed: 0, cancelled: 0, reportedRequests: 0, estimatedTextTokens: 0,
        context: null, ...Object.fromEntries(tokenFields.map((k) => [k, null])), coverage: Object.fromEntries(tokenFields.map((k) => [k, 0])) });
      const row = rows.get(key);
      if (!row.sources.includes(share.source)) row.sources.push(share.source);
      row.requests++;
      if (share.status === "done") row.completed++;
      if (share.status === "error") row.failed++;
      if (share.status === "cancelled") row.cancelled++;
      if (share.tokens) row.reportedRequests++;
      row.estimatedTextTokens += share.estimatedTextTokens || 0;
      if (share.context && (!row.context || share.context.updatedAt >= row.context.updatedAt)) row.context = share.context;
      for (const k of tokenFields) if (count(share.tokens?.[k]) !== null) { row[k] = (row[k] ?? 0) + share.tokens[k]; row.coverage[k]++; }
    }
  }
  return [...rows.values()].map((r) => ({ ...r, unreportedRequests: r.requests - r.reportedRequests }));
}
