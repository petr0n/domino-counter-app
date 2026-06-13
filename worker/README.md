# Domino Counter — credential proxy

A tiny Cloudflare Worker that holds the Anthropic API key and a GitHub token so
they never reach the browser. The static app (`../quick.html`, `../scan.html`)
calls this Worker; the Worker injects the auth headers and forwards to the real
APIs.

## One-time deploy

You need a free [Cloudflare account](https://dash.cloudflare.com/sign-up).

```bash
cd worker
npx wrangler login        # opens browser to authorize
npx wrangler deploy       # prints your Worker URL, e.g.
                          # https://domino-counter-proxy.<you>.workers.dev
```

## Add the secrets

```bash
npx wrangler secret put ANTHROPIC_API_KEY   # paste a FRESH key (rotate the old one!)
npx wrangler secret put GITHUB_TOKEN        # fine-grained token, Contents:read+write on japan-2026
```

## Point the app at it

Edit `../config.js` and set `PROXY_URL` to the Worker URL from `wrangler deploy`
(no trailing slash). Commit and push — that's the only client-side change.

## What it allows

- `POST /anthropic` → Anthropic Messages API (tile scanning)
- `GET|PUT /github/repos/petr0n/japan-2026/contents/domino-counter/...` → game
  sessions + catalog only

Requests are restricted to the `https://petr0n.github.io` origin and, for
GitHub, to the `domino-counter/` path prefix — so a leaked Worker URL can't be
used as an open relay for either key.
