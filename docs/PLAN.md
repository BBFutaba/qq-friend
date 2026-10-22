# QQ群友 implementation plan

## Agreed scope
- One bot QQ account and one owner (approver) QQ, always on the private-chat allowlist; up to 20 groups. All are set per install in the dashboard or with scripts/configure.js; a fresh install has none and cannot start until they are set.
- One account, three independent DeepSeek / Claude / GPT personas; prompts initially blank. Switching is dashboard-only.
- Each background role independently selects a native Codex, Claude or DeepSeek model and effort. New installs default the observer to GPT 6.1 Sol low; existing role selections remain intact. DeepSeek is text-only, so its observer uses GPT 6.1 Sol low for visual perception. Auditor always has a separate session.
- Active group participation automatically replies; new topics and recommendations require agent audit followed by owner's explicit private approval.
- Debug mode routes replies to owner, never falls back to group, and keeps simulated replies and memory separate.
- Group shared facts, persona-specific memories, private owner interests and debug records are separate. Dashboard supports member profiles, memory editing/auditing, provenance and revision history.
- No arbitrary tasks from QQ. Tools are limited to understanding shared images/audio/video. Untrusted content never grants permissions.
- Use existing signed-in Chrome Bilibili/X through a narrow browser bridge, not cookie extraction. No posting/liking/following.
- Usage by role/provider/group, account quotas with fetched timestamps, bounded scheduling, deduplication, cancellation and uncertain-delivery handling.

## Build stages and acceptance
1. Inspect/reuse Tulpa OneBot identity checks, loopback/auth, delivery-unknown and cursor patterns; Agent Hub process/ACP/usage utilities.
2. SQLite state, authenticated local dashboard, configuration, message pipeline, profiles/memory review, exact-content approvals, debug routing.
3. Native account-backed provider adapters, model/effort discovery, media bridge, isolated working venv, Chrome companion and proactive scheduler.
4. Regression tests of authorization, audit binding, restart recovery, queue cancellation, memory scope, formatting; actual browser QA; read-only QQ/provider probes. Live QQ sends require configured persona and runtime activation.

## Deferred at user's request
- Feature-building subagents and subsessions: parent-owned task scope, fixed depth/concurrency/time budgets; isolated branch/workspace; package manifests; tests and owner approval before installing generated extensions. Child agents inherit tighter permissions and cannot publish or approve their own work.
- ComfyUI: local endpoint discovery, workflow allowlist, input/output schema, job cancellation, resource quotas, preview and audit before QQ delivery. Do not restart or modify existing ComfyUI workloads.

## Memory optimization implemented (2026-10-21, v0.2)
- Scope-first local lexical retrieval, mention/participant matching, bounded candidates, actual observer memory allowlist, compact rows, same-scope historical evidence lookup.
- Hard application-text input bound at final assembly, with immutable system/persona instructions, explicit truncation markers and separate provider-reported token usage.
- Typed facts/events/persona impressions/expiring topic drafts; stable fact keys; normalized duplicate detection; pending update/expire operations; version checks and transactional human approval; protected manual edits.
- Optional read-only formal baseline for debug (off by default); debug mutations remain isolated. Existing records are interpreted compatibly without rewriting their text or approvals.
- Short-term topic drafts share the existing memory worker and human review. No additional permanent agent or automatic approval was added.
- Future evaluation: semantic retrieval when lexical recall is insufficient; richer multilingual aliases; source-grounded recall/attribution evaluation over more conversations. Track observer + reply + memory usage together; the current snapshot character comparison does not prove token or cost savings.

## Deployment boundaries
- A venv is dependency isolation, not an OS sandbox. Arbitrary code remains disabled unless an OS isolation backend is verified. Fixed media handlers must not take shell commands from models.
- Browser extension needs the user to load/pair it in the existing Chrome profile. It reads rendered content in authorized Bilibili/X tabs; it does not claim a complete account export.
- Unknown delivery is never automatically retried. New topics expire and need a new approval after content/persona/config changes.

- Claude additionally supports explicit per-role API transport (Anthropic Messages / OpenAI-compatible Chat Completions), separate model catalog, local secret storage and owner-editable prompt presets. Offline synthetic request previews never invoke models; final expanded text obeys the existing input budget. Native remains the default.

- Explicitly enabled Claude API chat queries support web_search and web_read for reply/preview only; bounded tool loop, SSRF-safe public HTTPS fetch, cancellation and model-round accounting. Observer classifies public chat queries as eligible conversation. No arbitrary command/file/configuration or QQ-sending tools.

- Tool calls now require independent per-batch tool_audit approval from the configured auditor. No fixed four-call ceiling; time/daily budgets remain. Tool history gets a separate bounded window with source-preserving compaction. Ordinary chat over-splitting is packed, then shortened once if needed; approved proactive content remains immutable.
