const PROXY = window.PROXY_URL;
const OWNER = "petr0n", REPO = "domino-counter-app";

let catalog = { tiles: {} };
let tiles = [], pendingTiles = [];
let analysing = false, analysisTimer = null;
let vcap = null;

const video         = document.getElementById("video");
const canvas        = document.getElementById("canvas");
const preview       = document.getElementById("preview");
const loadedPhoto   = document.getElementById("loadedPhoto");
const scanBtn       = document.getElementById("scanBtn");
const loadBtn       = document.getElementById("loadBtn");
const fileInput     = document.getElementById("fileInput");
const retakeBtn     = document.getElementById("retakeBtn");
const errorEl       = document.getElementById("error");
const infoEl        = document.getElementById("info");
const reviewPanel   = document.getElementById("reviewPanel");
const tileRows      = document.getElementById("tileRows");
const reviewTotal   = document.getElementById("reviewTotal");
const cameraWrapper = document.getElementById("cameraWrapper");
const guidanceEl    = document.getElementById("guidance");
const camGuide      = document.getElementById("camGuide");

let photoMode = false;
let photoState = null;
let _touchRef = null;

function applyPhotoTransform() {
  const { tx, ty, scale } = photoState;
  loadedPhoto.style.transform =
    `translate(calc(-50% + ${tx}px), calc(-50% + ${ty}px)) scale(${scale})`;
}

loadedPhoto.addEventListener("touchstart", e => {
  e.preventDefault();
  const t = e.touches;
  if (t.length === 1) {
    _touchRef = { type: "pan", sx: t[0].clientX, sy: t[0].clientY,
                  tx: photoState.tx, ty: photoState.ty };
  } else if (t.length === 2) {
    const dx = t[0].clientX - t[1].clientX, dy = t[0].clientY - t[1].clientY;
    _touchRef = { type: "pinch", dist: Math.hypot(dx, dy), scale: photoState.scale,
                  tx: photoState.tx, ty: photoState.ty };
  }
}, { passive: false });

loadedPhoto.addEventListener("touchmove", e => {
  e.preventDefault();
  if (!_touchRef) return;
  const t = e.touches;
  if (t.length === 1 && _touchRef.type === "pan") {
    photoState.tx = _touchRef.tx + (t[0].clientX - _touchRef.sx);
    photoState.ty = _touchRef.ty + (t[0].clientY - _touchRef.sy);
    applyPhotoTransform();
  } else if (t.length === 2 && _touchRef.type === "pinch") {
    const dx = t[0].clientX - t[1].clientX, dy = t[0].clientY - t[1].clientY;
    photoState.scale = Math.max(0.1, Math.min(10, _touchRef.scale * Math.hypot(dx, dy) / _touchRef.dist));
    applyPhotoTransform();
  }
}, { passive: false });

loadedPhoto.addEventListener("touchend", () => { _touchRef = null; }, { passive: true });

// Load catalog in background for cross-reference
fetch(`${PROXY}/github/repos/${OWNER}/${REPO}/contents/catalog.json`, {
  headers: { Accept: "application/vnd.github.v3+json" }
}).then(r => r.ok ? r.json() : null)
  .then(j => { if (j) catalog = JSON.parse(atob(j.content.replace(/\n/g, ""))); })
  .catch(() => {});

navigator.mediaDevices.getUserMedia({
  video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 960 } },
  audio: false
}).then(s => { video.srcObject = s; })
  .catch(() => showError("Camera access denied."));

// Detection (loadCV / preprocess / scanCanvas) lives in detect.js — the one
// shared pipeline. After OpenCV loads, set up the guidance capture once.
async function ensureCV() {
  await DominoCV.loadCV();
  if (!vcap) { vcap = new cv.VideoCapture(video); startAnalysis(); }
}

// ── Real-time frame guidance ─────────────────────────────────────────────
// Checks brightness, sharpness, and estimates tile count in frame.

function startAnalysis() {
  if (analysing) return;
  analysing = true;
  scheduleAnalysis();
}

