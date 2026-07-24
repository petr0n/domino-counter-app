// scanner/preprocess.js
// Letterbox resize+pad to a square target size, matching Ultralytics'
// LetterBox(auto=False, scale_fill=False, scaleup=True, center=True,
// padding_value=114) -- verified 2026-07-23 as the exact behavior of
// model.predict() with rect=False, which train/predict.py relies on
// unchanged (rect is never set anywhere in this repo, so it's the default).

export function computeLetterboxParams(srcW, srcH, targetSize) {
  const scale = Math.min(targetSize / srcW, targetSize / srcH);
  const newW = Math.round(srcW * scale);
  const newH = Math.round(srcH * scale);
  const dw = targetSize - newW;
  const dh = targetSize - newH;
  // + 0 normalizes -0 -> 0: Math.round(-0.1) yields -0 in JS (unlike
  // Python's int(round(-0.1)) == 0), which trips assert.strictEqual's
  // Object.is-based comparison when dw or dh is exactly 0.
  const padLeft = Math.round(dw / 2 - 0.1) + 0;
  const padTop = Math.round(dh / 2 - 0.1) + 0;
  return { scale, newW, newH, padLeft, padTop };
}

export function unletterboxPoint(x, y, params) {
  return {
    x: (x - params.padLeft) / params.scale,
    y: (y - params.padTop) / params.scale,
  };
}

// canvasFactory: (w, h) => { canvas, ctx } -- injected so this stays
// dependency-free here; the harness (Task 9) passes an OffscreenCanvas
// factory. imageData: {data: Uint8ClampedArray (RGBA), width, height}.
export function letterboxImage(imageData, targetSize, canvasFactory) {
  const { width: w, height: h } = imageData;
  const params = computeLetterboxParams(w, h, targetSize);
  const src = canvasFactory(w, h);
  src.ctx.putImageData(imageData, 0, 0);
  const dst = canvasFactory(targetSize, targetSize);
  dst.ctx.fillStyle = 'rgb(114,114,114)';
  dst.ctx.fillRect(0, 0, targetSize, targetSize);
  dst.ctx.drawImage(src.canvas, 0, 0, w, h,
                    params.padLeft, params.padTop, params.newW, params.newH);
  return { imageData: dst.ctx.getImageData(0, 0, targetSize, targetSize), params };
}
