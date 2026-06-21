// Integration test for the unified dev server (../log-server.cjs).
// Spawns it and checks static serving, quick.html injection, and frame saving.
// Run: node eval/test_capture_server.cjs
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const EVAL = path.join(ROOT, 'eval');
const PORT = 8766;
let fails = 0;
const check = (n, c) => { console.log((c ? '✓ ' : '✗ ') + n); if (!c) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
function req(method, p, body) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method,
      headers: body ? { 'Content-Type': 'application/json' } : {} }, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

(async () => {
  fs.mkdirSync(path.join(EVAL, 'sessions'), { recursive: true });
  const srv = spawn('node', [path.join(ROOT, 'log-server.cjs')], { stdio: ['ignore', 'pipe', 'pipe'] });
  let serverErr = '';
  srv.stderr.on('data', d => serverErr += d);
  const ready = await new Promise(resolve => {
    srv.stdout.on('data', d => { if (/Dev server/.test(d.toString())) resolve(true); });
    srv.on('exit', () => resolve(false));
    setTimeout(() => resolve(false), 3000);
  });
  if (!ready) {
    const why = (serverErr.match(/Error:.*/) || [])[0] || 'failed to start; is :8766 already in use?';
    check('server bound :8766 cleanly — ' + why, false);
    srv.kill();
    console.log('\n1 FAIL'); process.exit(1);
  }
  try {
    const js = await req('GET', '/detect.js');
    check('serves detect.js (200 + DominoCV)', js.status === 200 && /DominoCV/.test(js.body));

    const qh = await req('GET', '/quick.html');
    check('injects dev-capture into quick.html', qh.status === 200 && qh.body.includes('/eval/dev-capture.js'));

    const dc = await req('GET', '/eval/dev-capture.js');
    check('serves dev-capture.js (200 + __domCapture)', dc.status === 200 && /__domCapture/.test(dc.body));

    const frame = 'data:image/jpeg;base64,' + Buffer.from('fake-frame-bytes').toString('base64');
    // Find the session dir created by the POST
    const beforeDirs = fs.readdirSync(path.join(ROOT, 'eval', 'sessions'));
    const lr = await req('POST', '/log', JSON.stringify({ file: 'test', tileCount: 2, frame, tiles: [{left:1,right:2},{left:3,right:4}] }));
    const afterDirs = fs.readdirSync(path.join(ROOT, 'eval', 'sessions'));
    const sessionDir = afterDirs.find(d => !beforeDirs.includes(d));
    const sessionPhotos = sessionDir ? fs.readdirSync(path.join(ROOT, 'eval', 'sessions', sessionDir, 'photos')) : [];
    check('POST /log ok (200)', lr.status === 200);
    check('creates session dir under eval/sessions/', !!sessionDir);
    check('saves a frame to session/photos/', sessionPhotos.length === 1);
  } catch (e) {
    check('test ran without error: ' + e.message, false);
  } finally {
    srv.kill();
  }
  console.log(fails ? `\n${fails} FAIL` : '\nALL PASS');
  process.exit(fails ? 1 : 0);
})();