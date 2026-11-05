# Agent guide · QQ 群友

Local QQ group companion: Node 24 (ESM, no build step), SQLite via `node:sqlite`, OneBot 11 over loopback HTTP + WebSocket, and native model clients (Codex app-server, Claude Agent SDK, DeepSeek ACP). The dashboard is static files in `public/` served by `src/server.js` on 127.0.0.1:4891.

## If you were asked to deploy this

Follow **[DEPLOY.md](DEPLOY.md)** step by step, and obey its section 0 rules. In short:

- Never send QQ messages, never press or call 「启动群友」, never turn off debug mode. The user does the first live run.
- Never print, copy or upload anything from `data/` (tokens, admin key, chat database).
- Stop and ask the user for: QR-code QQ login, ChatGPT / Claude logins, the bot QQ number, their own QQ number, group numbers, and persona text.
- Start the service only with `powershell -NoProfile -ExecutionPolicy Bypass -File .\start.ps1 -NoBrowser` (or the user double-clicking 启动QQ群友.cmd), never `npm start` / `node src/server.js` / `Start-Process`. Agent terminals usually run inside a Windows job object, and everything launched from them is killed when the session ends; `start.ps1` launches through WMI (`Win32_Process.Create`) so the server outlives your session. Start a OneBot bridge you launch (e.g. SnowLuma) the same way.
- Done means `node scripts/doctor.js` prints `"passed": true` (its `personas` check passes only after the user writes a persona).

## Map

