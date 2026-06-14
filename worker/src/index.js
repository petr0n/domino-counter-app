// Domino Counter — credential proxy (Cloudflare Worker)
//
// Holds the Anthropic API key and a GitHub token as Worker *secrets* so they
// never ship to the browser. The static app calls this Worker; the Worker adds
// the auth headers server-side and forwards to the real APIs.
//
// Deploy:  cd worker && npx wrangler deploy
// Secrets: npx wrangler secret put ANTHROPIC_API_KEY
//          npx wrangler secret put GITHUB_TOKEN

// Only this origin may use the proxy (keeps it from being an open relay).
const ALLOWED_ORIGIN = "https://petr0n.github.io";

// GitHub calls are restricted to sessions/ and catalog.json in the app repo only.
const GH_SESSION_PREFIX = "repos/petr0n/domino-counter-app/contents/sessions/";
const GH_CATALOG        = "repos/petr0n/domino-counter-app/contents/catalog.json";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders();

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    // Origin gate: browsers always send Origin on cross-site requests.
    const origin = request.headers.get("Origin");
    if (origin && origin !== ALLOWED_ORIGIN) {
      return new Response("Forbidden origin", { status: 403, headers: cors });
    }

    const path = new URL(request.url).pathname.replace(/^\/+/, "");

    try {
      // ── Anthropic Messages ──────────────────────────────────────────────
      if (path === "anthropic" && request.method === "POST") {
        const upstream = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": env.ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
          },
          body: await request.text(),
        });
        return new Response(await upstream.text(), {
          status: upstream.status,
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }

      // ── GitHub Contents (sessions + catalog only) ───────────────────────
      if (path.startsWith("github/")) {
        const ghPath = path.slice("github/".length);
        if (!ghPath.startsWith(GH_SESSION_PREFIX) && ghPath !== GH_CATALOG) {
          return new Response("Path not allowed", { status: 403, headers: cors });
        }
        const headers = {
          Authorization: `token ${env.GITHUB_TOKEN}`,
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "domino-counter-proxy",
        };
        const init = { method: request.method, headers };
        if (request.method === "PUT") {
          headers["Content-Type"] = "application/json";
          init.body = await request.text();
        }
        const upstream = await fetch(`https://api.github.com/${ghPath}`, init);
        return new Response(await upstream.text(), {
          status: upstream.status,
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }

      return new Response("Not found", { status: 404, headers: cors });
    } catch (err) {
      return new Response(JSON.stringify({ error: String(err) }), {
        status: 502,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }
  },
};
