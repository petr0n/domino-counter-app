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
  global.cv = cv;
  global.window = {};
  global.document = { createElement: () => ({ getContext: () => ({}), toDataURL: () => "" }) };
  new Function(fs.readFileSync(path.join(DIR, "..", "detect.js"), "utf8"))();
  const D = global.window.DominoCV;
  const norm = (t) => (t[0] <= t[1] ? `${t[0]}-${t[1]}` : `${t[1]}-${t[0]}`);
  const score = (got, exp) => {
    const pool = exp.map(norm); let c = 0;
    for (const g of got.map(norm)) { const i = pool.indexOf(g); if (i >= 0) { c++; pool.splice(i, 1); } }
    return c;
  };

  // Load images once
  const imgs = {};
  for (const name of Object.keys(FIX)) {
    const raw = jpeg.decode(fs.readFileSync(path.join(DIR, "photos", `${name}.jpg`)), { useTArray: true });
    D._test.stretchGray(raw.data);
    imgs[name] = { data: new Uint8ClampedArray(raw.data), width: raw.width, height: raw.height, raw };
  }

  // Test different erosion percents
  for (const pct of [0.01, 0.02, 0.03, 0.04, 0.05]) {
    let totC = 0, totE = 0, detected = 0, totalExpected = 0;
    for (const [name, exp] of Object.entries(FIX)) {
      const img = imgs[name];
      const src = cv.matFromImageData(img);
      // Override erosion in findTiles
      const kSize = Math.max(3, Math.round(Math.min(src.cols, src.rows) * pct));
      let gray=null,blurred=null,binary=null,eroded=null,kernel=null,contours=null,hier=null;
      const rects = [];
      try {
        gray = new cv.Mat(); cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
        blurred = new cv.Mat(); cv.GaussianBlur(gray, blurred, new cv.Size(5,5), 0);
        binary = new cv.Mat(); cv.threshold(blurred, binary, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
        kernel = cv.Mat.ones(kSize, kSize, cv.CV_8U);
        eroded = new cv.Mat(); cv.erode(binary, eroded, kernel);
        contours = new cv.MatVector(); hier = new cv.Mat();
        cv.findContours(eroded, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
        const frameArea = src.cols * src.rows;
        const minArea = frameArea * 0.02, maxArea = frameArea * 0.70;
        for (let i = 0; i < contours.size(); i++) {
          const c = contours.get(i); const area = cv.contourArea(c);
          if (area >= minArea && area <= maxArea) {
            const rect = cv.minAreaRect(c); const rw = rect.size.width, rh = rect.size.height;
            const ratio = Math.max(rw,rh)/Math.min(rw,rh);
            if (ratio >= 1.5 && ratio <= 3.0) rects.push(1);
          }
          c.delete();
        }
      } finally {
        src.delete(); if(gray)gray.delete(); if(blurred)blurred.delete(); if(binary)binary.delete();
        if(eroded)eroded.delete(); if(kernel)kernel.delete(); if(contours)contours.delete(); if(hier)hier.delete();
      }
      detected += rects.length; totalExpected += exp.length;
    }
    console.log(`erosion ${(pct*100).toFixed(0)}%: detected ${detected}/${totalExpected} tiles`);
  }
  process.exit(0);
};
setTimeout(() => { console.log("TIMEOUT"); process.exit(1); }, 120000);