| Path | What |
|---|---|
| `src/server.js` | HTTP API, auth (admin key → cookie, same-origin header), static dashboard |
| `src/engine.js` | Receive → wake rules → (observer for chatter: a fresh snapshot, or with `wake.observerSession` a long-lived DeepSeek session per group that gets only deltas; it returns a decision and a `focus` ref, not the reply's context) → reply (the last `participation.replyMessages` messages from `context()`, 15 by default, plus `focus` when older) → split → outbox; memory extraction; proactive topics and approvals |
| `src/wake.js` | Cheap pre-model rules after qq-bridge: direct reasons (@, reply to bot, names, keywords) skip the observer; allowlisted private chats always go to the observer (told it is a private chat) but skip its rate limits and the reply cooldown/hourly cap; batch windows; observer rate limits; settings validation |
| `src/model-view.js` | Compact model-facing chat table (ref, who, minutes ago, text, reply ref); refs map back to message ids |
| `src/onebot.js` | OneBot 11 client: loopback-only URLs, allowlisted actions, account identity checks |
| `src/links.js` | Share cards (ark `json`, `share`), merged forwards and files → one sanitized line of message text; no network |
| `src/forward.js` | Merged-forward transcripts from OneBot `get_forward_msg` and the NSFW word check; a hit is never shown to a model and gets `media.nsfwReply` |
| `src/wander.js` | Allowlisted Bilibili/YouTube links (X deliberately off) → Wander's local `POST /api/read-link` (Bearer linkToken); the cleaned note, plus a subtitle excerpt (or top comments without subtitles) when Wander has one, is attached to the message as `linkNotes`. The observer sees only the one-line note; the reply model also gets the excerpt as `links`, and its `web_read` of a video page goes to Wander |
| `src/helper.js` · `scripts/helper-runner.js` · `public/helper-view.js` | 帮手: the reply model may add `task` to its answer (any provider; the note and field are in its instructions only while `helper.enabled`). `Engine.startTask` audits it with the tool auditor unless the owner asked (`prompt.owner`), then runs a Claude Agent SDK session in `workspace/helper` with `tools: WebSearch, WebFetch` only; `helperPermission` (canUseTool) lets WebFetch reach public pages only, by name and DNS. Both SDK runners pass `strictMcpConfig` and `settings.disableClaudeAiConnectors`, so the owner's claude.ai connectors (Gmail, GitHub, Drive…) never load (~60k tokens a call otherwise). The persona prompt and the preset blocks that reach replies (or name `helper`) are its character; they are not in its prompt but behind an in-process `character` tool (`createSdkMcpServer`) it calls only when a task must be answered in character. The result comes back as a second reply turn with `data.task` and the same system text (cache). If that run fails and the task was not cancelled, `helper.fallback` (on by default) runs it once more on Codex (`helper.fallbackModel` / `fallbackEffort`): `Providers.codexWeb`, a second `codex app-server` process started with `web_search="live"` (the companion one keeps it disabled), whose `CodexTransport.helper` thread gets `CODEX_HELPER_BASE`, the same `HELPER_SYSTEM`, and the character as a dynamic tool answered from `item/tool/call`; only `webSearch` and `dynamicToolCall` items are let through (anything else stops the process), and the search runs on OpenAI's servers, so it cannot reach this computer or the LAN. The task row then has `via: 'codex'`. One task per chat, two in all, `helper.dailyTasks` a day; records are kind `helper-task` |
| `src/memory-sort.js` · `public/sort-view.js` | 记忆整理: an owner-started audit of one chat's live memories with the memory role, a person at a time. It proposes merging redundant ones, condensing, archiving (`archived`: kept, but `rankMemories` recalls one only on three shared terms with the recent chat, at most three at a time), expiring and fixing category/key, as a `memory-sort` plan the owner reviews on the 群友与记忆 page. Applying keeps protection and actor, writes revisions, and skips memories that changed since |
| `src/visual.js` · `public/visual-view.js` | 画面图鉴: catalogued only from image interpretations the owner wrote (`media.source==='owner'`), four notes with their pictures per call to the 画面识别 (`perception`) role; an edit schedules a run 20 s later. Entries (name, aliases, look, notes, source images) go to every image analysis as `known`; owner-edited entries are never rewritten, and owner-annotated images are never evicted from the cache |
| `src/memes.js` · `public/meme-view.js` | 梗词典: the observer's optional `memes` output flags terms it does not understand; after `memes.minMentions` flags (or two people) Wander researches one (`POST /api/research-meme`, at most `researchDaily` a day) into an entry the owner reviews on the 梗词典 page. Approved, non-NSFW entries whose term or alias appears in recent messages go to the observer and the reply as `memes` (string match, no model call) |
| `src/pace.js` | Per-reply length lean (drawn, wider for direct questions), sent in the reply's `data`. Nothing that writes messages (the reply, its helper follow-up, the helper) gets a clock or date; every chat table keeps the per-message minutes-ago column (`ago`), so old chat reads as old |
| `src/providers.js` | Codex / Claude / DeepSeek adapters; native tools disabled, Claude API optionally exposes public chat queries. One shared DeepSeek Harness process holds the observer sessions (`turn`, `sessionInfo`, `dropSession`); DeepSeek token usage is read from DSH's session projection cache |
| `src/claude-api.js` | API request building and the tool loop: preset blocks, budget, web tools, and the prompt-cache breakpoints (stable prefix 1 h by default, moving 5 min mark across tool rounds). A spec with `transport: 'api'` goes through `Providers.apiFor`: `claude` to `secrets.claudeApi`, `codex` to `secrets.openaiApi` (`openaiConnection`, protocol `responses`). The loop stays in the chat shape; `toResponses` / `fromResponses` translate each round for OpenAI's Responses API (`store:false`, reasoning items replayed with their tool calls, any hosted-tool item refused) |
| `src/store.js` | Single `records` table (kind + JSON body + version) with optimistic locking |
| `src/stickers.js` | Content-addressed image library (sha256 → one interpretation, owner edits win), sticker repertoire and its short-code menu; bytes in `data/media-cache/` |
| `src/config.js` | Defaults and `assertConfig` validation; a fresh install has no QQ identity |
| `public/` | Dashboard (`app.js`, `memory-view.js`, `style.css`); CSP forbids inline scripts and styles |
| `scripts/setup.js` · `configure.js` · `doctor.js` | First-run setup, headless identity setup, read-only health check |
| `scripts/voice-stats.js` | Read-only reply-length statistics vs how people type in the same groups (counts only, no text) |
| `test/` | `node --test` suites on in-memory stores with synthetic QQ numbers (`test/fixture.js`) |

## Working on the code

- `npm test` must pass. Tests never touch `data/` or QQ.
- Match the existing dense one-line-per-method style; keep comments sparse and about *why*.
- Keep the safety properties: loopback-only OneBot, private-chat allowlist, no native model tools (Claude API may use only explicitly enabled public web queries), approvals bound to content digests, no automatic resend after an uncertain delivery.
- Use `node scripts/qa-server.js` (port 4892, synthetic data, cannot send) to look at UI changes, never the live server.
- Keep each role's `system` text byte-identical from call to call (put per-call material in `data`): the Claude API caches everything before the quoted data, and any varying word in the instructions turns every call into a cache miss.

## Publishing

The checkout the bot runs from holds live data and owner-only files, so it is never pushed to the public repository. Publish from a separate clean clone of it instead:

1. Commit the change here, then run `node scripts/publish.js <path to the public clone>`. It copies the tracked files (never `data/`, `workspace/`, `verification/` or `docs/presets/`), removes files deleted here, and scans the copy for the markers in `data/release-markers.txt` and for QQ numbers, group names and persona text from the live config. Any hit stops it; fix the source and run it again.
2. In the clone: `npm ci`, `npm test`, commit with the owner's GitHub noreply address, push.