function stopAnalysis() {
  analysing = false;
  if (analysisTimer) { clearTimeout(analysisTimer); analysisTimer = null; }
}

function scheduleAnalysis() {
  if (!analysing) return;
  analysisTimer = setTimeout(runAnalysis, 450);
}

function runAnalysis() {
  if (!analysing || !DominoCV.isReady() || !video.videoWidth) { scheduleAnalysis(); return; }

  let src = null, small = null, gray = null, lap = null, mM = null, sM = null;
  let binary = null, contours = null, hier = null, blurSmall = null;
  try {
    src = new cv.Mat(video.videoHeight, video.videoWidth, cv.CV_8UC4);
    vcap.read(src);

    small = new cv.Mat();
    cv.resize(src, small, new cv.Size(320, 240));

    gray = new cv.Mat();
    cv.cvtColor(small, gray, cv.COLOR_RGBA2GRAY);

    // Brightness
    mM = new cv.Mat(); sM = new cv.Mat();
    cv.meanStdDev(gray, mM, sM);
    const brightness = mM.data64F[0];
    mM.delete(); sM.delete(); mM = null; sM = null;

    // Sharpness
    lap = new cv.Mat();
    cv.Laplacian(gray, lap, cv.CV_8U);
    mM = new cv.Mat(); sM = new cv.Mat();
    cv.meanStdDev(lap, mM, sM);
    const sharpness = sM.data64F[0];
    mM.delete(); sM.delete(); mM = null; sM = null;

    // Quick tile-count estimate — isolated so a failure can't break the guidance loop
    let tileCount = 0;
    if (brightness >= 55 && brightness <= 215 && sharpness >= 4) {
      try {
        blurSmall = new cv.Mat();
        cv.GaussianBlur(gray, blurSmall, new cv.Size(5, 5), 0);
        binary = new cv.Mat();
        cv.Canny(blurSmall, binary, 20, 60);
        contours = new cv.MatVector();
        hier = new cv.Mat();
        cv.findContours(binary, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
        const smallArea = 320 * 240;
        for (let i = 0; i < contours.size(); i++) {
          const c = contours.get(i);
          const a = cv.contourArea(c);
          c.delete();
          if (a > smallArea * 0.03 && a < smallArea * 0.60) tileCount++;
        }
        tileCount = Math.min(tileCount, 9);
      } catch (_) { tileCount = 0; }
    }

    let text, state;
    if (brightness < 55) {
      text = "Too dark — find better lighting"; state = "";
    } else if (brightness > 215) {
      text = "Too bright — reduce glare"; state = "";
    } else if (sharpness < 4) {
      text = "Hold steady — too blurry"; state = "";
    } else if (tileCount === 0) {
      text = "Point camera at tiles"; state = "";
    } else if (sharpness < 9) {
      text = `${tileCount} tile${tileCount !== 1 ? "s" : ""} detected — hold steadier`; state = "warn";
    } else {
      text = `${tileCount} tile${tileCount !== 1 ? "s" : ""} detected — tap Scan`; state = "good";
    }

    setGuidance(text, state);
  } catch (_) {
  } finally {
    if (src)      src.delete();
    if (small)    small.delete();
    if (gray)     gray.delete();
    if (lap)      lap.delete();
    if (mM)       mM.delete();
    if (sM)       sM.delete();
    if (binary)    binary.delete();
    if (contours)  contours.delete();
    if (hier)      hier.delete();
    if (blurSmall) blurSmall.delete();
  }
  scheduleAnalysis();
}

function setGuidance(text, state) {
  guidanceEl.textContent = text;
  guidanceEl.className = "guidance" + (state ? " " + state : "");
  cameraWrapper.className = "camera-wrapper" + (state ? " " + state : "");
}

// ── Shared scan logic ────────────────────────────────────────────────────
async function doScan(filename) {
  hideMsg();
  reviewPanel.classList.remove("visible");
  // Crop to the guide box region (8% margin each side) before detection
  (function cropToGuide() {
    const cw = canvas.width, ch = canvas.height;
    const x1 = Math.round(cw * 0.08), y1 = Math.round(ch * 0.08);
    const w  = Math.round(cw * 0.84), h  = Math.round(ch * 0.84);
    const d  = canvas.getContext("2d").getImageData(x1, y1, w, h);
    canvas.width = w; canvas.height = h;
    canvas.getContext("2d").putImageData(d, 0, 0);
  })();
  const rawCropUrl = window.__domCapture ? canvas.toDataURL("image/jpeg", 0.92) : null;
  DominoCV.preprocess(canvas);

  const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
  preview.src = dataUrl;
  preview.style.display   = "block";
  video.style.display     = "none";
  camGuide.style.display  = "none";
  scanBtn.style.display   = "none";
  loadBtn.style.display   = "none";
  retakeBtn.style.display = "block";
  stopAnalysis();
  setGuidance("", "");
  scanBtn.disabled = true;
  loadBtn.disabled = true;

  try {
    showInfo("Detecting tiles…");
    await ensureCV();
    const found = DominoCV.scanCanvasDebug(canvas);
    if (window.__domCapture) window.__domCapture({ file: filename||null, frame: rawCropUrl, tiles: found||[] });
    if (!found || !found.length) throw new Error("No tiles found. Make sure tiles are fully in frame and well-lit.");
    pendingTiles = found;
    renderReview();
    reviewPanel.classList.add("visible");
    hideMsg();
  } catch (err) {
    showError(err.message);
  } finally {
    scanBtn.disabled = false;
    loadBtn.disabled = false;
  }
}

// ── Scan button (camera or loaded photo) ─────────────────────────────────
scanBtn.addEventListener("click", async () => {
  if (photoMode) {
    // Render the loaded photo at its current pan/zoom position onto canvas,
    // then run the normal scan pipeline (which crops the guide-box 8% margin).
    const wr = cameraWrapper.getBoundingClientRect();
    const W = wr.width, H = wr.height;
    const dpr = window.devicePixelRatio || 1;
    canvas.width  = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const { tx, ty, scale, iw, ih } = photoState;
    const cs = scale * dpr;
    ctx.setTransform(cs, 0, 0, cs, (W / 2 + tx) * dpr - iw * cs / 2, (H / 2 + ty) * dpr - ih * cs / 2);
    ctx.drawImage(loadedPhoto, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    photoMode = false;
    loadedPhoto.style.display = "none";
    await ensureCV();
    await doScan(photoState.filename);
  } else {
    if (!video.videoWidth) { showError("Camera not ready."); return; }
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    await doScan(Math.random().toString(36).slice(2, 7) + ".jpg");
  }
});

// ── Load Photo button ────────────────────────────────────────────────────
loadBtn.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  const file = fileInput.files[0];
  if (!file) return;
  fileInput.value = "";
  const url = URL.createObjectURL(file);
  loadedPhoto.onload = () => {
    URL.revokeObjectURL(url);
    const wr = cameraWrapper.getBoundingClientRect();
    const iw = loadedPhoto.naturalWidth, ih = loadedPhoto.naturalHeight;
    const initScale = Math.min(wr.width / iw, wr.height / ih);
    loadedPhoto.style.width  = iw + "px";
    loadedPhoto.style.height = ih + "px";
    photoState = { tx: 0, ty: 0, scale: initScale, iw, ih, filename: file.name };
    applyPhotoTransform();
    photoMode = true;
    loadedPhoto.style.display = "block";
    video.style.display       = "none";
    camGuide.style.display    = "block";
    scanBtn.style.display     = "block";
    loadBtn.style.display     = "none";
    retakeBtn.style.display   = "block";
    stopAnalysis();
    setGuidance("Drag to reposition · pinch to zoom · tap Scan when ready", "");
  };
  loadedPhoto.onerror = () => { URL.revokeObjectURL(url); showError("Could not load image."); };
  loadedPhoto.src = url;
});

