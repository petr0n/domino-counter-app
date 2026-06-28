// Corpus benchmark — the single source of truth for detection+counting accuracy.
// Re-scans every labeled photo in eval/corpus_photos/ with the browser-faithful
// harness and scores against eval/corpus_truth.json. Run after EVERY change; a
// fix ships only if the numbers go up.
//   node corpus_eval.cjs            # full report (detection, per-batch, pip confusion)
//   node corpus_eval.cjs --fail     # also list each photo I get wrong
// Free; network once for the OpenCV CDN. No API.
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");
const jpeg = require("jpeg-js");

const DIR = path.join(__dirname, "corpus_photos");
const TRUTHF = path.join(__dirname, "corpus_truth.json");
const showFail = process.argv.includes("--fail");
const norm = p => Math.min(p[0], p[1]) + "-" + Math.max(p[0], p[1]);

if (!fs.existsSync(TRUTHF)) { console.log("No corpus_truth.json — label the corpus first."); process.exit(0); }
const truth = JSON.parse(fs.readFileSync(TRUTHF, "utf8"));
const names = Object.keys(truth).filter(n => truth[n].truth && fs.existsSync(path.join(DIR, n))).sort();
if (!names.length) { console.log("No labeled photos with images present."); process.exit(0); }

(async () => {
  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();
  page.on("pageerror", e => console.error("PAGE ERROR:", e.message));
  await page.goto("file://" + path.join(__dirname, "browser_harness.html"));
  await page.waitForFunction("typeof window.runDetect === 'function'");
  await page.evaluate("window.cvReady()");

  let countOK = 0, exactTiles = 0, totalTruth = 0, totalScan = 0, perfect = 0;
  const batch = {}, conf = {}, fails = [];
  names.forEach(n => {});
  for (let gi = 0; gi < names.length; gi++) {
    const n = names[gi];
    const tr = truth[n].truth;
    const buf = fs.readFileSync(path.join(DIR, n));
    let crop = true;
    try { const d = jpeg.decode(buf, { useTArray: true }); crop = Math.max(d.width, d.height) > 1500; } catch {}
    const dataUrl = `data:image/${/png$/i.test(n) ? "png" : "jpeg"};base64,` + buf.toString("base64");
    let tiles;
    try { tiles = await page.evaluate((u, c) => window.runDetect(u, c), dataUrl, crop); }
    catch (e) { tiles = []; }
    const m = tiles.map(t => [t.left, t.right]);
    totalTruth += tr.length; totalScan += m.length;
    const cOK = m.length === tr.length; if (cOK) countOK++;
    const pool = m.map(norm); let matched = 0;
    for (const p of tr) { const k = norm(p); const i = pool.indexOf(k); if (i >= 0) { pool.splice(i, 1); matched++; } }
    exactTiles += matched;
    const isPerfect = cOK && matched === tr.length; if (isPerfect) perfect++;
    if (!isPerfect) fails.push({ n, mine: m.map(x => x.join("|")).join(" "), truth: tr.map(x => x.join("|")).join(" ") });
    const b = Math.floor(gi / 7) + 1; batch[b] = batch[b] || { ph: 0, cOK: 0, tiles: 0, exact: 0 };
    batch[b].ph++; if (cOK) batch[b].cOK++; batch[b].tiles += tr.length; batch[b].exact += matched;
    if (cOK) {
      const used = new Array(m.length).fill(false);
      for (const tp of tr) {
        let best = -1, bestErr = 1e9, orient = 0;
        for (let i = 0; i < m.length; i++) { if (used[i]) continue; const mp = m[i];
          const e0 = Math.abs(mp[0]-tp[0]) + Math.abs(mp[1]-tp[1]);
          const e1 = Math.abs(mp[1]-tp[0]) + Math.abs(mp[0]-tp[1]);
          const e = Math.min(e0, e1); if (e < bestErr) { bestErr = e; best = i; orient = e0 <= e1 ? 0 : 1; } }
        if (best >= 0) { used[best] = true; const mp = m[best];
          const pred = orient === 0 ? mp : [mp[1], mp[0]];
          [[tp[0], pred[0]], [tp[1], pred[1]]].forEach(([tv, pv]) => {
            if (tv !== pv) { conf[tv] = conf[tv] || {}; conf[tv][pv] = (conf[tv][pv] || 0) + 1; } });
        }
      }
    }
  }
  await browser.close();

  console.log("=== DETECTION ===");
  console.log(`photos tile-count correct: ${countOK}/${names.length}`);
  console.log(`tiles scanned: ${totalScan}  truth: ${totalTruth}  net missed: ${totalTruth - totalScan}`);
  console.log(`photos fully correct: ${perfect}/${names.length}`);
  console.log(`tiles exactly right: ${exactTiles}/${totalTruth} = ${(100*exactTiles/totalTruth).toFixed(0)}%`);
  console.log("\n=== PER BATCH (7) ===");
  Object.keys(batch).forEach(b => { const x = batch[b];
    console.log(`batch ${b}: count-correct ${x.cOK}/${x.ph} · tiles-exact ${x.exact}/${x.tiles}`); });
  console.log("\n=== PIP HALF ERRORS (true -> misread, count-matched photos) ===");
  Object.keys(conf).map(Number).sort((a,b)=>a-b).forEach(tv => {
    const preds = Object.entries(conf[tv]).sort((a,b)=>b[1]-a[1]).map(([p,c])=>`${p}(x${c})`).join(" ");
    const tot = Object.values(conf[tv]).reduce((a,b)=>a+b,0);
    console.log(`  true ${tv}: ${tot} wrong -> ${preds}`); });
  if (showFail) { console.log("\n=== PHOTOS NOT PERFECT ==="); fails.forEach(f => {
    console.log(`  ${f.n}\n    mine:  ${f.mine}\n    truth: ${f.truth}`); }); }
})().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
