// Shared domino tile detection — the ONE pipeline used by every scan page
// (quick.html, scan.html, catalog.html). LOCKED — see CLAUDE.md before modifying.
//
// Exposes window.DominoCV:
//   loadCV()                  → Promise that resolves when OpenCV.js is ready
//   preprocess(canvas)        → Canvas 2D grayscale + contrast stretch (in place)
//   scanCanvas(canvas)        → [{left,right},…] every tile in the frame
//   scanCanvasSingle(canvas)  → {left,right} the single largest tile (catalog)
//   isReady()                 → whether OpenCV.js has finished loading
(function () {
  let cvReady = false, cvLoading = false, cvResolvers = [];

  function loadCV() {
    if (cvReady) return Promise.resolve();
    return new Promise((resolve, reject) => {
      cvResolvers.push({ resolve, reject });
      if (cvLoading) return;
      cvLoading = true;
      const s = document.createElement("script");
      s.src = "https://docs.opencv.org/4.x/opencv.js";
      const onReady = () => {
        cvReady = true; cvLoading = false;
        cvResolvers.forEach(r => r.resolve());
        cvResolvers = [];
      };
      s.onload = () => {
        if (typeof cv === "undefined") {
          cvLoading = false;
          const err = new Error("Vision library failed to initialize.");
          cvResolvers.forEach(r => r.reject(err)); cvResolvers = [];
          return;
        }
        if (cv.Mat) onReady();
        else cv.onRuntimeInitialized = onReady;
      };
      s.onerror = () => {
        cvLoading = false;
        const err = new Error("Vision library failed to load — check your connection.");
        cvResolvers.forEach(r => r.reject(err));
        cvResolvers = [];
      };
      document.head.appendChild(s);
    });
  }

  // Grayscale + histogram stretch to full 0–255. Pure Canvas 2D, no OpenCV.
  function preprocess(canvas) {
    const ctx = canvas.getContext("2d");
    const d = ctx.getImageData(0, 0, canvas.width, canvas.height), px = d.data;
    let mn = 255, mx = 0;
    for (let i = 0; i < px.length; i += 4) {
      const g = 0.299*px[i] + 0.587*px[i+1] + 0.114*px[i+2];
      px[i] = px[i+1] = px[i+2] = g;
      if (g < mn) mn = g; if (g > mx) mx = g;
    }
    const rng = mx - mn || 1;
    for (let i = 0; i < px.length; i += 4) {
      const v = Math.round(((px[i] - mn) / rng) * 255);
      px[i] = px[i+1] = px[i+2] = v;
    }
    ctx.putImageData(d, 0, 0);
  }

  // Find candidate tile rectangles on a (preprocessed) src Mat. Bright tiles
  // are isolated with Otsu + morphology (touching tiles stay apart, each tile
  // becomes one solid blob), then accepted via minAreaRect — tolerant of
  // rounded corners and rotation. Returns [{pts, area, cx, cy}, …].
  function findTiles(src, minAreaFrac, maxAreaFrac, edgeMarginFrac) {
    let gray = null, blurred = null, thresh = null, kernel = null, morphed = null,
        contours = null, hier = null;
    const rects = [];
    try {
      gray = new cv.Mat();
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
      blurred = new cv.Mat();
      cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
      thresh = new cv.Mat();
      cv.threshold(blurred, thresh, 0, 255, cv.THRESH_BINARY | cv.THRESH_OTSU);
      kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(7, 7));
      morphed = new cv.Mat();
      cv.morphologyEx(thresh, morphed, cv.MORPH_OPEN, kernel);
      cv.morphologyEx(morphed, morphed, cv.MORPH_CLOSE, kernel);
      contours = new cv.MatVector();
      hier = new cv.Mat();
      cv.findContours(morphed, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

      const frameArea = src.cols * src.rows;
      const minArea = frameArea * minAreaFrac, maxArea = frameArea * maxAreaFrac;
      const edgeMargin = Math.min(src.cols, src.rows) * edgeMarginFrac;

      for (let i = 0; i < contours.size(); i++) {
        const c = contours.get(i);
        const area = cv.contourArea(c);
        if (area >= minArea && area <= maxArea) {
          const rect = cv.minAreaRect(c);
          const rw = rect.size.width, rh = rect.size.height;
          const rectArea = rw * rh;
          const ratio = Math.max(rw, rh) / Math.min(rw, rh);
          const fill = rectArea > 0 ? area / rectArea : 0;
          if (ratio >= 1.4 && ratio <= 3.2 && fill >= 0.80) {
            const pts = cv.RotatedRect.points(rect);
            const atEdge = edgeMargin > 0 && pts.some(p =>
              p.x < edgeMargin || p.x > src.cols - edgeMargin ||
              p.y < edgeMargin || p.y > src.rows - edgeMargin);
            if (!atEdge) {
              const cx = (pts[0].x + pts[1].x + pts[2].x + pts[3].x) / 4;
              const cy = (pts[0].y + pts[1].y + pts[2].y + pts[3].y) / 4;
              rects.push({ pts, area, cx, cy });
            }
          }
        }
        c.delete();
      }
    } finally {
      if (gray)     gray.delete();
      if (blurred)  blurred.delete();
      if (thresh)   thresh.delete();
      if (kernel)   kernel.delete();
      if (morphed)  morphed.delete();
      if (contours) contours.delete();
      if (hier)     hier.delete();
    }
    return rects;
  }

  // Split a tile Mat at the midpoint of its longer axis and count each half.
  function splitAndCount(mat) {
    let halfA = null, halfB = null;
    try {
      const landscape = mat.cols >= mat.rows;
      const mid = landscape ? Math.floor(mat.cols / 2) : Math.floor(mat.rows / 2);
      if (landscape) {
        halfA = mat.roi(new cv.Rect(0, 0, mid, mat.rows));
        halfB = mat.roi(new cv.Rect(mid, 0, mat.cols - mid, mat.rows));
      } else {
        halfA = mat.roi(new cv.Rect(0, 0, mat.cols, mid));
        halfB = mat.roi(new cv.Rect(0, mid, mat.cols, mat.rows - mid));
      }
      return { left: countPips(halfA), right: countPips(halfB) };
    } finally {
      if (halfA) halfA.delete();
      if (halfB) halfB.delete();
    }
  }

  // Warp one detected tile quad to a flat rectangle, then split + count.
  function countQuad(src, pts) {
    let warped = null;
    try {
      warped = perspectiveWarp(src, pts);
      return splitAndCount(warped);
    } finally {
      if (warped) warped.delete();
    }
  }

  // Multi-tile: every tile laid out in frame → [{left,right}, …].
  function scanCanvas(canvas) {
    let src = null;
    try {
      src = cv.imread(canvas);
      const found = findTiles(src, 0.02, 0.60, 0.03);
      found.sort((a, b) => Math.abs(a.cy - b.cy) > 60 ? a.cy - b.cy : a.cx - b.cx);
      return found.map(t => countQuad(src, t.pts));
    } finally {
      if (src) src.delete();
    }
  }

  // Single-tile (catalog): the one largest tile filling the frame. Falls back
  // to counting the whole frame as a tile if no clean rectangle is found.
  function scanCanvasSingle(canvas) {
    let src = null;
    try {
      src = cv.imread(canvas);
      const found = findTiles(src, 0.05, 0.95, 0);
      if (found.length) {
        found.sort((a, b) => b.area - a.area);
        return countQuad(src, found[0].pts);
      }
      return splitAndCount(src);
    } finally {
      if (src) src.delete();
    }
  }

  function perspectiveWarp(grayMat, pts) {
    const sorted = [...pts].sort((a, b) => a.y - b.y);
    const [tl, tr] = sorted.slice(0, 2).sort((a, b) => a.x - b.x);
    const [bl, br] = sorted.slice(2).sort((a, b) => a.x - b.x);
    const edgeDist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
    const w = Math.max(edgeDist(tl, tr), edgeDist(bl, br));
    const h = Math.max(edgeDist(tl, bl), edgeDist(tr, br));
    const scale = 400 / Math.max(w, h);
    const dstW = Math.max(Math.round(w * scale), 40);
    const dstH = Math.max(Math.round(h * scale), 40);
    const srcPts = cv.matFromArray(4, 1, cv.CV_32FC2,
      [tl.x, tl.y, tr.x, tr.y, br.x, br.y, bl.x, bl.y]);
    const dstPts = cv.matFromArray(4, 1, cv.CV_32FC2,
      [0, 0, dstW, 0, dstW, dstH, 0, dstH]);
    const M = cv.getPerspectiveTransform(srcPts, dstPts);
    const warped = new cv.Mat();
    cv.warpPerspective(grayMat, warped, M, new cv.Size(dstW, dstH));
    srcPts.delete(); dstPts.delete(); M.delete();
    return warped;
  }

  function countPips(halfMat) {
    // halfMat is warped from the preprocessed frame: bright tile, dark pips.
    const pad = Math.max(2, Math.floor(Math.min(halfMat.rows, halfMat.cols) * 0.05));
    const rw = halfMat.cols - 2 * pad, rh = halfMat.rows - 2 * pad;
    if (rw < 10 || rh < 10) return 0;
    const inner = halfMat.roi(new cv.Rect(pad, pad, rw, rh));
    let gray = null, thresh = null, kernel = null, closed = null, conts = null, hierP = null;
    try {
      gray = new cv.Mat();
      cv.cvtColor(inner, gray, cv.COLOR_RGBA2GRAY);
      thresh = new cv.Mat();
      cv.adaptiveThreshold(gray, thresh, 255,
        cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 11, 3);
      kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(3, 3));
      closed = new cv.Mat();
      cv.morphologyEx(thresh, closed, cv.MORPH_CLOSE, kernel);
      conts = new cv.MatVector();
      hierP = new cv.Mat();
      cv.findContours(closed, conts, hierP, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
      const regionArea = rw * rh, minPip = regionArea * 0.004, maxPip = regionArea * 0.12;
      let count = 0;
      for (let i = 0; i < conts.size(); i++) {
        const c = conts.get(i);
        const area = cv.contourArea(c);
        const peri = cv.arcLength(c, true);
        c.delete();
        // Pips are round; the central divider bar is elongated → low circularity
        const circ = peri > 0 ? (4 * Math.PI * area) / (peri * peri) : 0;
        if (area >= minPip && area <= maxPip && circ >= 0.55) count++;
      }
      return Math.min(count, 12);
    } finally {
      inner.delete();
      if (gray)   gray.delete();
      if (thresh) thresh.delete();
      if (kernel) kernel.delete();
      if (closed) closed.delete();
      if (conts)  conts.delete();
      if (hierP)  hierP.delete();
    }
  }

  window.DominoCV = { loadCV, preprocess, scanCanvas, scanCanvasSingle, isReady: () => cvReady };
})();
