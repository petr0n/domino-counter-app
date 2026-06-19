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

  // Grayscale + histogram stretch to full 0–255, in place on an RGBA pixel
  // array. Pure JS — no canvas/OpenCV — so it is unit-testable headlessly.
  function stretchGray(px) {
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
  }

  // Canvas wrapper around stretchGray.
  function preprocess(canvas) {
    const ctx = canvas.getContext("2d");
    const d = ctx.getImageData(0, 0, canvas.width, canvas.height);
    stretchGray(d.data);
    ctx.putImageData(d, 0, 0);
  }

  // Find candidate tile rectangles on a (preprocessed) src Mat.
  // Returns [{pts, cx, cy}, …] — one entry per individual tile.
  function findTiles(src, minAreaFrac, maxAreaFrac, edgeMarginFrac) {
    let gray = null, blurred = null, binary = null, eroded = null, kernel = null;
    let contours = null, hier = null;
    const rects = [];
    try {
      gray = new cv.Mat();
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
      blurred = new cv.Mat();
      cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
      binary = new cv.Mat();
      cv.threshold(blurred, binary, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);

      // Erode to separate any touching tiles. Kernel = ~1% of shortest image side,
      // minimum 3px. This creates a visible gap between tiles that were touching.
      const kSize = Math.max(3, Math.round(Math.min(src.cols, src.rows) * 0.01));
      kernel = cv.Mat.ones(kSize, kSize, cv.CV_8U);
      eroded = new cv.Mat();
      cv.erode(binary, eroded, kernel);

      contours = new cv.MatVector();
      hier = new cv.Mat();
      cv.findContours(eroded, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

      const frameArea = src.cols * src.rows;
      const minArea = frameArea * minAreaFrac, maxArea = frameArea * maxAreaFrac;
      const edgeMargin = Math.min(src.cols, src.rows) * edgeMarginFrac;

      for (let i = 0; i < contours.size(); i++) {
        const c = contours.get(i);
        const area = cv.contourArea(c);
        if (area >= minArea && area <= maxArea) {
          const rect = cv.minAreaRect(c);
          const rw = rect.size.width, rh = rect.size.height;
          const ratio = Math.max(rw, rh) / Math.min(rw, rh);
          const fill = area / (rw * rh);
          // Accept single-tile shapes (~2:1, fill ≥ 0.72). Erosion normally
          // separates touching tiles, but when two tiles touch side-by-side they
          // can survive as one near-square (~1:1) blob — detect and split those.
          if (ratio >= 1.5 && ratio <= 3.0 && fill >= 0.72) {
            const pts = cv.RotatedRect.points(rect);
            const atEdge = edgeMargin > 0 && pts.some(p =>
              p.x < edgeMargin || p.x > src.cols - edgeMargin ||
              p.y < edgeMargin || p.y > src.rows - edgeMargin);
            if (!atEdge) {
              const cx = (pts[0].x + pts[1].x + pts[2].x + pts[3].x) / 4;
              const cy = (pts[0].y + pts[1].y + pts[2].y + pts[3].y) / 4;
              const shortSide = Math.min(rw, rh);
              const dup = rects.some(r => Math.hypot(r.cx - cx, r.cy - cy) < shortSide * 0.4);
              if (!dup) rects.push({ pts, cx, cy, fill });
            }
          } else if ((ratio >= 0.85 && ratio < 1.5 && fill >= 0.60) ||
                     (ratio > 3.0 && ratio < 5.0 && fill >= 0.55)) {
            // Two tiles merged: either touching long-side-to-long-side (~1:1 blob)
            // or touching end-to-end (~4:1 blob). Split at midpoint along long axis.
            const pts = cv.RotatedRect.points(rect);
            // 1% margin: reject merges whose bounding box is near the frame edge —
            // a half-tile at the boundary crops poorly and gives garbage pip counts.
            const splitMargin = Math.min(src.cols, src.rows) * 0.01;
            const atEdge = pts.some(p =>
              p.x < splitMargin || p.x > src.cols - splitMargin ||
              p.y < splitMargin || p.y > src.rows - splitMargin);
            if (!atEdge) {
              for (const h of splitRect({ pts })) {
                const dup = rects.some(r => Math.hypot(r.cx - h.cx, r.cy - h.cy) < Math.min(rw,rh) * 0.4);
                if (!dup) rects.push({ pts: h.pts, cx: h.cx, cy: h.cy, fill: 0.5 });
              }
            }
          } else {
            // Blob the single-tile and geometric-split tests both rejected
            // (e.g. two tiles touching at an angle): recover tiles from their
            // centre divider bars. Additive — previously this blob was dropped.
            const sm = Math.min(src.cols, src.rows) * 0.01;
            for (const h of dividerSplit(src, binary, contours, i, minArea, maxArea)) {
              const atEdge = h.pts.some(p =>
                p.x < sm || p.x > src.cols - sm || p.y < sm || p.y > src.rows - sm);
              if (atEdge) continue;
              const dup = rects.some(r => Math.hypot(r.cx - h.cx, r.cy - h.cy) < Math.min(rw, rh) * 0.4);
              if (!dup) rects.push({ pts: h.pts, cx: h.cx, cy: h.cy, fill: h.fill });
            }
          }
        }
        c.delete();
      }
    } finally {
      if (gray)     gray.delete();
      if (blurred)  blurred.delete();
      if (binary)   binary.delete();
      if (eroded)   eroded.delete();
      if (kernel)   kernel.delete();
      if (contours) contours.delete();
      if (hier)     hier.delete();
    }
    return rects;
  }

  // Recover tiles from a merged/ambiguous blob using each domino's centre
  // divider bar. Within the blob, a divider is a thin dark bar; reconstruct the
  // full tile rect from it via the 2:1 model — short side = divider length,
  // long side = 2× that, perpendicular to the bar. Returns [{pts,cx,cy,fill}].
  function dividerSplit(src, binary, contours, idx, minArea, maxArea) {
    const out = [];
    let filled = null, notBin = null, darkIn = null, conts = null, hier = null;
    try {
      filled = cv.Mat.zeros(src.rows, src.cols, cv.CV_8U);
      cv.drawContours(filled, contours, idx, new cv.Scalar(255), -1);
      notBin = new cv.Mat();
      cv.bitwise_not(binary, notBin);
      darkIn = new cv.Mat();
      cv.bitwise_and(notBin, filled, darkIn);
      conts = new cv.MatVector();
      hier = new cv.Mat();
      cv.findContours(darkIn, conts, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
      for (let i = 0; i < conts.size(); i++) {
        const d = conts.get(i);
        const a = cv.contourArea(d);
        const r = cv.minAreaRect(d);
        d.delete();
        if (a < 100) continue;
        const W = r.size.width, H = r.size.height;
        const L = Math.max(W, H), S = Math.min(W, H);
        if (L / Math.max(1, S) < 3.5) continue;          // not a thin bar
        const tileArea = 2 * L * L;                       // L (short) × 2L (long)
        if (tileArea < minArea || tileArea > maxArea) continue;
        const ang = (W >= H ? r.angle : r.angle + 90) * Math.PI / 180;
        const ux = Math.cos(ang), uy = Math.sin(ang);     // along divider (tile short axis)
        const px = -uy, py = ux;                          // perpendicular (tile long axis)
        const cx = r.center.x, cy = r.center.y;
        const hs = L / 2, hl = L;                         // half short, half long
        const pts = [[-hs, -hl], [hs, -hl], [hs, hl], [-hs, hl]].map(([s, l]) =>
          ({ x: cx + s * ux + l * px, y: cy + s * uy + l * py }));
        const step = Math.max(3, L / 14);
        let inside = 0, total = 0;
        for (let s = -hs; s <= hs; s += step) {
          for (let l = -hl; l <= hl; l += step) {
            const xx = Math.round(cx + s * ux + l * px), yy = Math.round(cy + s * uy + l * py);
            total++;
            if (xx >= 0 && yy >= 0 && xx < src.cols && yy < src.rows && filled.ucharPtr(yy, xx)[0] > 0) inside++;
          }
        }
        if (!total || inside / total < 0.6) continue;
        out.push({ pts, cx, cy, fill: inside / total });
      }
    } finally {
      if (filled) filled.delete();
      if (notBin) notBin.delete();
      if (darkIn) darkIn.delete();
      if (conts)  conts.delete();
      if (hier)   hier.delete();
    }
    return out;
  }

  // Split a rotated rect (described by 4 corner pts) into two half-rects along
  // the long axis. Returns [{pts,cx,cy,n}, {pts,cx,cy,n}].
  function splitRect(tile) {
    const p = tile.pts;
    // Find the two pairs of adjacent corners that form the long sides.
    // Midpoints of the short sides become the shared edge of the two halves.
    const d01 = Math.hypot(p[1].x-p[0].x, p[1].y-p[0].y);
    const d12 = Math.hypot(p[2].x-p[1].x, p[2].y-p[1].y);
    let m0, m1; // midpoints of the two short sides
    if (d01 >= d12) {
      // long sides are 01 and 23; short sides are 12 and 30
      m0 = { x: (p[1].x+p[2].x)/2, y: (p[1].y+p[2].y)/2 };
      m1 = { x: (p[3].x+p[0].x)/2, y: (p[3].y+p[0].y)/2 };
      return [
        { pts: [p[0], p[1], m0, m1], cx: (p[0].x+p[1].x+m0.x+m1.x)/4, cy: (p[0].y+p[1].y+m0.y+m1.y)/4, n: 1 },
        { pts: [m1, m0, p[2], p[3]], cx: (m1.x+m0.x+p[2].x+p[3].x)/4, cy: (m1.y+m0.y+p[2].y+p[3].y)/4, n: 1 },
      ];
    } else {
      // long sides are 12 and 30; short sides are 01 and 23
      m0 = { x: (p[0].x+p[1].x)/2, y: (p[0].y+p[1].y)/2 };
      m1 = { x: (p[2].x+p[3].x)/2, y: (p[2].y+p[3].y)/2 };
      return [
        { pts: [p[0], m0, m1, p[3]], cx: (p[0].x+m0.x+m1.x+p[3].x)/4, cy: (p[0].y+m0.y+m1.y+p[3].y)/4, n: 1 },
        { pts: [m0, p[1], p[2], m1], cx: (m0.x+p[1].x+p[2].x+m1.x)/4, cy: (m0.y+p[1].y+p[2].y+m1.y)/4, n: 1 },
      ];
    }
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

  // Rotate src so the tile is axis-aligned, crop it with padding, then count.
  function cropRotate(src, pts, fill) {
    // Derive centre, long-axis angle, and tile dimensions from the 4 corners.
    const cx = (pts[0].x + pts[1].x + pts[2].x + pts[3].x) / 4;
    const cy = (pts[0].y + pts[1].y + pts[2].y + pts[3].y) / 4;
    const d01 = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
    const d03 = Math.hypot(pts[3].x - pts[0].x, pts[3].y - pts[0].y);
    let angle, tileW, tileH;
    if (d01 >= d03) {
      angle  = Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x) * 180 / Math.PI;
      tileW  = d01; tileH = d03;
    } else {
      angle  = Math.atan2(pts[3].y - pts[0].y, pts[3].x - pts[0].x) * 180 / Math.PI;
      tileW  = d03; tileH = d01;
    }
    // Clamp angle to (-90, 90] so the tile ends up landscape.
    while (angle >  90) angle -= 180;
    while (angle <= -90) angle += 180;

    // Crop dimensions with padding each side. Split tiles (fill < 0.72) use 2%
    // to avoid bleeding into the adjacent tile; normal tiles use 8%.
    const pad = (fill != null && fill < 0.72) ? 0.02 : 0.08;
    const outW = Math.round(tileW * (1 + 2 * pad));
    const outH = Math.round(tileH * (1 + 2 * pad));

    let M = null, rotated = null, cropped = null;
    try {
      M = cv.getRotationMatrix2D(new cv.Point(cx, cy), angle, 1.0);
      rotated = new cv.Mat();
      cv.warpAffine(src, rotated, M, new cv.Size(src.cols, src.rows),
                    cv.INTER_LINEAR, cv.BORDER_REPLICATE);
      const x = Math.max(0, Math.round(cx - outW / 2));
      const y = Math.max(0, Math.round(cy - outH / 2));
      const w = Math.min(src.cols - x, outW);
      const h = Math.min(src.rows - y, outH);
      if (w < 20 || h < 20) return splitAndCount(src);
      cropped = rotated.roi(new cv.Rect(x, y, w, h));
      return splitAndCount(cropped);
    } finally {
      if (M)       M.delete();
      if (cropped) cropped.delete();
      if (rotated) rotated.delete();
    }
  }

  // Find, crop, rotate, then count each tile.
  function countQuad(src, pts, fill) {
    return cropRotate(src, pts, fill);
  }

  // Expand merged-tile rects (n=2) into individual tile rects using splitRect.
  function expandTiles(found) {
    const out = [];
    for (const t of found) {
      if (t.n === 2) { out.push(...splitRect(t)); } else { out.push(t); }
    }
    return out;
  }

  // Multi-tile core: every tile in an already-loaded src Mat → [{left,right}, …].
  function scanMat(src) {
    const found = findTiles(src, 0.015, 0.70, 0.01);
    found.sort((a, b) => Math.abs(a.cy - b.cy) > 60 ? a.cy - b.cy : a.cx - b.cx);
    return found.map(t => Object.assign(countQuad(src, t.pts, t.fill), { fill: t.fill }));
  }

  // Single-tile core: the one largest tile in src, with whole-frame fallback.
  function scanMatSingle(src) {
    const found = findTiles(src, 0.05, 0.95, 0);
    if (found.length) {
      // Pick the tile with the largest bounding area.
      found.sort((a, b) => {
        const areaOf = t => {
          const p = t.pts;
          return Math.hypot(p[1].x-p[0].x, p[1].y-p[0].y) *
                 Math.hypot(p[3].x-p[0].x, p[3].y-p[0].y);
        };
        return areaOf(b) - areaOf(a);
      });
      return countQuad(src, found[0].pts);
    }
    return splitAndCount(src);
  }

  // Multi-tile: every tile laid out in frame → [{left,right}, …].
  function scanCanvas(canvas) {
    let src = null;
    try { src = cv.imread(canvas); return scanMat(src); }
    finally { if (src) src.delete(); }
  }

  // Single-tile (catalog): the one largest tile filling the frame.
  function scanCanvasSingle(canvas) {
    let src = null;
    try { src = cv.imread(canvas); return scanMatSingle(src); }
    finally { if (src) src.delete(); }
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
    return countPipsContour(halfMat);
  }

  // Returns cloned half-tile Mats for all tiles in src. Caller must delete each Mat.
  function getHalvesMats(src) {
    const found = findTiles(src, 0.015, 0.70, 0.03);
    found.sort((a, b) => Math.abs(a.cy - b.cy) > 60 ? a.cy - b.cy : a.cx - b.cx);
    const halves = [];
    for (const t of found) {
      const { cx, cy, pts, fill } = t;
      const d01 = Math.hypot(pts[1].x-pts[0].x, pts[1].y-pts[0].y);
      const d03 = Math.hypot(pts[3].x-pts[0].x, pts[3].y-pts[0].y);
      let angle, tileW, tileH;
      if (d01 >= d03) { angle = Math.atan2(pts[1].y-pts[0].y, pts[1].x-pts[0].x)*180/Math.PI; tileW=d01; tileH=d03; }
      else            { angle = Math.atan2(pts[3].y-pts[0].y, pts[3].x-pts[0].x)*180/Math.PI; tileW=d03; tileH=d01; }
      while (angle >  90) angle -= 180;
      while (angle <= -90) angle += 180;
      const pad = (fill != null && fill < 0.72) ? 0.02 : 0.08;
      const outW = Math.round(tileW*(1+2*pad)), outH = Math.round(tileH*(1+2*pad));
      let M = null, rotated = null;
      try {
        M = cv.getRotationMatrix2D(new cv.Point(cx, cy), angle, 1.0);
        rotated = new cv.Mat();
        cv.warpAffine(src, rotated, M, new cv.Size(src.cols, src.rows), cv.INTER_LINEAR, cv.BORDER_REPLICATE);
        const x = Math.max(0, Math.round(cx - outW/2));
        const y = Math.max(0, Math.round(cy - outH/2));
        const w = Math.min(src.cols - x, outW), h = Math.min(src.rows - y, outH);
        if (w < 20 || h < 20) continue;
        const tile = rotated.roi(new cv.Rect(x, y, w, h));
        const landscape = tile.cols >= tile.rows;
        const mid = landscape ? Math.floor(tile.cols/2) : Math.floor(tile.rows/2);
        let hA, hB;
        if (landscape) { hA = tile.roi(new cv.Rect(0,0,mid,tile.rows)).clone(); hB = tile.roi(new cv.Rect(mid,0,tile.cols-mid,tile.rows)).clone(); }
        else           { hA = tile.roi(new cv.Rect(0,0,tile.cols,mid)).clone();  hB = tile.roi(new cv.Rect(0,mid,tile.cols,tile.rows-mid)).clone(); }
        halves.push({ left: hA, right: hB, fill });
      } finally {
        if (M)       M.delete();
        if (rotated) rotated.delete();
      }
    }
    return halves;
  }

  // Returns a NxN density map (fraction of dark pixels per cell) for a half-tile Mat.
  // Used only by the measurement script to determine correct grid margins.
  function halfDensity(halfMat, N) {
    const SZ = 120;
    let resized = null, gray = null, bin = null;
    try {
      resized = new cv.Mat();
      cv.resize(halfMat, resized, new cv.Size(SZ, SZ));
      gray = new cv.Mat();
      cv.cvtColor(resized, gray, cv.COLOR_RGBA2GRAY);
      bin = new cv.Mat();
      cv.threshold(gray, bin, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);
      const cw = SZ / N, ch = SZ / N;
      const grid = [];
      for (let r = 0; r < N; r++) {
        const row = [];
        for (let c = 0; c < N; c++) {
          const x1 = Math.round(c * cw), x2 = Math.round((c + 1) * cw);
          const y1 = Math.round(r * ch), y2 = Math.round((r + 1) * ch);
          let pip = 0, total = 0;
          for (let py = y1; py < y2; py++) {
            const rowData = bin.ucharPtr(Math.min(SZ - 1, py));
            for (let px = x1; px < x2; px++) {
              if (rowData[Math.min(SZ - 1, px)] > 0) pip++;
              total++;
            }
          }
          row.push(pip / total);
        }
        grid.push(row);
      }
      return grid;
    } finally {
      if (resized) resized.delete();
      if (gray)    gray.delete();
      if (bin)     bin.delete();
    }
  }

  // Grid-sampling pip counter. Divides the half into a 3×4 grid (12 cells)
  // and a 3×3 grid (9 cells), sampling each cell center for darkness.
  // If 10+ cells are dark in the 3×4 grid, that is the count (10/11/12-pip half).
  // Otherwise the 3×3 grid count is used (0-9-pip half).
  // This avoids all contour/circularity logic and is immune to the divider bar.
  function countPipsGridSample(halfMat, fill) {
    const SZ = 120, N = 20;
    let resized = null, gray = null, bin = null;
    try {
      resized = new cv.Mat();
      cv.resize(halfMat, resized, new cv.Size(SZ, SZ));
      gray = new cv.Mat();
      cv.cvtColor(resized, gray, cv.COLOR_RGBA2GRAY);
      bin = new cv.Mat();
      cv.threshold(gray, bin, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);

      // Build NxN density grid. Each cell = fraction of dark pixels in its region.
      const cw = SZ / N, ch = SZ / N;
      const grid = [];
      for (let r = 0; r < N; r++) {
        const row = [];
        for (let c = 0; c < N; c++) {
          const x1 = Math.round(c * cw), x2 = Math.round((c + 1) * cw);
          const y1 = Math.round(r * ch), y2 = Math.round((r + 1) * ch);
          let pip = 0, total = 0;
          for (let py = y1; py < y2; py++) {
            const rd = bin.ucharPtr(Math.min(SZ - 1, py));
            for (let px = x1; px < x2; px++) {
              if (rd[Math.min(SZ - 1, px)] > 0) pip++;
              total++;
            }
          }
          row.push(pip / total);
        }
        grid.push(row);
      }

      // N-bin projections (sum of density across each row/col).
      const colP = new Array(N).fill(0);
      const rowP = new Array(N).fill(0);
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
        colP[c] += grid[r][c]; rowP[r] += grid[r][c];
      }
      // Zero solid bins (>75% of N = tile border or divider bar) and outer 2 bins (tile edge).
      for (let i = 0; i < N; i++) {
        if (colP[i] > 0.75 * N) colP[i] = 0;
        if (rowP[i] > 0.75 * N) rowP[i] = 0;
      }
      colP[0] = colP[1] = colP[N-2] = colP[N-1] = 0;
      rowP[0] = rowP[1] = rowP[N-2] = rowP[N-1] = 0;

      // Find weighted centroids of groups above 40% of max, merging groups <2 bins apart.
      function centroids(proj) {
        let maxV = 0;
        for (let i = 0; i < N; i++) if (proj[i] > maxV) maxV = proj[i];
        if (maxV < 1.0) return [];
        const thresh = maxV * 0.40;
        const raw = [];
        let ws = 0, ps = 0, on = false;
        for (let i = 0; i < N; i++) {
          if (proj[i] >= thresh) { ws += proj[i] * i; ps += proj[i]; on = true; }
          else if (on) { raw.push(ws / ps); ws = 0; ps = 0; on = false; }
        }
        if (on) raw.push(ws / ps);
        const out = [];
        for (const v of raw) {
          if (out.length && v - out[out.length-1] < 2) out[out.length-1] = (out[out.length-1] + v) / 2;
          else out.push(v);
        }
        return out;
      }

      // Filter centroids too close to the edge (border artifact zone: last 3 bins).
      const allColC = centroids(colP).filter(c => c <= N - 4);
      const allRowC = centroids(rowP).filter(r => r <= N - 4);
      if (!allColC.length || !allRowC.length) return 0;

      // Sort centroid groups by Voronoi area (sum of proj in each group's territory).
      // Top-3 vs top-4 selection disambiguates 12-pip (4-col) from tiles with spurious border groups.
      function topByArea(cs, proj, n) {
        if (cs.length <= n) return cs.slice();
        const areas = cs.map((c, i) => {
          const lo = i === 0 ? 0 : Math.round((cs[i-1] + c) / 2);
          const hi = i === cs.length-1 ? N-1 : Math.round((c + cs[i+1]) / 2);
          let s = 0; for (let j = lo; j <= hi; j++) s += proj[j]; return s;
        });
        return cs.map((c, i) => ({ c, a: areas[i] }))
          .sort((a, b) => b.a - a.a).slice(0, n).map(x => x.c).sort((a, b) => a - b);
      }

      function countGrid(cols, rows) {
        let n = 0;
        for (const rC of rows) for (const cC of cols) {
          const bc = Math.max(0, Math.min(N-1, Math.round(cC)));
          const br = Math.max(0, Math.min(N-1, Math.round(rC)));
          if (grid[br][bc] >= 0.25) n++;
        }
        return n;
      }

      const cols3 = topByArea(allColC, colP, 3);
      const cols4 = topByArea(allColC, colP, 4);
      const rows3 = topByArea(allRowC, rowP, 3);
      const rows4 = topByArea(allRowC, rowP, 4);

      const c3x3 = countGrid(cols3, rows3);
      const c4x3 = countGrid(cols4, rows3);
      const c3x4 = countGrid(cols3, rows4);

      // 12-pip tile fills all 12 cells of the 4×3 grid (4 cols or 4 rows).
      // Spurious 4th groups from border artifacts don't fill all 12 → count stays at c3x3.
      return (c4x3 === 12 || c3x4 === 12) ? 12 : c3x3;
    } finally {
      if (resized) resized.delete();
      if (gray)    gray.delete();
      if (bin)     bin.delete();
    }
  }

  function countPipsGrid(halfMat) {
    // Hybrid grid approach: binarize the half-tile with Otsu (same as countPipsContour,
    // same inner-crop to strip the dark table padding that corrupts global bg estimation),
    // then score each canonical pip layout by how well its positions match the binary mask.
    // This handles merged pips (no blob splitting needed) and any pip color.
    const pad = Math.max(2, Math.floor(Math.min(halfMat.rows, halfMat.cols) * 0.05));
    const rw = halfMat.cols - 2 * pad, rh = halfMat.rows - 2 * pad;
    if (rw < 10 || rh < 10) return 0;
    const inner = halfMat.roi(new cv.Rect(pad, pad, rw, rh));
    const SIZE = 150;
    let resized = null, gray = null, thresh = null;
    try {
      resized = new cv.Mat();
      cv.resize(inner, resized, new cv.Size(SIZE, SIZE));
      gray = new cv.Mat();
      cv.cvtColor(resized, gray, cv.COLOR_RGBA2GRAY);
      thresh = new cv.Mat();
      cv.threshold(gray, thresh, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);

      // Sample fraction of pip-mask coverage at a patch centred on (nx,ny).
      // Returns 0 (no pip) to 1 (fully pip) in the binary mask.
      const patch = 4;
      const sample = (nx, ny) => {
        const cx = Math.round(nx * (SIZE - 1)), cy = Math.round(ny * (SIZE - 1));
        let sum = 0, n = 0;
        for (let dy = -patch; dy <= patch; dy++) {
          for (let dx = -patch; dx <= patch; dx++) {
            const r = cy + dy, c = cx + dx;
            if (r >= 0 && r < SIZE && c >= 0 && c < SIZE) { sum += thresh.ucharAt(r, c); n++; }
          }
        }
        return n ? sum / n / 255 : 0;
      };

      // Canonical pip positions (normalised 0-1) for counts 0-12.
      // Based on standard double-12 domino layouts (user-verified):
      //   5=2+1+2  6=2+2+2  7=3+1+3  8=3+2+3(frame)  9=3+3+3(solid)
      //   10=4+2+4(frame)  11=4+3+4  12=3+3+3+3
      const L = [
        [],                                                                          // 0
        [[.5,.5]],                                                                   // 1
        [[.5,.25],[.5,.75]],                                                         // 2
        [[.25,.25],[.5,.5],[.75,.75]],                                               // 3
        [[.25,.25],[.75,.25],[.25,.75],[.75,.75]],                                   // 4
        [[.28,.2],[.72,.2],[.5,.5],[.28,.8],[.72,.8]],                               // 5
        [[.28,.2],[.72,.2],[.28,.5],[.72,.5],[.28,.8],[.72,.8]],                     // 6
        [[.2,.2],[.5,.2],[.8,.2],[.5,.5],[.2,.8],[.5,.8],[.8,.8]],                   // 7
        [[.2,.2],[.5,.2],[.8,.2],[.2,.5],[.8,.5],[.2,.8],[.5,.8],[.8,.8]],           // 8
        [[.2,.2],[.5,.2],[.8,.2],[.2,.5],[.5,.5],[.8,.5],[.2,.8],[.5,.8],[.8,.8]],   // 9
        [[.15,.2],[.38,.2],[.62,.2],[.85,.2],[.15,.5],[.85,.5],[.15,.8],[.38,.8],[.62,.8],[.85,.8]], // 10
        [[.15,.2],[.38,.2],[.62,.2],[.85,.2],[.15,.5],[.5,.5],[.85,.5],[.15,.8],[.38,.8],[.62,.8],[.85,.8]], // 11
        [[.15,.2],[.38,.2],[.62,.2],[.85,.2],[.15,.5],[.38,.5],[.62,.5],[.85,.5],[.15,.8],[.38,.8],[.62,.8],[.85,.8]], // 12
      ];

      // Collect all unique sample positions across all layouts
      const posMap = new Map();
      L.forEach(layout => layout.forEach(([x,y]) => { const k=`${x},${y}`; if (!posMap.has(k)) posMap.set(k,[x,y]); }));
      const allPos = [...posMap.values()];

      // Sample pip-mask coverage at every position once
      const dMap = new Map();
      allPos.forEach(([x,y]) => dMap.set(`${x},${y}`, sample(x,y)));

      // Score each count: pip positions should have high mask coverage (pip detected),
      // empty positions should have low coverage. Signal = avg(pip) - avg(empty).
      let best = 0, bestScore = -Infinity;
      for (let n = 0; n <= 12; n++) {
        const pipKeys = new Set(L[n].map(([x,y]) => `${x},${y}`));
        let pipD = 0, emptyD = 0, pipN = 0, emptyN = 0;
        allPos.forEach(([x,y]) => {
          const d = dMap.get(`${x},${y}`);
          if (pipKeys.has(`${x},${y}`)) { pipD += d; pipN++; }
          else { emptyD += d; emptyN++; }
        });
        const avgPip   = pipN   ? pipD   / pipN   : 0;
        const avgEmpty = emptyN ? emptyD / emptyN : 0;
        const score = n === 0 ? -avgEmpty : avgPip - avgEmpty;
        if (score > bestScore) { bestScore = score; best = n; }
      }
      return best;
    } finally {
      if (resized)  resized.delete();
      if (gray)     gray.delete();
      if (thresh)   thresh.delete();
      inner.delete();
    }
  }

  function countPipsContour(halfMat) {
    // Original contour-based approach (kept for reference / fallback).
    const pad = Math.max(2, Math.floor(Math.min(halfMat.rows, halfMat.cols) * 0.05));
    const rw = halfMat.cols - 2 * pad, rh = halfMat.rows - 2 * pad;
    if (rw < 10 || rh < 10) return 0;
    const inner = halfMat.roi(new cv.Rect(pad, pad, rw, rh));
    let gray = null, thresh = null, conts = null, hierP = null;
    try {
      gray = new cv.Mat();
      cv.cvtColor(inner, gray, cv.COLOR_RGBA2GRAY);
      // Global Otsu threshold cleanly separates dark pips from the bright tile.
      // (adaptiveThreshold with a small block hollows large pips into thin rings
      // that fail the area/circularity filters; equalizeHist over-amplifies and
      // merges pips — both verified worse on the reference photos.)
      thresh = new cv.Mat();
      cv.threshold(gray, thresh, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);
      conts = new cv.MatVector();
      hierP = new cv.Mat();
      cv.findContours(thresh, conts, hierP, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
      const regionArea = rw * rh, minPip = regionArea * 0.002, maxPip = regionArea * 0.10;
      const pipAreas = [], bigBlobs = [];
      for (let i = 0; i < conts.size(); i++) {
        const c = conts.get(i);
        const area = cv.contourArea(c);
        const peri = cv.arcLength(c, true);
        c.delete();
        const circ = peri > 0 ? (4 * Math.PI * area) / (peri * peri) : 0;
        if (area >= minPip && area <= maxPip && circ >= 0.45) {
          pipAreas.push(area);
        } else if (area >= minPip && area <= maxPip * 8 && circ >= 0.15 && circ < 0.45) {
          // Low-circularity blob — may be 2-4 adjacent pips merged in a dense grid.
          // Floor of 0.15 rejects thin divider-bar / edge slivers (circ ~0.1),
          // which are lines, not pips, and were being added as phantom counts.
          bigBlobs.push(area);
        }
      }
      const pipArea = pipAreas.length
        ? pipAreas.reduce((a, b) => a + b, 0) / pipAreas.length
        : maxPip * 0.25;
      // Apply merged-blob estimation only when 8-9 individual pips are cleanly
      // detected — the signature of a 12-pip (4×3) dense half where 3-4 adjacent
      // pips fuse into one low-circularity blob. If ≥10 are already individually
      // detected, the count is not deficient and adding blobs would overcount.
      let count = pipAreas.length;
      if (pipAreas.length >= 6 && pipAreas.length < 8) {
        // accepted 6-7 pips + large fused blobs: likely a 9-pip (3×3) half where
        // some pips merged under thresholding. Upper bound 4× excludes the tile's
        // central dividing line (which appears as a huge blob, often >8×).
        for (const ba of bigBlobs) {
          const r = ba / pipArea;
          if (r >= 0.8 && r <= 4.0) count += Math.round(r);
        }
      } else if (pipAreas.length >= 8 && pipAreas.length < 10) {
        if (pipAreas.length === 9 && bigBlobs.length >= 2) {
          // Two bigBlobs with n=9 and at least one large (≥1.5×): signature of a
          // 12-pip half where pips fused. Require the large blob to avoid
          // miscounting genuine 9-pip halves with two small noise blobs.
          const hasLargeBigBlob = bigBlobs.some(ba => ba >= pipArea * 1.5);
          if (hasLargeBigBlob) {
            for (const ba of bigBlobs) {
              if (ba < pipArea * 0.6) count += 1;
              else if (ba >= pipArea * 1.5) count += Math.round(ba / pipArea);
            }
          }
        } else {
          const sortedBig = bigBlobs.slice().sort((a, b) => a - b);
          const hasSubstantialSmall = sortedBig.length >= 2 && sortedBig[0] >= pipArea * 0.15;
          for (const ba of bigBlobs) {
            if (!hasSubstantialSmall && ba >= pipArea * 2.5) {
              count += Math.round(ba / pipArea);
              if (pipAreas.length === 8) count += 1;
            } else if (ba >= pipArea * 1.5 && pipAreas.length === 8) {
              count += 1;
            }
          }
        }
      }
      return Math.min(count, 12);
    } finally {
      inner.delete();
      if (gray)   gray.delete();
      if (thresh) thresh.delete();
      if (conts)  conts.delete();
      if (hierP)  hierP.delete();
    }
  }

  // Crop + rotate a tile to a canvas dataUrl (shared helper for scanCanvasDebug).
  function cropToDataUrl(src, pts) {
    const cx = (pts[0].x+pts[1].x+pts[2].x+pts[3].x)/4;
    const cy = (pts[0].y+pts[1].y+pts[2].y+pts[3].y)/4;
    const d01 = Math.hypot(pts[1].x-pts[0].x, pts[1].y-pts[0].y);
    const d03 = Math.hypot(pts[3].x-pts[0].x, pts[3].y-pts[0].y);
    let angle = d01>=d03
      ? Math.atan2(pts[1].y-pts[0].y, pts[1].x-pts[0].x)*180/Math.PI
      : Math.atan2(pts[3].y-pts[0].y, pts[3].x-pts[0].x)*180/Math.PI;
    const tileW = Math.max(d01,d03), tileH = Math.min(d01,d03);
    while (angle > 90) angle -= 180;
    while (angle <= -90) angle += 180;
    const pad = 0.08;
    const outW = Math.round(tileW*(1+2*pad)), outH = Math.round(tileH*(1+2*pad));
    let M = null, rotated = null, cropped = null;
    try {
      M = cv.getRotationMatrix2D(new cv.Point(cx,cy), angle, 1.0);
      rotated = new cv.Mat();
      cv.warpAffine(src, rotated, M, new cv.Size(src.cols, src.rows), cv.INTER_LINEAR, cv.BORDER_REPLICATE);
      const x = Math.max(0, Math.round(cx-outW/2));
      const y = Math.max(0, Math.round(cy-outH/2));
      const w = Math.min(src.cols-x, outW), h = Math.min(src.rows-y, outH);
      if (w < 20 || h < 20) return "";
      cropped = rotated.roi(new cv.Rect(x,y,w,h));
      const tmp = document.createElement("canvas");
      cv.imshow(tmp, cropped);
      return tmp.toDataURL("image/jpeg", 0.85);
    } finally {
      if (M) M.delete();
      if (cropped) cropped.delete();
      if (rotated) rotated.delete();
    }
  }

  // Returns [{left, right, dataUrl}, …] — same as scanCanvas but with a
  // thumbnail of each cropped+rotated tile for visual debugging.
  function scanCanvasDebug(canvas) {
    let src = null;
    try {
      src = cv.imread(canvas);
      const found = findTiles(src, 0.015, 0.70, 0.03);
      found.sort((a, b) => Math.abs(a.cy - b.cy) > 60 ? a.cy - b.cy : a.cx - b.cx);
      return found.map(t => {
        const result = countQuad(src, t.pts);
        const dataUrl = cropToDataUrl(src, t.pts);
        return { left: result.left, right: result.right, dataUrl };
      });
    } finally {
      if (src) src.delete();
    }
  }

  window.DominoCV = {
    loadCV, preprocess, scanCanvas, scanCanvasDebug, scanCanvasSingle, isReady: () => cvReady,
    // Headless-test hooks: operate on pixel arrays / Mats (no canvas/DOM).
    _test: { stretchGray, findTiles, splitAndCount, scanMat, scanMatSingle, halfDensity, getHalvesMats }
  };
})();
