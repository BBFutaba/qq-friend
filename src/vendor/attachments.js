// Files the user drops into a channel are saved in the project's own folder, sorted by kind:
//   <project folder>/attachments/<images|documents|text|data|code|media|archives|other>/<file name>
// Agents get the saved path (and, when their adapter accepts them, the images themselves), so they can
// open the files with their own tools. Only files inside that attachments folder can be referenced or served.
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join, relative, resolve, sep } from "node:path";

export const ATTACHMENTS_DIR = "attachments";
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_MESSAGE = 10;

const KINDS = {
  images: "png jpg jpeg gif webp bmp svg ico tif tiff avif heic heif",
  documents: "pdf doc docx odt rtf xls xlsx ods ppt pptx odp epub pages key numbers",
  text: "txt md markdown log rst tex",
  data: "csv tsv json jsonl ndjson json5 yaml yml xml toml ini cfg conf sql parquet sqlite db",
  code: "js mjs cjs jsx ts tsx py ipynb rb go rs java kt kts scala c h cc cpp hpp cs php sh bash zsh ps1 psm1 bat cmd lua swift r m mm pl dart vue svelte html htm css scss sass less gd gdshader tscn tres shader hlsl glsl cginc zig nim ex exs erl hs clj fs fsx",
  media: "mp3 wav ogg flac m4a aac mp4 mov webm mkv avi",
  archives: "zip 7z rar tar gz tgz bz2 xz",
};
const KIND_OF = new Map(Object.entries(KINDS).flatMap(([kind, exts]) => exts.split(" ").map((e) => [`.${e}`, kind])));
const MIME = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp",
  ".svg": "image/svg+xml", ".ico": "image/x-icon", ".avif": "image/avif", ".pdf": "application/pdf",
  ".md": "text/markdown", ".markdown": "text/markdown", ".csv": "text/csv", ".json": "application/json", ".html": "text/html", ".xml": "application/xml",
};
// The image types model providers accept inline; other images are linked by path.
export const INLINE_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

export const kindOf = (name) => KIND_OF.get(extname(String(name)).toLowerCase()) || "other";
export function mimeOf(name) {
  const ext = extname(String(name)).toLowerCase();
  return MIME[ext] || (["text", "data", "code"].includes(kindOf(name)) ? "text/plain" : "application/octet-stream");
}

const err = (status, message) => Object.assign(new Error(message), { status });
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

// A file name that's safe on every OS, keeping the extension: no folders, no reserved names or characters.
export function safeName(name) {
  let s = String(name ?? "").split(/[\\/]/).pop().normalize("NFC");
  s = s.replace(/[\u0000-\u001f<>:"|?*]/g, "_").replace(/[. ]+$/, "").trim();
  const ext = extname(s).slice(0, 16);
  let stem = s.slice(0, s.length - extname(s).length) || "file";
  if (RESERVED.test(stem)) stem = `${stem}_`;
  if (stem.startsWith(".")) stem = `_${stem}`;
  return `${stem.slice(0, 120)}${ext}`;
}

function describe(cwd, abs) {
  const name = basename(abs);
  return { name, path: relative(cwd, abs).split(sep).join("/"), size: statSync(abs).size, mime: mimeOf(name), kind: kindOf(name) };
}

// Saves the bytes under <cwd>/attachments/<kind>/. The same file dropped twice is stored once; a different
// file with a taken name becomes "name (2).ext".
export function saveAttachment(cwd, name, bytes) {
  if (!cwd || !existsSync(cwd) || !statSync(cwd).isDirectory()) throw err(409, "This project's folder doesn't exist, so the file can't be saved there.");
  if (!bytes?.length) throw err(400, "That file is empty.");
  if (bytes.length > MAX_ATTACHMENT_BYTES) throw err(413, `Files can be at most ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB.`);
  const file = safeName(name);
  const dir = join(cwd, ATTACHMENTS_DIR, kindOf(file));
  mkdirSync(dir, { recursive: true });
  const ext = extname(file), stem = file.slice(0, file.length - ext.length);
  for (let n = 1; n < 10_000; n++) {
    const target = join(dir, n === 1 ? file : `${stem} (${n})${ext}`);
    try {
      writeFileSync(target, bytes, { flag: "wx" });
      return describe(cwd, target);
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      if (statSync(target).size === bytes.length && readFileSync(target).equals(bytes)) return describe(cwd, target);
    }
  }
  throw err(409, "Too many files with that name.");
}

// A path from a message or a request -> the file, if it really is inside this project's attachments folder.
export function resolveAttachment(cwd, path) {
  if (typeof path !== "string" || !path || path.includes("\0") || path.length > 1000) throw err(400, "Invalid attachment path.");
  const root = resolve(cwd, ATTACHMENTS_DIR);
  const abs = resolve(cwd, path);
  if (!abs.startsWith(root + sep)) throw err(400, "Attachments must be inside the project's attachments folder.");
  if (!existsSync(abs) || !statSync(abs).isFile()) throw err(404, `Attachment not found: ${path}`);
  const real = realpathSync(abs), realRoot = realpathSync(root);
  if (!real.startsWith(realRoot + sep)) throw err(400, "Attachments must be inside the project's attachments folder.");
  return { abs, ...describe(cwd, abs) };
}

export const sizeText = (n) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
