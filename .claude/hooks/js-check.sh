#!/usr/bin/env bash
# Runs before Claude stops: syntax-checks changed JS/HTML files.
set -euo pipefail

changed=$(
  git diff --name-only HEAD 2>/dev/null
  git diff --cached --name-only 2>/dev/null
  git log --name-only --pretty=format: origin/main..HEAD 2>/dev/null
)

jsfiles=$(echo "$changed"  | grep -E '\.js$'   | sort -u || true)
htmlfiles=$(echo "$changed" | grep -E '\.html$' | sort -u || true)

errs=""

# Syntax-check plain .js files
while IFS= read -r f; do
  [[ -z "$f" || ! -f "$f" ]] && continue
  out=$(node --check "$f" 2>&1) || errs="$errs\n• $f: $(echo "$out" | head -1)"
done <<< "$jsfiles"

# Write a temp node script to avoid stdin conflict with the hook framework
tmpjs=$(mktemp /tmp/htmljscheck-XXXXXX.js)
cat > "$tmpjs" << 'NODEEOF'
const fs = require("fs");
const src = fs.readFileSync(process.argv[1], "utf8");
const re = /<script(?![^>]*type=["']module["'])[^>]*>([\s\S]*?)<\/script>/gi;
let m, i = 0, bad = [];
while ((m = re.exec(src)) !== null) {
  i++;
  try { new Function(m[1]); } catch (e) { bad.push("block " + i + ": " + e.message); }
}
if (bad.length) { process.stderr.write(bad.join("; ")); process.exitCode = 1; }
NODEEOF

# Syntax-check inline <script> blocks in HTML
while IFS= read -r f; do
  [[ -z "$f" || ! -f "$f" ]] && continue
  out=$(node "$tmpjs" "$f" 2>&1) || errs="$errs\n• $f inline JS: $out"
done <<< "$htmlfiles"

rm -f "$tmpjs"

nhtml=$(echo "$htmlfiles" | grep -c '[^[:space:]]' 2>/dev/null || echo 0)

# Warn if locked detection pipeline code was modified
locked_warn=""
if git diff origin/main..HEAD -- quick.html scan.html catalog.html 2>/dev/null | grep -qE '^\+.*(LOCKED|function preprocess|callClaude|findContours|adaptiveThreshold)'; then
  locked_warn=" ⚠️  LOCKED detection pipeline code was modified — confirm with user before pushing."
fi

if [[ -n "$errs" ]]; then
  printf '{"systemMessage":"JS errors found — fix before pushing:%s%s"}' "$errs" "$locked_warn"
elif [[ "$nhtml" -gt 0 ]]; then
  printf '{"systemMessage":"JS syntax OK. Double-check %s HTML file(s) with inline scripts before pushing.%s"}' "$nhtml" "$locked_warn"
elif [[ -n "$locked_warn" ]]; then
  printf '{"systemMessage":"%s"}' "${locked_warn# }"
fi