// ── Retake ───────────────────────────────────────────────────────────────
retakeBtn.addEventListener("click", () => {
  photoMode = false;
  loadedPhoto.style.display = "none";
  preview.style.display     = "none";
  video.style.display       = "block";
  camGuide.style.display    = "block";
  scanBtn.style.display     = "block";
  loadBtn.style.display     = "block";
  retakeBtn.style.display   = "none";
  reviewPanel.classList.remove("visible");
  hideMsg();
  startAnalysis();
});

// ── Review panel helpers ─────────────────────────────────────────────────
function tileKey(l, r) { return `${Math.min(l, r)}-${Math.max(l, r)}`; }
function inCatalog(l, r) { return !!catalog.tiles?.[tileKey(l, r)]; }

function renderReview() {
  tileRows.innerHTML = pendingTiles.map((t, i) => {
    const ok    = inCatalog(t.left, t.right);
    const blur  = t.fill != null && t.fill < 0.75;
    const badge = blur
      ? `<span class="badge unk">? merged tiles?</span>`
      : ok
        ? `<span class="badge ok">&#x2713; catalog</span>`
        : `<span class="badge unk">? check</span>`;
    const img = t.dataUrl ? `<img src="${t.dataUrl}" alt="tile ${i+1}">` : "";
    return `<div class="tile-card">
      ${img}
      <div class="tile-row">
        <input type="number" min="0" max="12" value="${t.left}"  onchange="upd(${i},'left',this.value)" />
        <span class="sep">|</span>
        <input type="number" min="0" max="12" value="${t.right}" onchange="upd(${i},'right',this.value)" />
        <span class="total">= ${t.left + t.right}</span>
        ${badge}
        <button class="del" onclick="rmv(${i})">&#x2715;</button>
      </div>
    </div>`;
  }).join("");
  const sum = pendingTiles.reduce((s, t) => s + t.left + t.right, 0);
  reviewTotal.textContent = `Total: ${sum} across ${pendingTiles.length} tile${pendingTiles.length !== 1 ? "s" : ""}`;
}

