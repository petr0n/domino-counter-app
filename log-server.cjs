// Local dev tool — log server for quick.html scan results.
// Run alongside the static file server: node log-server.cjs
// Writes to eval/scan-log.json. Not shipped — dev only.
const http = require('http');
const fs   = require('fs');
const path = require('path');
const LOG  = path.join(__dirname, 'eval', 'scan-log.json');

http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }
  if (req.method === 'POST' && req.url === '/log') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body);
        const slug = (parsed.file||'camera').replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_');
        const ts   = Date.now();
        (parsed.tiles||[]).forEach((t, i) => {
          if (!t.dataUrl) return;
          const b64 = t.dataUrl.replace(/^data:image\/\w+;base64,/, '');
          fs.writeFileSync(path.join(__dirname, 'eval', `crop_${slug}_t${i}_${t.left}-${t.right}.jpg`), Buffer.from(b64, 'base64'));
        });
        const entry = { ts: new Date().toISOString(), ...parsed, tiles: (parsed.tiles||[]).map(({dataUrl,...t})=>t) };
        const log = fs.existsSync(LOG) ? JSON.parse(fs.readFileSync(LOG, 'utf8')) : [];
        log.push(entry);
        fs.writeFileSync(LOG, JSON.stringify(log, null, 2));
        console.log('[log]', entry.ts, entry.file||'(camera)', entry.tileCount, 'tile(s):', (entry.tiles||[]).map(t=>t.left+'|'+t.right).join('  '));
        res.writeHead(200); res.end('ok');
      } catch(e) { res.writeHead(400); res.end(e.message); }
    });
  } else { res.writeHead(404); res.end(); }
}).listen(8766, () => console.log('Log server listening on :8766 → eval/scan-log.json'));
