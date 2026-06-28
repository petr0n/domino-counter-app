// Corpus labeling pass — scan a batch of photos from eval/corpus_photos/ with the
// browser-faithful harness and print my result per tile, for the user to correct.
// LABELING ONLY: no scoring, no truth comparison, no fixing (that comes after all
// 49 are labeled). 7 photos per batch.
//   node corpus_scan.cjs            # batch 1 (photos 1-7)
//   node corpus_scan.cjs 3          # batch 3 (photos 15-21)
//   node corpus_scan.cjs all        # every photo
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");
const jpeg = require("jpeg-js");

const DIR = path.join(__dirname, "corpus_photos");
const PER = 7;
const argv = process.argv[2] || "1";

const all = fs.existsSync(DIR)
  ? fs.readdirSync(DIR).filter(f => /\.(jpe?g|png)$/i.test(f)).sort()
  : [];
if (!all.length) { console.log("No photos in eval/corpus_photos/ yet — drop them in and re-run."); process.exit(0); }

let list, label;
if (argv === "all") { list = all; label = `all ${all.length}`; }
else {
  const b = parseInt(argv, 10);
  const start = (b - 1) * PER;
  list = all.slice(start, start + PER);
  label = `batch ${b} (photos ${start + 1}-${Math.min(start + PER, all.length)} of ${all.length})`;
}
if (!list.length) { console.log(`No photos in ${label}.`); process.exit(0); }

(async () => {
  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();
  page.on("pageerror", e => console.error("PAGE ERROR:", e.message));
  await page.goto("file://" + path.join(__dirname, "browser_harness.html"));
  await page.waitForFunction("typeof window.runDetect === 'function'");
  await page.evaluate("window.cvReady()");

  console.log(`\n=== ${label} — my scan (correct anything wrong) ===\n`);
  for (const name of list) {
    const buf = fs.readFileSync(path.join(DIR, name));
    let crop = true;
    try { const d = jpeg.decode(buf, { useTArray: true }); crop = Math.max(d.width, d.height) > 1500; } catch {}
    const dataUrl = `data:image/${/png$/i.test(name) ? "png" : "jpeg"};base64,` + buf.toString("base64");
    let tiles;
    try { tiles = await page.evaluate((u, c) => window.runDetect(u, c), dataUrl, crop); }
    catch (e) { console.log(`${name.padEnd(28)} ERROR ${e.message}`); continue; }
    const pips = tiles.map(t => `${t.left}|${t.right}`).join("  ");
    console.log(`${name.padEnd(28)} ${tiles.length} tiles:  ${pips}`);
  }
  console.log(`\nReply with corrections (e.g. "${list[0]}: tile2 is 9|9, drop tile4"). Nothing saved until you confirm.`);
  await browser.close();
})().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
