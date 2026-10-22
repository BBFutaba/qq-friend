// Minimal Agent Client Protocol (ACP) client.
// Speaks newline-delimited JSON-RPC 2.0 over an agent subprocess's stdio.
// Zero dependencies on purpose, so protocol changes are easy to see and patch here.

import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { contextSnapshot, sessionMetadata, flattenOptions } from "./usage.js";
import { INLINE_IMAGE_TYPES } from "./attachments.js";

const MAX_INLINE_IMAGE = 5 * 1024 * 1024;   // larger images are linked by path instead
const MAX_INLINE_TOTAL = 15 * 1024 * 1024;  // inline image bytes per prompt

const PROTOCOL_VERSION = 1;
const IS_WIN = process.platform === "win32";

// Setup deadlines. Prompt deadlines are selected by the caller; all cancellations have a
// grace period, then terminate the adapter tree before releasing the caller's work lock.
const TIMEOUTS = {
  initialize: 180_000, // the first `npx -y` run downloads the adapter
  "session/new": 90_000,
  "session/list": 60_000,
  "session/resume": 90_000,
  "session/load": 180_000, // replays the whole history
  "session/close": 15_000,
  "session/set_config_option": 30_000,
  "session/set_mode": 30_000,
  authenticate: 300_000, // may open a browser and wait for the user to sign in
};

// ACP's "authentication required" error code.
export const AUTH_REQUIRED = -32000;

export class AcpConnection extends EventEmitter {
  constructor(agentId, spec, { logDir = null, debug = false } = {}) {
    super();
    this.agentId = agentId;
    this.spec = spec;
    this.nextId = 1;
    this.pending = new Map();      // request id -> { resolve, reject, method, timer }
    this.replaying = new Set();    // session ids currently replaying history (session/load)
    this.liveSessions = new Set(); // session ids open in this process
    this.sessionInfo = new Map();
    this.capabilities = null;
    this.agentInfo = null;
    this.authMethods = [];
    this.authStatus = null;        // { kind, label } from the adapter's _auth/status_update, if it sends one
    this.hasTools = true;          // coding agents can edit files and run commands
    this.closed = false;
    this.stopping = false;
    this.terminated = false;
    this.promptRuns = new Map();
    this.termination = new Promise((resolve) => { this.resolveTermination = resolve; });
    this.stderrTail = [];          // raw Buffers, decoded on demand (Windows consoles may not use UTF-8)
    this.debug = debug;
    this.log = openLog(logDir, agentId);
  }

