#!/usr/bin/env bash
# Called only after the trusted review artifact has passed its digest check.
set -euo pipefail
runtime_checkout="${1:?trusted runtime checkout required}"
if ! [[ "${DAEMON_VERSION:-}" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
  echo '::error::Diary review requires an exact released daemon-version' >&2
  exit 1
fi
node --input-type=module -e '
const ids = JSON.parse(process.env.ADAPTIVE_REVIEW_DIARY_IDS || "[]");
if (!Array.isArray(ids) || ids.length < 1 || ids.length > 8 || ids.some(id => typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))) {
  throw new Error("focused-diary-ids must contain 1–8 UUIDs");
}
'
runtime_dir="$(mktemp -d "$RUNNER_TEMP/adaptive-review-diary-XXXXXX")"
printf '{"private":true,"type":"module"}\n' > "$runtime_dir/package.json"
pi_version="$(node -p 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).version' "$runtime_checkout/libs/pi-runtime/package.json")"
if ! [[ "$pi_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
  echo '::error::Runtime checkout must declare an exact pi-runtime version' >&2
  exit 1
fi
npm install --prefix "$runtime_dir" --ignore-scripts --no-audit --no-fund --save-exact \
  "@themoltnet/agent-daemon@$DAEMON_VERSION" "@themoltnet/pi-runtime@$pi_version"
cp -R "$runtime_checkout/packages/adaptive-review-action/dist/." "$runtime_dir/"
mkdir -p "$runtime_checkout/packages/agent-daemon-action/dist"
cp -R "$runtime_dir/worker-action/." "$runtime_checkout/packages/agent-daemon-action/dist/"
# Check the released adapter exports and module dependencies before claiming work.
node --input-type=module -e 'await import(process.argv[1])' "$runtime_dir/diary-runtime.js"
echo "module=$runtime_dir/diary-runtime.js" >> "$GITHUB_OUTPUT"
