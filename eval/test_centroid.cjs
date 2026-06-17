const fs = require("fs"), path = require("path"), jpeg = require("jpeg-js"), cv = require("@techstark/opencv-js");
const DIR = __dirname;
const FIX = {
  "464": [[9,1],[9,1],[9,9]],
  "465": [[9,9],[9,9],[9,1],[9,9]],
  "466": [[6,9],[9,1],[2,2]],
  "467": [[9,1],[9,9]],
  "468": [[2,4],[9,1],[9,3]],
  "469": [[9,9],[9,9]],
  "470": [[0,10],[10,4]],
  "471": [[3,3],[0,1]],
};
cv.onRuntimeInitialized = () => {
  global.cv = cv; global.window = {};
  global.document = { createElement: () => ({ getContext: () => ({}), toDataURL: () => "" }) };
  const srcCode = fs.readFileSync(path.join(DIR, "..", "detect.js"), "utf8");
  const norm = (t) => (t[0] <= t[1] ? `${t[0]}-${t[1]}` : `${t[1]}-${t[0]}`);
  const scoreAll = (results, label) => {
    let totC = 0, totE = 0, perfect = 0;
    for (const [name, exp] of Object.entries(FIX)) {
      const got = results[name] || [];
      const pool = exp.map(norm); let c = 0;
      for (const g of got.map(norm)) { const i = pool.indexOf(g); if (i >= 0) { c++; pool.splice(i,1); } }
      totC += c; totE += exp.length;
      const ok = c===exp.length&&got.length===exp.length; if(ok) perfect++;
    }
    console.log(`${label}: ${totC}/${totE} tiles · ${perfect}/8 perfect`);
  };

  // Test: add centroid filter to countPipsContour, reject if within X% of inner region border
  for (const borderPct of [0.0, 0.03, 0.05, 0.07, 0.10]) {
    let code = srcCode;
    if (borderPct > 0) {
      code = code.replace(
        "if (area >= minPip && area <= maxPip && circ >= 0.45) count++;",
        `if (area >= minPip && area <= maxPip && circ >= 0.45) {
           const m = cv.moments(conts.get(i - 1)); // won't work — need to get c before delete
           count++;
         }`
      );
    }
    
    // Actually let me patch differently — save c before delete
    if (borderPct === 0) {
      global.window = {};
      new Function(code)();
      const D = global.window.DominoCV;
      const results = {};
      for (const [name] of Object.entries(FIX)) {
        const raw = jpeg.decode(fs.readFileSync(path.join(DIR, "photos", `${name}.jpg`)), { useTArray: true });
        D._test.stretchGray(raw.data);
        const src2 = cv.matFromImageData({ data: new Uint8ClampedArray(raw.data), width: raw.width, height: raw.height });
        results[name] = D._test.scanMat(src2).map(t=>[t.left,t.right]); src2.delete();
      }
      scoreAll(results, `border=${borderPct} (baseline)`);
    }
  }

  // Proper patch with centroid filter
  for (const borderPct of [0.03, 0.05, 0.07, 0.10]) {
    let code = srcCode.replace(
      `      for (let i = 0; i < conts.size(); i++) {
        const c = conts.get(i);
        const area = cv.contourArea(c);
        const peri = cv.arcLength(c, true);
        c.delete();
        // Pips are round; the central divider bar is elongated → low circularity
        const circ = peri > 0 ? (4 * Math.PI * area) / (peri * peri) : 0;
        if (area >= minPip && area <= maxPip && circ >= 0.45) count++;
      }`,
      `      const borderDist = Math.min(rw, rh) * ${borderPct};
      for (let i = 0; i < conts.size(); i++) {
        const c = conts.get(i);
        const area = cv.contourArea(c);
        const peri = cv.arcLength(c, true);
        const circ = peri > 0 ? (4 * Math.PI * area) / (peri * peri) : 0;
        if (area >= minPip && area <= maxPip && circ >= 0.45) {
          const m = cv.moments(c);
          const mcx = m.m00 > 0 ? m.m10/m.m00 : 0, mcy = m.m00 > 0 ? m.m01/m.m00 : 0;
          if (mcx >= borderDist && mcx <= rw-borderDist && mcy >= borderDist && mcy <= rh-borderDist) count++;
        }
        c.delete();
      }`
    );
    global.window = {};
    new Function(code)();
    const D = global.window.DominoCV;
    const results = {};
    for (const [name] of Object.entries(FIX)) {
      const raw = jpeg.decode(fs.readFileSync(path.join(DIR, "photos", `${name}.jpg`)), { useTArray: true });
      D._test.stretchGray(raw.data);
      const src2 = cv.matFromImageData({ data: new Uint8ClampedArray(raw.data), width: raw.width, height: raw.height });
      results[name] = D._test.scanMat(src2).map(t=>[t.left,t.right]); src2.delete();
    }
    const fmt467 = results["467"].map(t=>t.join("|")).join(" ");
    const fmt468 = results["468"].map(t=>t.join("|")).join(" ");
    const fmt469 = results["469"].map(t=>t.join("|")).join(" ");
    scoreAll(results, `border=${borderPct} | 467:[${fmt467}] 468:[${fmt468}] 469:[${fmt469}]`);
  }
  process.exit(0);
};
setTimeout(()=>{process.exit(1);},120000);