  async start() {
    const { command, args = [], env = {} } = this.spec;
    this.#log(`--- starting: ${[command, ...args].join(" ")}`);
    // On Windows `npx` is `npx.cmd`, which Node can only launch through a shell. We pass one
    // pre-quoted command line instead of an args array (Node warns that args are not escaped
    // when a shell is used).
    this.usesShell = IS_WIN && !/\.exe$/i.test(command) && !["node", "codex"].includes(String(command).toLowerCase());
    this.startedAt = Date.now();
    this.proc = this.usesShell
      ? spawn([command, ...args].map(winQuote).join(" "), { cwd: this.spec.spawnCwd, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, ...env }, shell: true, windowsHide: true })
      : spawn(command, args, { cwd: this.spec.spawnCwd, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, ...env }, windowsHide: true, detached: !IS_WIN });

    this.processClose = new Promise((resolve) => {
      this.proc.once("close", (code, signal) => {
        this.processClosed = true;
        resolve({ code, signal });
        // close only proves inherited stdio is closed. Native tools can have ignored
        // stdio, so the exit handler must also confirm descendant cleanup.
        if (!this.stopping && !this.terminated) this.kill(this.exitError || new Error(`${this.agentId} exited (code ${code}).`));
      });
    });

    let buf = "";
    this.proc.stdout.setEncoding("utf8");
    this.proc.stdout.on("data", (chunk) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) this.#handleLine(line);
      }
    });

    this.proc.stderr.on("data", (buf) => {
      this.stderrTail.push(buf);
      if (this.stderrTail.length > 40) this.stderrTail.shift();
      const chunk = decodeConsole(buf);
      this.#log(`[stderr] ${chunk.trimEnd()}`);
      if (this.debug) process.stderr.write(`[${this.agentId}] ${chunk}`);
    });
    // Writing to a process that just died raises EPIPE on stdin; without a handler that crashes the hub.
    this.proc.stdin.on("error", (err) => this.#transportFailure(err));

    const exited = new Promise((_, reject) => {
      this.proc.on("error", (err) => reject(new Error(`Couldn't start ${this.agentId}: ${err.message}`)));
    });

    this.proc.on("exit", (code) => {
      const detail = this.stderrText().trim().split("\n").slice(-3).join(" ");
      this.exitError = new Error(`${this.agentId} exited (code ${code})${detail ? `: ${detail}` : ""}`);
      this.#log(`--- exited with code ${code}`);
      if (!this.stopping) this.kill(this.exitError);
    });

    const init = await Promise.race([
      this.request("initialize", {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        clientInfo: { name: "agent-hub", version: "0.5.0" },
      }),
      exited,
    ]).catch(async (err) => { await this.kill(err); throw err; });
    this.protocolVersion = init?.protocolVersion ?? null;
    this.capabilities = init?.agentCapabilities ?? {};
    this.agentInfo = init?.agentInfo ?? null;
    this.authMethods = init?.authMethods ?? [];
    const early = init?.agentCapabilities?._meta?.authStatus;
    if (early?.kind) this.authStatus = early;
    return init;
  }

  // The adapter's recent error output as text.
  stderrText() {
    return decodeConsole(Buffer.concat(this.stderrTail));
  }

  get supports() {
    const c = this.capabilities || {};
    const s = c.sessionCapabilities || {};
    return {
      load: Boolean(c.loadSession),
      resume: s.resume != null,
      list: s.list != null,
      close: s.close != null,
      // Custom adapters may explicitly implement this extension: advertised true means
      // session/prompt with _meta.agentHub.toolPolicy="none" disables every native and
      // remote tool for that turn. Standard ACP read-only/plan modes do not promise this.
      textOnly: c._meta?.agentHub?.textOnly === true,
    };
  }

  request(method, params) {
    if (this.closed || this.stopping) return Promise.reject(new Error(`${this.agentId} is not running`));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const ms = TIMEOUTS[method];
      const timer = ms && setTimeout(() => {
        const error = new Error(`${this.agentId} didn't answer ${method} within ${Math.round(ms / 1000)}s.`);
        // The session picker can time out independently of a healthy coding turn.
        // Once retirement has started, even metadata waits for the same barrier.
        if (method === "session/list" && !this.stopping) {
          this.pending.delete(id);
          reject(error);
          return;
        }
        // A setup request can still be executing in the adapter. Retire the whole
        // connection and keep this request pending until termination is confirmed,
        // including when another timeout has already started that retirement.
        this.kill(error);
      }, ms);
      this.pending.set(id, { resolve, reject, method, timer });
      if (!this.#send({ jsonrpc: "2.0", id, method, params })) {
        this.#transportFailure(new Error(`${this.agentId}'s input pipe is closed.`));
      }
    });
  }

  notify(method, params) {
    if (!this.closed) this.#send({ jsonrpc: "2.0", method, params });
  }

  // ---- Auth ----

  authenticate(methodId) {
    return this.request("authenticate", { methodId });
  }

  // ---- Session lifecycle ----

  async newSession(cwd) {
    const res = await this.request("session/new", { cwd, mcpServers: [] });
    this.#rememberSession(res.sessionId, res);
    this.liveSessions.add(res.sessionId);
    return res.sessionId;
  }

  // Reopen an existing session (one made earlier by the hub, or one from the agent's own app).
  // Prefers session/resume (no history replay); falls back to session/load (replays history,
  // which we swallow so it doesn't flood the group chat).
  async reopenSession(sessionId, cwd) {
    if (this.liveSessions.has(sessionId)) return "live";
    const { resume, load } = this.supports;
    if (resume) {
      const res = await this.request("session/resume", { sessionId, cwd, mcpServers: [] });
      this.#rememberSession(sessionId, res);
      this.liveSessions.add(sessionId);
      return "resumed";
    }
    if (load) {
      this.replaying.add(sessionId);
      try {
        const res = await this.request("session/load", { sessionId, cwd, mcpServers: [] });
        this.#rememberSession(sessionId, res);
      } finally {
        this.replaying.delete(sessionId);
      }
      this.liveSessions.add(sessionId);
      return "loaded";
    }
    throw new Error(`${this.agentId} can't reopen existing sessions (no session/resume or session/load support).`);
  }

  // Frees the session in the adapter process. The session itself stays in the agent's own app.
  async closeSession(sessionId) {
    if (!this.liveSessions.has(sessionId)) return;
    this.liveSessions.delete(sessionId);
    if (this.supports.close) await this.request("session/close", { sessionId }).catch(() => {});
  }

  async listSessions(cwd) {
    if (!this.supports.list) throw new Error(`${this.agentId} doesn't support listing sessions. Paste a session ID instead.`);
    const all = [];
    let cursor;
    for (let page = 0; page < 10; page++) {
      const res = await this.request("session/list", { ...(cwd ? { cwd } : {}), ...(cursor ? { cursor } : {}) });
      all.push(...(res?.sessions ?? []));
      cursor = res?.nextCursor;
      if (!cursor) break;
    }
    return all;
  }

  promptTextOnly(sessionId, text, options = {}) {
    return this.prompt(sessionId, text, { ...options, textOnly: true });
  }

  async prompt(sessionId, text, { signal, timeoutMs, cancelGraceMs = 5000, textOnly = false, attachments = [] } = {}) {
    if (textOnly && !this.supports.textOnly) throw new Error(`${this.agentId} does not advertise an enforceable text-only mode.`);
    if (signal?.aborted) throw Object.assign(new Error(`${this.agentId} prompt cancelled.`), { name: "AbortError" });
    if (this.promptRuns.has(sessionId)) throw new Error(`${this.agentId} already has a prompt running in this session.`);
    if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) throw new Error("Prompt timeout must be a positive number.");
    if (!Number.isFinite(cancelGraceMs) || cancelGraceMs < 0) throw new Error("Cancellation grace must be a nonnegative number.");
    let cancelled = false, timeoutError, graceTimer, deadline;
    const cancel = () => {
      if (cancelled) return;
      cancelled = true;
      this.notify("session/cancel", { sessionId });
      graceTimer = setTimeout(() => {
        this.kill(timeoutError || new Error(`${this.agentId} did not stop within the cancellation grace period.`));
      }, cancelGraceMs);
    };
    this.promptRuns.set(sessionId, { cancel });
    signal?.addEventListener("abort", cancel, { once: true });
    if (timeoutMs !== undefined) deadline = setTimeout(() => {
      timeoutError = Object.assign(new Error(`${this.agentId} prompt exceeded its ${Math.round(timeoutMs / 1000)}s deadline.`), { code: "ACP_PROMPT_TIMEOUT" });
      cancel();
    }, timeoutMs);
    try {
      const prompt = [{ type: "text", text }, ...this.#attachmentBlocks(attachments)];
      const result = await this.request("session/prompt", { sessionId, prompt, ...(textOnly ? { _meta: { agentHub: { toolPolicy: "none" } } } : {}) });
      if (timeoutError) throw timeoutError;
      return cancelled ? { ...result, stopReason: "cancelled" } : result;
    } catch (err) {
      throw timeoutError || err;
    } finally {
      clearTimeout(deadline); clearTimeout(graceTimer);
      signal?.removeEventListener("abort", cancel);
      this.promptRuns.delete(sessionId);
    }
  }

  // Attached files as ACP content: images inline when the adapter accepts them and they're small enough,
  // everything else as a link to the saved file (every ACP agent must accept resource links).
  #attachmentBlocks(files) {
    const images = this.capabilities?.promptCapabilities?.image === true;
    let inline = 0;
    return files.flatMap((f) => {
      if (!existsSync(f.abs)) return [];
      const uri = pathToFileURL(f.abs).href;
      if (images && INLINE_IMAGE_TYPES.has(f.mime) && f.size <= MAX_INLINE_IMAGE && inline + f.size <= MAX_INLINE_TOTAL) {
        inline += f.size;
        return [{ type: "image", mimeType: f.mime, data: readFileSync(f.abs).toString("base64"), uri }];
      }
      return [{ type: "resource_link", uri, name: f.name, mimeType: f.mime, size: f.size }];
    });
  }

  cancel(sessionId) {
    const run = this.promptRuns.get(sessionId);
    if (run) run.cancel();
    else this.notify("session/cancel", { sessionId });
  }

  sessionState(sessionId) { return this.sessionInfo.get(sessionId) || { modelId: null, configOptions: [] }; }

  async setApprovalMode(sessionId, policy) {
    const info = this.sessionState(sessionId), modes = info.modes;
    const full = ["bypassPermissions", "agent-full-access", "danger-full-access", "full-access", "yolo"];
    const gated = ["read-only", "default", "manual", "ask"];
    const options = modes?.availableModes || [];
    const target = (policy === "unrestricted" ? full : gated).find((id) => options.some((m) => m.id === id));
    if (target && target !== modes.currentModeId) {
      await this.request("session/set_mode", { sessionId, modeId: target });
      this.#rememberSession(sessionId, { modes: { ...modes, currentModeId: target } });
    }
    if (policy !== "unrestricted" && !target && modes?.currentModeId && !gated.includes(modes.currentModeId)) throw new Error("This session cannot switch back to a manual approval mode. Reset it before continuing.");
    return { policy, nativeMode: target || modes?.currentModeId || null, scope: target ? "native-and-hub" : "hub-requests-only",
      note: target ? "Native mode and hub approval policy applied." : "This adapter does not expose a compatible native mode; hub policy applies to its permission requests. Provider sandbox restrictions remain." };
  }

  async setConfig(sessionId, configId, value) {
    const option = this.sessionState(sessionId).configOptions.find((o) => o.id === configId);
    if (!option || !["model", "thought_level", "model_config"].includes(option.category) && !["model", "reasoning_effort"].includes(option.id)) {
      throw Object.assign(new Error("This model setting is not available for this session."), { status: 400 });
    }
    if (!flattenOptions(option.options).some((o) => o.value === value)) throw Object.assign(new Error("Select one of the advertised setting values."), { status: 400 });
    const res = await this.request("session/set_config_option", { sessionId, configId, value });
    this.#rememberSession(sessionId, res);
    return this.sessionState(sessionId);
  }

  #rememberSession(sessionId, result) {
    this.sessionInfo.set(sessionId, sessionMetadata(result || {}, this.sessionInfo.get(sessionId)));
    this.emit("session", sessionId, this.sessionState(sessionId));
  }

  kill(reason = new Error(`${this.agentId} stopped.`)) {
    if (this.terminated || this.stopping) return this.termination;
    this.stopping = true;
    if (!this.proc?.pid) {
      this.#finishExit(reason);
      return this.termination;
    }
    // A native adapter executable can launch tools too; /T is needed even without cmd.exe.
    // Keep pending requests and the manager entry quarantined if tree termination fails.
    // Rejecting early would release workspace locks while an old tool could still write.
    this.#terminateTree().then(async () => {
      await this.processClose;
      this.#finishExit(reason, this.proc.exitCode);
    }).catch((err) => {
      this.terminationError = new Error(`${this.agentId} could not confirm process-tree termination: ${err.message}. It remains blocked; stop the process tree before restarting the hub.`);
      this.#log(this.terminationError.message);
      this.emit("termination_error", this.terminationError);
    });
    return this.termination;
  }

  async #terminateTree() {
    // Scope: terminate the observable OS process tree/group. Windows cannot reconstruct
    // detached descendants whose intermediate ancestors disappeared before inspection;
    // this is not a Windows Job Object or a general sandbox containment guarantee.
    if (IS_WIN) {
      // Once the root exits, taskkill /T cannot discover its orphaned children. Windows
      // retains ParentProcessId; clean those verified descendants before unlocking.
      if (this.proc.exitCode != null || this.proc.signalCode != null) return this.#terminateOrphans();
      try {
        await new Promise((resolve, reject) => {
          const killer = spawn("taskkill", ["/pid", String(this.proc.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
          killer.once("error", reject);
          killer.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`taskkill exited ${code}`)));
        });
      } catch (err) {
        if (this.proc.exitCode != null || this.proc.signalCode != null) return this.#terminateOrphans();
        throw err;
      }
    } else {
      try { process.kill(-this.proc.pid, "SIGKILL"); }
      catch (err) { if (err.code !== "ESRCH") throw err; }
    }
  }

  async #terminateOrphans() {
    // Inspect process identity metadata only, never command lines. A reused PID or an
    // unavailable process inventory fails closed. Keep discovered parents across passes
    // so a child created just before its parent is killed cannot evade the next pass.
    const script = `
$ErrorActionPreference = 'Stop'
try {
  $rootPid = ${this.proc.pid}
  $cutoff = [DateTimeOffset]::FromUnixTimeMilliseconds(${this.startedAt}).UtcDateTime.AddSeconds(-1)
  $known = @{}
  $known[$rootPid] = $null
  for ($pass = 0; $pass -lt 10; $pass++) {
    $items = @(Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,CreationDate)
    if ($items | Where-Object { [int]$_.ProcessId -eq $rootPid }) { throw 'Exited adapter PID has been reused; cleanup cannot safely continue.' }
    foreach ($item in $items) {
      $id = [int]$item.ProcessId
      if ($known.ContainsKey($id) -and $known[$id] -ne $null -and $known[$id] -ne $item.CreationDate) { throw 'Descendant PID has been reused; cleanup cannot safely continue.' }
    }
    do {
      $added = $false
      foreach ($item in $items) {
        $id = [int]$item.ProcessId
        if (!$known.ContainsKey($id) -and $known.ContainsKey([int]$item.ParentProcessId) -and $item.CreationDate.ToUniversalTime() -ge $cutoff) {
          $known[$id] = $item.CreationDate
          $added = $true
        }
      }
    } while ($added)
    $children = @($items | Where-Object { $known.ContainsKey([int]$_.ProcessId) })
    if ($children.Count -eq 0) { exit 0 }
    foreach ($item in $children) {
      $live = Get-Process -Id ([int]$item.ProcessId) -ErrorAction SilentlyContinue
      if ($null -eq $live) { continue }
      try {
        if ($live.HasExited) { continue }
        if ([Math]::Abs(($live.StartTime.ToUniversalTime() - $item.CreationDate.ToUniversalTime()).TotalMilliseconds) -gt 1) { throw 'Descendant process identity changed before termination.' }
        $live.Kill()
        if (!$live.WaitForExit(5000)) { throw 'A descendant process did not exit.' }
      } catch { if (!$live.HasExited) { throw } }
      finally { $live.Dispose() }
    }
  }
  throw 'Descendant cleanup did not converge.'
} catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }
`;
    await new Promise((resolve, reject) => {
      const checker = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
      let detail = "";
      checker.stderr.on("data", (chunk) => { detail = (detail + chunk.toString()).slice(-2000); });
      checker.once("error", reject);
      checker.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`descendant cleanup exited ${code}: ${detail.trim()}`)));
    });
  }

  #finishExit(err, code = null) {
    if (this.terminated) return;
    this.closed = true;
    this.terminated = true;
    this.stopping = false;
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(err); }
    this.pending.clear();
    this.liveSessions.clear();
    this.resolveTermination();
    this.emit("exit", code);
    this.log?.end();
  }

  // ---- Wire handling ----

  #transportFailure(err) {
    if (this.closed || this.stopping) return;
    this.#log(`[transport error] ${err.message}`);
    this.kill(new Error(`${this.agentId} connection failed: ${err.message}`));
  }

  #send(msg) {
    if (this.closed || this.stopping || !this.proc?.stdin.writable) return false;
    const line = JSON.stringify(msg);
    if (this.debug) this.#log(`>>> ${clip(line)}`);
    try { this.proc.stdin.write(line + "\n"); return true; }
    catch (err) { this.#transportFailure(err); return false; }
  }

  #log(text) {
    this.log?.write(`${new Date().toISOString()} ${text}\n`);
  }

  #handleLine(line) {
    // A late answer during forced termination is not proof its child tools have stopped.
    if (this.stopping || this.closed) return;
    if (this.debug) this.#log(`<<< ${clip(line)}`);
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      this.#log(`[non-JSON stdout] ${clip(line)}`);
      return; // agents occasionally print banners; ignore non-JSON lines
    }

    // Response to one of our requests
    if (msg.id != null && !msg.method) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) {
        const e = new Error(`${p.method}: ${msg.error.message || "agent error"}`);
        e.code = msg.error.code;
        e.data = msg.error.data;
        e.method = p.method;
        p.reject(e);
      } else p.resolve(msg.result);
      return;
    }

    // Some adapters (Claude, Codex) report sign-in state with this extension notification.
    if (msg.method === "_auth/status_update" && msg.id == null) {
      const st = msg.params?.authStatus;
      if (st?.kind) {
        this.authStatus = { kind: st.kind, label: st.label || st.kind };
        this.emit("auth", this.authStatus);
      }
      return;
    }

    // Notification from the agent
    if (msg.method === "session/update") {
      const { sessionId, update } = msg.params || {};
      if (update?.sessionUpdate === "config_option_update") this.#rememberSession(sessionId, update);
      if (update?.sessionUpdate === "current_mode_update") {
        const prior = this.sessionState(sessionId);
        this.#rememberSession(sessionId, { modes: { ...prior.modes, currentModeId: update.currentModeId } });
      }
      if (update?.sessionUpdate === "usage_update") {
        const state = this.sessionState(sessionId);
        this.sessionInfo.set(sessionId, { ...state, context: contextSnapshot(update.used, update.size), sessionCost: update.cost ?? state.sessionCost ?? null });
        this.emit("session", sessionId, this.sessionState(sessionId));
      }
      if (this.replaying.has(sessionId)) return;
      this.emit("update", sessionId, update);
      return;
    }

    // Request from the agent to us
    if (msg.method && msg.id != null) {
      if (msg.method === "session/request_permission") {
        let answered = false;
        const respond = (outcome) => {
          if (answered) return;
          answered = true;
          this.#send({ jsonrpc: "2.0", id: msg.id, result: { outcome } });
        };
        try { this.emit("permission", msg.params, respond); }
        catch (err) {
          respond({ outcome: "cancelled" });
          this.#log(`Permission handler failed; request cancelled: ${err.message}`);
        }
        return;
      }
      // We don't advertise fs/terminal capabilities, so agents shouldn't call them.
      this.#send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `Method not supported by agent-hub: ${msg.method}` } });
    }
  }
}

// Windows consoles on Chinese (and other) systems print in the local code page, not UTF-8.
function decodeConsole(buf) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    for (const enc of IS_WIN ? ["gbk", "windows-1252"] : []) {
      try { return new TextDecoder(enc).decode(buf); } catch {}
    }
    return buf.toString("utf8");
  }
}

export function isAuthError(err) {
  return err?.code === AUTH_REQUIRED || /auth(entication)? required|not (logged|signed) in|please (log|sign) in/i.test(err?.message || "");
}

// Quote one argument for a cmd.exe command line.
function winQuote(a) {
  const s = String(a);
  return /^[\w@%+=:,./\\-]+$/.test(s) ? s : `"${s.replace(/"/g, '""')}"`;
}

function clip(s, n = 4000) {
  return s.length > n ? s.slice(0, n) + `…(+${s.length - n} chars)` : s;
}

export function openLog(dir, agentId) {
  if (!dir) return null;
  try {
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${agentId}.log`);
    if (existsSync(file) && statSync(file).size > 5 * 1024 * 1024) renameSync(file, file + ".1");
    const stream = createWriteStream(file, { flags: "a" });
    stream.on("error", () => {});
    return stream;
  } catch {
    return null;
  }
}
