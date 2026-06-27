// Browser-faithful detection eval. Runs the REAL detect.js inside headless
// Chromium via Puppeteer, through the exact camera path. Unlike detect_eval.cjs
// (jpeg-js decode + hand-rolled stretchGray), this decodes pixels the same way
// the phone does, so failures seen on-device reproduce here.
//
//   node browser_eval.cjs            # committed detect_*_N.jpg fixtures
//   node browser_eval.cjs foo.jpg    # one fixture
//   node browser_eval.cjs --frames   # PHONE-EXACT: captured eval/sessions frames
//
// --frames runs the current code over the exact post-crop frames the phone saved
// via capture.sh (crop=false — already guide-cropped). The phone's own tile count
// is in each filename (_dN); a mismatch means the code CHANGED since capture, an
// agreement proves the harness reproduces the device. Truth for fixing comes from
// you, not from _dN (that may be the very bug). No API, free; network once for CDN.
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");
const jpeg = require("jpeg-js");

const arg = process.argv[2];
const FRAMES = arg === "--frames";

function collect() {
  if (FRAMES) {
    const root = path.join(__dirname, "sessions");
    if (!fs.existsSync(root)) return [];
    const out = [];
    for (const sess of fs.readdirSync(root)) {
      if (sess === "current") continue; // symlink/dup of a real session
      const pdir = path.join(root, sess, "photos");
      if (!fs.existsSync(pdir)) continue;
      for (const f of fs.readdirSync(pdir).sort()) {
        if (!f.endsWith(".jpg")) continue;
        const fp = path.join(pdir, f);
        try { jpeg.decode(fs.readFileSync(fp), { useTArray: true }); } // skip corrupt/empty (failed POSTs)
        catch { continue; }
        out.push({ file: fp, name: `${sess}/${f}`, crop: false, exp: (f.match(/_d(\d+)\.jpg$/) || [])[1] });
      }
    }
    return out;
  }
  return fs.readdirSync(__dirname)
    .filter(f => /^detect_.*_\d+\.jpg$/.test(f) && (!arg || f === arg || f.includes(arg))).sort()
    .map(f => {
      const buf = fs.readFileSync(path.join(__dirname, f));
      const dim = jpeg.decode(buf, { useTArray: true });
      // Full-frame originals (>1500px) get the app's guide crop; legacy
      // pre-cropped fixtures (<1500px) are scanned as-is.
      return { file: path.join(__dirname, f), name: f, crop: Math.max(dim.width, dim.height) > 1500,
        exp: f.match(/_(\d+)\.jpg$/)[1] };
    });
}

(async () => {
  const list = collect();
  if (!list.length) { console.log(FRAMES ? "No captured frames in eval/sessions/ — run ./capture.sh first." : "No fixtures."); process.exit(0); }
  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();
  page.on("pageerror", e => console.error("PAGE ERROR:", e.message));
  await page.goto("file://" + path.join(__dirname, "browser_harness.html"));
  await page.waitForFunction("typeof window.runDetect === 'function'");
  await page.evaluate("window.cvReady()"); // load OpenCV from CDN once

  let ok = 0, tot = 0;
  for (const item of list) {
    const dataUrl = "data:image/jpeg;base64," + fs.readFileSync(item.file).toString("base64");
    let tiles;
    try { tiles = await page.evaluate((u, c) => window.runDetect(u, c), dataUrl, item.crop); }
    catch (e) { console.log(`✗ ${item.name.padEnd(34)} ERROR ${e.message}`); tot++; continue; }
    const pips = tiles.map(t => `${t.left}|${t.right}`).join(" ");
    const exp = item.exp != null ? parseInt(item.exp, 10) : null;
    const good = exp == null ? null : tiles.length === exp;
    if (good) ok++; if (exp != null) tot++;
    const mark = good == null ? "•" : good ? "✓" : "✗";
    const expStr = exp == null ? "   " : `exp ${exp}`;
    console.log(`${mark} ${item.name.padEnd(34)} found ${tiles.length}  ${expStr}   [${pips}]`);
  }
  const label = FRAMES ? "vs phone count (_dN)" : "photos correct";
  if (tot) console.log(`\nBROWSER DETECTION: ${ok}/${tot} ${label}`);
  await browser.close();
  process.exit(tot && ok !== tot ? 1 : 0);
})().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
