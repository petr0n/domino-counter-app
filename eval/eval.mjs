import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import jpeg from "jpeg-js";

// Offline eval harness: runs every fixture photo through the SAME pipeline the
// app uses (grayscale+contrast preprocess -> Claude count via the Worker proxy)
// and scores the result against eval/fixtures.json. Lets prompt/pipeline changes
// be measured against ground truth instead of guessed.
//
// Requires: the Worker host allowlisted for network egress, and photos in
// eval/photos/<name>.jpg matching the keys in fixtures.json.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const clamp = (v) => Math.min(12, Math.max(0, Number(v) || 0));

// PROXY_URL — single source of truth is config.js
const PROXY = (fs.readFileSync(path.join(ROOT, "config.js"), "utf8")
  .match(/PROXY_URL\s*=\s*["']([^"']+)["']/) || [])[1];
if (!PROXY) { console.error("Could not read PROXY_URL from config.js"); process.exit(1); }

// Reuse the LOCKED preprocessing from detect.js (grayscale + contrast stretch).
const win = {};
new Function("window", "cv", fs.readFileSync(path.join(ROOT, "detect.js"), "utf8"))(win, undefined);
const { stretchGray } = win.DominoCV._test;

const PROMPT   = fs.readFileSync(path.join(__dirname, "prompt.txt"), "utf8");
const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures.json"), "utf8"));
const MODEL    = process.env.MODEL || "claude-opus-4-8";
const PHOTOS   = path.join(__dirname, "photos");
const KEY      = process.env.ANTHROPIC_API_KEY; // if set, call the API directly

function preprocessB64(buf) {
  const raw = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true });
  stretchGray(raw.data); // in place: grayscale + contrast stretch (color-agnostic)
  return jpeg.encode({ data: Buffer.from(raw.data), width: raw.width, height: raw.height }, 90)
    .data.toString("base64");
}

async function count(b64) {
  const body = JSON.stringify({
    model: MODEL, max_tokens: 2048,
    messages: [{ role: "user", content: [
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } },
      { type: "text", text: PROMPT }
    ] }]
  });
  // Prefer a direct API key (api.anthropic.com is on the default allowlist);
  // fall back to the Worker proxy if no key is provided.
  const [url, headers] = KEY
    ? ["https://api.anthropic.com/v1/messages",
       { "Content-Type": "application/json", "x-api-key": KEY, "anthropic-version": "2023-06-01" }]
    : [`${PROXY}/anthropic`,
       { "Content-Type": "application/json", "Origin": "https://petr0n.github.io" }];
  const res = await fetch(url, { method: "POST", headers, body });
  const data = await res.json();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${JSON.stringify(data).slice(0, 200)}`);
  const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("");
  const m = text.match(/\{[\s\S]*\}/);
  return m ? (JSON.parse(m[0]).tiles || []).map(t => [clamp(t.left), clamp(t.right)]) : [];
}

const norm = (t) => (t[0] <= t[1] ? `${t[0]}-${t[1]}` : `${t[1]}-${t[0]}`);
function score(got, exp) {
  const pool = exp.map(norm);
  let correct = 0;
  for (const g of got.map(norm)) { const i = pool.indexOf(g); if (i >= 0) { correct++; pool.splice(i, 1); } }
  return correct;
}
const fmt = (a) => a.map(t => `${t[0]}|${t[1]}`).join(" ") || "—";

const names = Object.keys(fixtures).filter(k => !k.startsWith("_"));
let totC = 0, totE = 0, perfect = 0;
for (const name of names) {
  const exp = fixtures[name];
  const file = path.join(PHOTOS, name + ".jpg");
  if (!fs.existsSync(file)) { console.log(`${name}: photo missing (eval/photos/${name}.jpg)`); continue; }
  let got;
  try { got = await count(preprocessB64(fs.readFileSync(file))); }
  catch (e) { console.log(`${name}: ERROR ${e.message}`); continue; }
  const c = score(got, exp);
  totC += c; totE += exp.length;
  if (c === exp.length && got.length === exp.length) perfect++;
  const mark = (c === exp.length && got.length === exp.length) ? "✓" : "✗";
  console.log(`${mark} ${name}: got [${fmt(got)}]  exp [${fmt(exp)}]  ${c}/${exp.length}`);
}
console.log(`\nTOTAL: ${totC}/${totE} tiles correct · ${perfect}/${names.length} photos perfect`);
