# Reuse and provenance

Inspected 2026-10-21. Source projects are not modified.

| Source | Reuse |
|---|---|
| Tulpa chatlocal/onebot.py | Ported loopback-only endpoint validation, authenticated JSON actions, login identity checks and uncertain-write handling |
| Tulpa chatlocal/onebot_events.py | Ported independent HTTP/WS identity verification, heartbeat health and bounded reconnect |
| Tulpa chatlocal/mcp_chat.py | Adapted event deduplication, stale-context checks, single destination and unknown-send rules |
| Tulpa people/tulpa memory modules | Reviewed provenance and editable-memory UX; new schema separates public, private, persona and debug memory |
| Agent Hub src/acp-client.js | Vendored ACP transport, session config, cancellation and process cleanup |
| Agent Hub usage.js, attachments.js, process-launch.js | Vendored usage normalization, attachment types and installed Codex discovery |
| Agent Hub codex-editor.js | Adapted native ChatGPT app-server JSON-RPC lifecycle; credentials stay in Codex |

Tulpa (https://github.com/fumingyang2004/Tulpa) is MIT licensed; its license is preserved in TULPA-LICENSE. Agent Hub is the author's own project; the vendored files ship with this project.
The old Discord bridge implements OneBot 12. QQ uses a separate OneBot 11 adapter.
No chat database, model credentials or accounts are bundled. Each install configures its own OneBot connection, QQ accounts and groups, stored only in the ignored data/ folder.
