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
| `src/engine.js` | Receive → debounce → observer → reply → split → outbox; memory extraction; proactive topics and approvals |
| `src/onebot.js` | OneBot 11 client: loopback-only URLs, allowlisted actions, account identity checks |
| `src/providers.js` | Codex / Claude / DeepSeek adapters with all tools disabled |
| `src/store.js` | Single `records` table (kind + JSON body + version) with optimistic locking |
| `src/stickers.js` | Content-addressed image library (sha256 → one interpretation, owner edits win), sticker repertoire and its short-code menu; bytes in `data/media-cache/` |
| `src/config.js` | Defaults and `assertConfig` validation; a fresh install has no QQ identity |
| `public/` | Dashboard (`app.js`, `memory-view.js`, `style.css`); CSP forbids inline scripts and styles |
| `scripts/setup.js` · `configure.js` · `doctor.js` | First-run setup, headless identity setup, read-only health check |
| `test/` | `node --test` suites on in-memory stores with synthetic QQ numbers (`test/fixture.js`) |

## Working on the code

- `npm test` must pass. Tests never touch `data/` or QQ.
- Match the existing dense one-line-per-method style; keep comments sparse and about *why*.
- Keep the safety properties: loopback-only OneBot, private-chat allowlist, no model tools, approvals bound to content digests, no automatic resend after an uncertain delivery.
- Use `node scripts/qa-server.js` (port 4892, synthetic data, cannot send) to look at UI changes, never the live server.