function clampPip(v){return Math.min(12,Math.max(0,parseInt(v)||0));}
function upd(i, side, val) { pendingTiles[i][side] = clampPip(val); renderReview(); }
function rmv(i) { pendingTiles.splice(i, 1); if (!pendingTiles.length) { reviewPanel.classList.remove("visible"); return; } renderReview(); }

function confirmAll() {
  if (!pendingTiles.length) return;
  if(pendingTiles.some(t=>t.left>12||t.right>12||t.left<0||t.right<0)){showError("Each side must be 0–12.");return;}
  tiles.push(...pendingTiles);
  pendingTiles = [];
  renderHistory();
  reviewPanel.classList.remove("visible");
  photoMode = false;
  loadedPhoto.style.display = "none";
  preview.style.display     = "none";
  video.style.display       = "block";
  camGuide.style.display    = "block";
  scanBtn.style.display     = "block";
  loadBtn.style.display     = "block";
  retakeBtn.style.display   = "none";
  hideMsg();
  startAnalysis();
}

function renderHistory() {
  const total = tiles.reduce((s, t) => s + t.left + t.right, 0);
  document.getElementById("runningTotal").textContent = total;
  if (!tiles.length) {
    document.getElementById("historyList").innerHTML = '<p class="empty">No tiles yet</p>';
    return;
  }
  document.getElementById("historyList").innerHTML = [...tiles].reverse().map((t, ri) => {
    const i = tiles.length - 1 - ri;
    return `<div class="history-item"><strong>${t.left} | ${t.right}</strong><span>= ${t.left + t.right}</span><button onclick="removeItem(${i})">&#x2715;</button></div>`;
  }).join("");
}

function removeItem(i) { tiles.splice(i, 1); renderHistory(); }
function resetAll() { tiles = []; pendingTiles = []; renderHistory(); reviewPanel.classList.remove("visible"); }

function showError(m) { errorEl.textContent = m; errorEl.style.display = "block"; infoEl.style.display = "none"; }
function showInfo(m)  { infoEl.textContent  = m; infoEl.style.display  = "block"; errorEl.style.display = "none"; }
function hideMsg()    { errorEl.style.display = "none"; infoEl.style.display = "none"; }
