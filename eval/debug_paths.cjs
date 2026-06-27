// Path-attribution diagnosis (browser-faithful). Patches detect.js in-page to
// tag which detection path emits each tile, then runs a captured frame through
// the real camera path in headless Chromium. Does NOT modify committed detect.js.
//   node debug_paths.cjs <frame.jpg>   (path relative to eval/ or absolute)
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");

const target = process.argv[2];
if (!target) { console.error("usage: node debug_paths.cjs <frame.jpg>"); process.exit(1); }
const fpath = path.isAbsolute(target) ? target : path.join(__dirname, target);

let code = fs.readFileSync(path.join(__dirname, "..", "detect.js"), "utf8");
// Tag each rects.push site with its source path.
code = code.replace("rects.push({ pts, cx, cy, fill });",
  "if(window.__pathLog)window.__pathLog.push({src:'otsu-single',cx:Math.round(cx),cy:Math.round(cy)});rects.push({ pts, cx, cy, fill });");
code = code.replace("if (!dup) rects.push({ pts: h.pts, cx: h.cx, cy: h.cy, fill: 0.5 });",
  "if(!dup){if(window.__pathLog)window.__pathLog.push({src:'otsu-2tile',cx:Math.round(h.cx),cy:Math.round(h.cy)});rects.push({ pts: h.pts, cx: h.cx, cy: h.cy, fill: 0.5 });}");
code = code.replace(/if \(!dup\) rects\.push\(\{ pts: h\.pts, cx: h\.cx, cy: h\.cy, fill: h\.fill \}\);/g,
  "if(!dup){if(window.__pathLog)window.__pathLog.push({src:'otsu-divsplit',cx:Math.round(h.cx),cy:Math.round(h.cy)});rects.push({ pts: h.pts, cx: h.cx, cy: h.cy, fill: h.fill });}");
code = code.replace("for (const d of div) mergeNew(d);",
  "window.__src='dividerScan';for (const d of div) mergeNew(d);");
code = code.replace("for (const d of edged) mergeNew(d);",
  "window.__src='edgeScan';for (const d of edged) mergeNew(d);");
code = code.replace("const clustered = pipClusterScan(src, minAreaFrac, maxAreaFrac);",
  "window.__src='pipCluster';const clustered = pipClusterScan(src, minAreaFrac, maxAreaFrac);");
code = code.replace("        rects.push(d);",
  "        if(window.__pathLog)window.__pathLog.push({src:window.__src||'fallback',cx:Math.round(d.cx),cy:Math.round(d.cy)});\n        rects.push(d);");

(async () => {
  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();
  page.on("pageerror", e => console.error("PAGE ERROR:", e.message));
  await page.goto("file://" + path.join(__dirname, "browser_harness.html"));
  await page.evaluate("typeof DominoCV"); // ensure base loaded
  // Replace the loaded module with the patched one.
  await page.evaluate(patched => { window.__pathLog = []; eval(patched); }, code);
  await page.evaluate("window.cvReady()");
  const dataUrl = "data:image/jpeg;base64," + fs.readFileSync(fpath).toString("base64");
  const result = await page.evaluate(async (u) => {
    const tiles = await window.runDetect(u, false);
    return { tiles, log: window.__pathLog };
  }, dataUrl);
  console.log(`Final tiles: ${result.tiles.length}`);
  result.tiles.forEach((t, i) => console.log(`  tile ${i}: ${t.left}|${t.right}`));
  console.log(`\nPath attribution (${result.log.length} detections before warp/count):`);
  const byCnt = {};
  result.log.forEach(e => { byCnt[e.src] = (byCnt[e.src] || 0) + 1; console.log(`  ${e.src.padEnd(14)} @ (${e.cx},${e.cy})`); });
  console.log("\nPer-path counts:", JSON.stringify(byCnt));
  await browser.close();
})().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
