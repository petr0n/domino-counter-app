// Dev-only capture hook for quick.html. Injected at serve time by log-server.cjs.
// Never referenced by committed HTML; absent in production => window.__domCapture undefined => app no-op.
(function () {
  window.__domCapture = function (payload) {
    var tiles = (payload.tiles || []).map(function (t) {
      return { left: t.left, right: t.right, dataUrl: t.dataUrl || null };
    });
    fetch("/log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        file: payload.file || null,
        tileCount: tiles.length,
        frame: payload.frame || null,
        tiles: tiles
      })
    }).catch(function () {});
  };
})();