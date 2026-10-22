import { existsSync, readdirSync, statSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";

// A desktop-launched npm terminal doesn't inherit the Codex app's private PATH.
// Resolve installed binaries per machine instead of pinning a desktop release hash.
export function codexLaunch(spec = {}, env = process.env) {
  const requested = env.HUB_CODEX_COMMAND || spec.command || "codex";
  const args = spec.args || ["app-server"];
  if (!/^codex(?:\.exe|\.cmd)?$/i.test(requested)) return { command: requested, args };
  const candidates = [];
  for (const folder of (env.PATH || env.Path || "").split(delimiter).filter(Boolean)) {
    const binary = join(folder, process.platform === "win32" ? "codex.exe" : "codex");
    if (existsSync(binary) && statSync(binary).isFile()) return { command: binary, args };
    const js = join(folder, "node_modules", "@openai", "codex", "bin", "codex.js");
    if (existsSync(js)) return { command: process.execPath, args: [js, ...args] };
  }
  const local = env.LOCALAPPDATA;
  if (local) {
    const root = join(local, "OpenAI", "Codex", "bin");
    try {
      const versions = readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory())
        .map((e) => join(root, e.name, "codex.exe")).filter(existsSync)
        .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
      candidates.push(...versions);
    } catch {}
  }
  const command = candidates.find((p) => existsSync(p) && statSync(p).isFile());
  if (command) return { command, args };
  const npm = env.APPDATA && join(env.APPDATA, "npm", "node_modules", "@openai", "codex", "bin", "codex.js");
  if (npm && existsSync(npm)) return { command: process.execPath, args: [npm, ...args] };
  // Opt-in last resort for machines with only Node (the packaged build sets "npxPackage"): run a pinned
  // Codex release through the npx that ships with this Node.
  const npx = join(dirname(process.execPath), "node_modules", "npm", "bin", "npx-cli.js");
  if (spec.npxPackage && existsSync(npx)) return { command: process.execPath, args: [npx, "-y", spec.npxPackage, ...args] };
  throw new Error("Codex executable was not found. Install Codex or set HUB_CODEX_COMMAND to the full codex.exe path, then restart Agent Hub. The editor and supervisor use your existing Codex ChatGPT sign-in.");
}
