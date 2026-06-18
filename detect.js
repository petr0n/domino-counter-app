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

  // Try to split a low-fill merged blob by applying a stronger local erosion
  // within the blob's bounding box, then re-finding individual tile contours.
  // Returns [{pts,cx,cy,fill}, …] (0 or ≥2 entries) or [].
  function splitMergedBlob(binary, brect, minArea) {
    const pad = Math.round(Math.max(brect.width, brect.height) * 0.04);
    const rx = Math.max(0, brect.x - pad);
    const ry = Math.max(0, brect.y - pad);
    const rw = Math.min(binary.cols - rx, brect.width  + 2 * pad);
    const rh = Math.min(binary.rows - ry, brect.height + 2 * pad);
    let roi = null, cp = null, k2 = null, er2 = null, c2 = null, h2 = null;
    try {
      roi = binary.roi(new cv.Rect(rx, ry, rw, rh));
      cp = new cv.Mat(); roi.copyTo(cp);
      // Use 5% of the ROI's short side — much smaller than full-image erosion,
      // but enough to break the narrow contact between touching tiles.
      const kSz = Math.max(5, Math.round(Math.min(rw, rh) * 0.05));
      k2 = cv.Mat.ones(kSz, kSz, cv.CV_8U);
      er2 = new cv.Mat(); cv.erode(cp, er2, k2);
      c2 = new cv.MatVector(); h2 = new cv.Mat();
      cv.findContours(er2, c2, h2, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
      const out = [];
      for (let i = 0; i < c2.size(); i++) {
        const c = c2.get(i);
        const area = cv.contourArea(c);
        if (area < minArea * 0.30) { c.delete(); continue; }
        const r = cv.minAreaRect(c); c.delete();
        const rw2 = r.size.width, rh2 = r.size.height;
        const ratio = Math.max(rw2, rh2) / Math.min(rw2, rh2);
        if (ratio < 1.5 || ratio > 3.0) continue;
        const pts = cv.RotatedRect.points(r).map(p => ({ x: p.x + rx, y: p.y + ry }));
        const hcx = (pts[0].x+pts[1].x+pts[2].x+pts[3].x)/4;
        const hcy = (pts[0].y+pts[1].y+pts[2].y+pts[3].y)/4;
        out.push({ pts, cx: hcx, cy: hcy, fill: area / (rw2 * rh2) });
      }
      return out.length >= 2 ? out : [];
    } finally {
      if (roi) roi.delete();
      if (cp)  cp.delete();
      if (k2)  k2.delete();
      if (er2) er2.delete();
      if (c2)  c2.delete();
      if (h2)  h2.delete();
    }
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
          // Accept only single-tile shapes (~2:1). Erosion separates touching
          // tiles into their own contours, so accepting ~1:1 or ~4:1 blobs only
          // lets two merged tiles through as one and miscounts them.
          // Also reject blobs with very low fill ratio — merged tile pairs span
          // two tiles in their minAreaRect (fill ≈ 0.55-0.65 vs ≥ 0.80 single).
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
          } else if (fill >= 0.40 && fill < 0.72 && ratio >= 2.0) {
            // Possible merged tile pair — try targeted-erosion split
            const brect = cv.boundingRect(c);
            const splits = splitMergedBlob(binary, brect, minArea);
            const shortSide = Math.min(rw, rh);
            for (const t of splits) {
              const dup = rects.some(r => Math.hypot(r.cx - t.cx, r.cy - t.cy) < shortSide * 0.4);
              if (!dup) rects.push(t);
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
  function splitAndCount(mat, fill) {
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
      return { left: countPips(halfA, fill), right: countPips(halfB, fill) };
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
      if (w < 20 || h < 20) return splitAndCount(src, fill);
      cropped = rotated.roi(new cv.Rect(x, y, w, h));
      return splitAndCount(cropped, fill);
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
    const found = findTiles(src, 0.015, 0.70, 0.03);
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
    return splitAndCount(src, null);
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

  function countPips(halfMat, fill) {
    return countPipsGridFit(halfMat, fill);
  }

  const median = (a) => {
    if (!a.length) return 0;
    const s = [...a].sort((x, y) => x - y), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };

  // Cluster 1-D values into evenly-spaced lattice lines, then fill any line
  // skipped by a fully-empty row/column (gap that is an integer multiple of the
  // pitch). tol = merge distance for points on the same line.
  function latticeLines(vals, tol) {
    const sorted = [...vals].sort((a, b) => a - b);
    const groups = [[sorted[0]]];
    for (let k = 1; k < sorted.length; k++) {
      const last = groups[groups.length - 1];
      if (sorted[k] - last[last.length - 1] <= tol) last.push(sorted[k]);
      else groups.push([sorted[k]]);
    }
    let centers = groups.map(g => g.reduce((a, b) => a + b, 0) / g.length);
    if (centers.length >= 2) {
      let pitch = Infinity;
      for (let k = 1; k < centers.length; k++) pitch = Math.min(pitch, centers[k] - centers[k - 1]);
      const filled = [centers[0]];
      for (let k = 1; k < centers.length; k++) {
        const gap = centers[k] - centers[k - 1];
        const steps = Math.max(1, Math.round(gap / pitch));
        for (let s = 1; s < steps; s++) filled.push(centers[k - 1] + (gap / steps) * s);
        filled.push(centers[k]);
      }
      centers = filled;
    }
    return centers;
  }

  // Pip counting via the domino grid model (see CLAUDE.md): every half holds its
  // pips on a 3-row lattice that is 3 columns wide for 0-9 pips or 4 columns wide
  // for 10-12. Detect pip blobs, infer the lattice, then count occupied cells —
  // robust to a dropped pip (the empty cell is still occupancy-tested on the mask)
  // and to a stray off-lattice blob (only lattice cells are counted).
  function countPipsGridFit(halfMat, fill) {
    const pad = Math.max(2, Math.floor(Math.min(halfMat.rows, halfMat.cols) * 0.05));
    const rw = halfMat.cols - 2 * pad, rh = halfMat.rows - 2 * pad;
    if (rw < 10 || rh < 10) return 0;
    const inner = halfMat.roi(new cv.Rect(pad, pad, rw, rh));
    let gray = null, thresh = null, conts = null, hier = null;
    try {
      gray = new cv.Mat();
      cv.cvtColor(inner, gray, cv.COLOR_RGBA2GRAY);
      // Otsu inverse threshold: dark pips become white blobs on a black field.
      thresh = new cv.Mat();
      cv.threshold(gray, thresh, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);
      conts = new cv.MatVector(); hier = new cv.Mat();
      cv.findContours(thresh, conts, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

      // Clean pips: round (high-circularity) blobs in the pip size range. The
      // central divider and tile border are long/irregular (low circularity) and
      // are reliably excluded here — tiles never overlap and pips never merge,
      // so every real pip is its own round contour.
      const regionArea = rw * rh, minPip = regionArea * 0.0015, maxPip = regionArea * 0.12;
      const pips = [];
      for (let i = 0; i < conts.size(); i++) {
        const c = conts.get(i);
        const area = cv.contourArea(c), peri = cv.arcLength(c, true);
        const circ = peri > 0 ? (4 * Math.PI * area) / (peri * peri) : 0;
        if (area >= minPip && area <= maxPip && circ >= 0.45) {
          const m = cv.moments(c);
          if (m.m00) pips.push({ cx: m.m10 / m.m00, cy: m.m01 / m.m00, d: Math.sqrt(area * 4 / Math.PI) });
        }
        c.delete();
      }
      const n = pips.length;
      // 0-2 pips form no usable lattice; the clean count is already correct.
      if (n <= 2) return n;

      // Infer the pip lattice from the clean centres: always 3 rows; 3 columns
      // for 0-9, 4 columns for 10-12 (per the domino grid model in CLAUDE.md).
      const diam = median(pips.map(p => p.d));
      let colXs = latticeLines(pips.map(p => p.cx), diam * 0.6);
      let rowYs = latticeLines(pips.map(p => p.cy), diam * 0.6);
      if (colXs.length > 4) colXs = colXs.slice(0, 4);
      if (rowYs.length > 3) rowYs = [rowYs[0], rowYs[Math.floor(rowYs.length / 2)], rowYs[rowYs.length - 1]];

      // Occupancy: is there pip mass within a small window centred at (x,y)?
      // Recovers a pip the contour filter dropped (e.g. a specular highlight)
      // without inventing pips, since only inferred lattice cells are tested.
      const win = Math.max(2, Math.round(diam * 0.35));
      const occupied = (x, y) => {
        let white = 0, tot = 0;
        for (let yy = Math.round(y - win); yy <= y + win; yy++) {
          if (yy < 0 || yy >= thresh.rows) continue;
          for (let xx = Math.round(x - win); xx <= x + win; xx++) {
            if (xx < 0 || xx >= thresh.cols) continue;
            tot++; if (thresh.ucharAt(yy, xx) > 0) white++;
          }
        }
        return tot > 0 && white / tot > 0.30;
      };

      let count = 0;
      if (colXs.length >= 4) {
        // 4×3 grid (10-12): top & bottom rows are always full (4 each); the
        // middle row's pips sit at left/centre/right spacings that do NOT align
        // to the 4 columns, so count the middle row by its blobs, not by column.
        const midIdx = Math.floor(rowYs.length / 2);
        rowYs.forEach((ry, ri) => {
          if (ri === midIdx) count += pips.filter(p => Math.abs(p.cy - ry) <= diam * 0.7).length;
          else for (const cx of colXs) if (occupied(cx, ry)) count++;
        });
      } else {
        for (const ry of rowYs) for (const cx of colXs) if (occupied(cx, ry)) count++;
      }
      // Never report fewer pips than were cleanly detected.
      return Math.min(Math.max(count, n), 12);
    } finally {
      inner.delete();
      if (gray)   gray.delete();
      if (thresh) thresh.delete();
      if (conts)  conts.delete();
      if (hier)   hier.delete();
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
    _test: { stretchGray, findTiles, scanMat, scanMatSingle, splitAndCount, countPips }
  };
})();
