// Build a labeled contact sheet of all unique captured frames (eval/sessions)
// so the corpus can be eyeballed/labeled in one image instead of N uploads.
// Renders via Puppeteer (the only image compositor available here) → PNG.
//   node contact_sheet.cjs            # -> eval/corpus_sheet.png
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const puppeteer = require("puppeteer");

const root = path.join(__dirname, "sessions");
const seen = new Set();
const frames = [];
if (fs.existsSync(root)) {
  for (const sess of fs.readdirSync(root).sort()) {
    if (sess === "current") continue;
    const pdir = path.join(root, sess, "photos");
    if (!fs.existsSync(pdir)) continue;
    for (const f of fs.readdirSync(pdir).sort()) {
      if (!f.endsWith(".jpg")) continue;
      const buf = fs.readFileSync(path.join(pdir, f));
      if (buf.length < 1000) continue; // skip corrupt/empty POST artifacts
      const h = crypto.createHash("md5").update(buf).digest("hex");
      if (seen.has(h)) continue;
      seen.add(h);
      frames.push({ name: `${sess}/${f}`, dataUrl: "data:image/jpeg;base64," + buf.toString("base64") });
    }
  }
}

const cells = frames.map((fr, i) => `
  <div class="cell">
    <div class="idx">#${i} &nbsp; ${fr.name}</div>
    <img src="${fr.dataUrl}">
  </div>`).join("");
const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  body{margin:0;background:#111;font-family:system-ui;color:#eee}
  .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;padding:12px}
  .cell{background:#1c1c1c;border-radius:6px;padding:6px}
  .idx{font-size:18px;margin-bottom:4px;color:#9cf}
  img{width:100%;display:block;border-radius:4px}
</style></head><body><div class="grid">${cells}</div></body></html>`;

(async () => {
  if (!frames.length) { console.log("No frames in eval/sessions/."); process.exit(0); }
  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 1000, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: "networkidle0" });
  const out = path.join(__dirname, "corpus_sheet.png");
  await page.screenshot({ path: out, fullPage: true });
  await browser.close();
  console.log(`Wrote ${out} — ${frames.length} unique frames`);
  frames.forEach((f, i) => console.log(`  #${i}  ${f.name}`));
})().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
