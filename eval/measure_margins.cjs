// Measures where pips actually fall in warped half-tile images.
// For each fixture with known pip counts, outputs a 20x20 density map
// so we can determine the correct grid margins empirically.
//   node measure_margins.cjs
const fs = require("fs");
const path = require("path");
const jpeg = require("jpeg-js");
const cv = require("@techstark/opencv-js");

const DIR = __dirname;
// Known single-value halves we want to analyze (photo, tile index, side, expected count)
const TARGETS = [
  { photo: "465", tile: 0, side: "left",  exp: 9 },
  { photo: "465", tile: 0, side: "right", exp: 9 },
  { photo: "469", tile: 0, side: "left",  exp: 12 },
  { photo: "469", tile: 0, side: "right", exp: 9 },
  { photo: "470", tile: 0, side: "left",  exp: 0 },
  { photo: "470", tile: 0, side: "right", exp: 10 },
  { photo: "471", tile: 0, side: "left",  exp: 3 },
  { photo: "471", tile: 0, side: "right", exp: 3 },
  { photo: "467", tile: 0, side: "left",  exp: 5 },
  { photo: "467", tile: 0, side: "right", exp: 12 },
  { photo: "467", tile: 1, side: "left",  exp: 10 },
  { photo: "467", tile: 1, side: "right", exp: 1 },
  { photo: "466", tile: 0, side: "left",  exp: 6 },
  { photo: "466", tile: 0, side: "right", exp: 9 },
];

const N = 20; // density grid resolution

function renderGrid(grid) {
  const chars = " ░▒▓█";
  return grid.map(row =>
    row.map(v => chars[Math.min(4, Math.floor(v * 10))]).join("")
  ).join("\n");
}

cv.onRuntimeInitialized = () => {
  global.cv = cv;
  global.window = {};
  global.document = { createElement: () => ({ getContext: () => ({}), toDataURL: () => "" }) };
  new Function(fs.readFileSync(path.join(DIR, "..", "detect.js"), "utf8"))();
  const D = global.window.DominoCV;

  const photoCache = {};
  function loadPhoto(name) {
    if (photoCache[name]) return photoCache[name];
    const raw = jpeg.decode(fs.readFileSync(path.join(DIR, "photos", `${name}.jpg`)), { useTArray: true });
    D._test.stretchGray(raw.data);
    const src = cv.matFromImageData({ data: new Uint8ClampedArray(raw.data), width: raw.width, height: raw.height });
    photoCache[name] = src;
    return src;
  }

  for (const { photo, tile: tileIdx, side, exp } of TARGETS) {
    const src = loadPhoto(photo);
    const halves = D._test.getHalvesMats(src);
    if (tileIdx >= halves.length) { console.log(`${photo} tile ${tileIdx}: not found (only ${halves.length} tiles)`); continue; }
    const mat = halves[tileIdx][side];
    const grid = D._test.halfDensity(mat, N);

    console.log(`\n=== photo ${photo} tile ${tileIdx} ${side} (expected: ${exp} pips) size=${mat.cols}x${mat.rows} ===`);
    console.log(renderGrid(grid));

    // Show column and row sums to identify pip band
    const colSum = Array(N).fill(0);
    const rowSum = Array(N).fill(0);
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) { colSum[c] += grid[r][c]; rowSum[r] += grid[r][c]; }
    const fmt = arr => arr.map(v => v.toFixed(1).padStart(4)).join(" ");
    console.log("col sums:", fmt(colSum));
    console.log("row sums:", fmt(rowSum));
  }

  // Clean up
  for (const src of Object.values(photoCache)) src.delete();
  for (const name of Object.keys(photoCache)) {
    const halves = D._test.getHalvesMats(photoCache[name] || (() => {})());
    // halves already deleted since we called getHalvesMats per target above; skip
  }
  process.exit(0);
};
setTimeout(() => { console.log("TIMEOUT"); process.exit(1); }, 120000);
