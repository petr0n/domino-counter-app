// Local dev tool — unified static server + scan logger for quick.html live capture.
// Serves the app, injects eval/dev-capture.js into quick.html, and on POST /log
// saves the full frame + per-tile crops to eval/ and appends eval/scan-log.json.
// Run: node log-server.cjs   (expose: cloudflared tunnel --url http://localhost:8766)
// NOT shipped — dev only.
const http = require('http');
const fs   = require('fs');
const path = require('path');

const ROOT   = __dirname;                       // repo root (log-server.cjs lives here)
const EVAL   = path.join(ROOT, 'eval');
const SESSION_ID = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const PHOTOS = path.join(EVAL, 'sessions', SESSION_ID, 'photos');
const CROPS  = path.join(EVAL, 'sessions', SESSION_ID, 'crops');
const LOG    = path.join(EVAL, 'scan-log.json');
const CORPUS_DIR   = path.join(EVAL, 'corpus_photos');
const CORPUS_TRUTH = path.join(EVAL, 'corpus_truth.json');
const PORT   = 8766;
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css',
  '.json':'application/json', '.jpg':'image/jpeg', '.jpeg':'image/jpeg',
  '.png':'image/png', '.ico':'image/x-icon', '.svg':'image/svg+xml' };

function serveStatic(req, res) {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/index.html';
  const fp = path.join(ROOT, rel.slice(1));

  // Stay inside ROOT (trailing sep avoids sibling-prefix escape) and never serve
  // dotfiles/dirs like .git or .claude over the public tunnel.
  if (!fp.startsWith(ROOT + path.sep) || rel.includes('/.') || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
    res.writeHead(404); res.end('Not Found'); return;
  }
  let body = fs.readFileSync(fp);
  if (rel === '/quick.html') {
    body = Buffer.from(body.toString('utf8').replace(
      '</body>', '<script src="/eval/dev-capture.js"></script>\n</body>'));
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream' });
  res.end(body);
}

http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS, GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  // Corpus labeling: list photos + existing truth, and persist corrections.
  if (req.method === 'GET' && req.url === '/corpus/list') {
    const truth = fs.existsSync(CORPUS_TRUTH) ? JSON.parse(fs.readFileSync(CORPUS_TRUTH, 'utf8') || '{}') : {};
    const photos = fs.existsSync(CORPUS_DIR)
      ? fs.readdirSync(CORPUS_DIR).filter(f => /\.(jpe?g|png)$/i.test(f)).sort()
          .map(name => ({ name, mine: (truth[name] || {}).mine || null, truth: (truth[name] || {}).truth || null }))
      : [];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(photos));
    return;
  }
  if (req.method === 'POST' && req.url === '/corpus/upload') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      try {
        const { name, dataUrl } = JSON.parse(body);
        if (!name || !dataUrl) { res.writeHead(400); res.end('name+dataUrl required'); return; }
        if (!fs.existsSync(CORPUS_DIR)) fs.mkdirSync(CORPUS_DIR, { recursive: true });
        const safe = name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '');
        const b64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
        fs.writeFileSync(path.join(CORPUS_DIR, safe), Buffer.from(b64, 'base64'));
        const n = fs.readdirSync(CORPUS_DIR).filter(f => /\.(jpe?g|png)$/i.test(f)).length;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, saved: safe, total: n }));
      } catch (e) { res.writeHead(400); res.end(e.message); }
    });
    return;
  }
  if (req.method === 'POST' && req.url === '/corpus/truth') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      try {
        const { name, mine, truth } = JSON.parse(body);
        if (!name) { res.writeHead(400); res.end('name required'); return; }
        const all = fs.existsSync(CORPUS_TRUTH) ? JSON.parse(fs.readFileSync(CORPUS_TRUTH, 'utf8') || '{}') : {};
        // Freeze 'mine' (my baseline scan) on first save; only update 'truth' after.
        all[name] = { mine: (all[name] && all[name].mine) || mine || [], truth: truth || [] };
        fs.writeFileSync(CORPUS_TRUTH, JSON.stringify(all, null, 2));
        const labeled = Object.values(all).filter(e => e.truth).length;
        console.log('[corpus]', name, '->', JSON.stringify(truth), `(${labeled} labeled)`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, labeled }));
      } catch (e) { res.writeHead(400); res.end(e.message); }
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/log') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body);
        const slug = (parsed.file||'camera').replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_');
        const ts   = Date.now();
        const n    = (parsed.tiles||[]).length;
        if (!fs.existsSync(PHOTOS)) fs.mkdirSync(PHOTOS, { recursive: true });
        if (!fs.existsSync(CROPS)) fs.mkdirSync(CROPS, { recursive: true });
        if (parsed.frame) {
          const fb = parsed.frame.replace(/^data:image\/\w+;base64,/, '');
          fs.writeFileSync(path.join(PHOTOS, `frame_${ts}_d${n}.jpg`), Buffer.from(fb, 'base64'));
        }
        (parsed.tiles||[]).forEach((t, i) => {
          if (!t.dataUrl) return;
          const b64 = t.dataUrl.replace(/^data:image\/\w+;base64,/, '');
          fs.writeFileSync(path.join(CROPS, `crop_${slug}_t${i}_${t.left}-${t.right}.jpg`), Buffer.from(b64, 'base64'));
        });
        // 200k line guard
        let log = [];
        if (fs.existsSync(LOG)) {
          const raw = fs.readFileSync(LOG, 'utf8');
          log = raw ? JSON.parse(raw) : [];
          if (log.length >= 200000) {
            console.warn('[log] scan-log.json at 200k entries — refusing new log');
            res.writeHead(429); res.end('log limit reached'); return;
          }
        }
        const entry = { ts: new Date().toISOString(), file: parsed.file||null, tileCount: parsed.tileCount,
          tiles: (parsed.tiles||[]).map(({dataUrl,...t})=>t) };
        log.push(entry);
        fs.writeFileSync(LOG, JSON.stringify(log, null, 2));
        console.log('[log]', entry.ts, entry.file||'(camera)', entry.tileCount, 'tile(s):',
          (entry.tiles||[]).map(t=>t.left+'|'+t.right).join('  '));
        res.writeHead(200); res.end('ok');
      } catch(e) { res.writeHead(400); res.end(e.message); }
    });
    return;
  }

  if (req.method === 'GET') { serveStatic(req, res); return; }
  res.writeHead(404); res.end();
}).listen(PORT, () => console.log(`Dev server + log on :${PORT}  (static + /log → eval/)`));