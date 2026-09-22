#!/usr/bin/env bash
# Materialize the exact published Agent Daemon selected for a Desktop release.
set -euo pipefail

version=${1:?usage: materialize-published-agent.sh VERSION [DESTINATION]}
destination=${2:-dist/agent-bundle/moltnet-agent-linux-x64}
work=$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/moltnet-published-agent.XXXXXX")
trap 'rm -rf "$work"' EXIT

gh release download "agent-daemon-v$version" \
  --repo "${GITHUB_REPOSITORY:-getlarge/themoltnet}" \
  --pattern install.sh \
  --dir "$work"

MOLTNET_AGENT_VERSION="$version" \
MOLTNET_AGENT_HOME="$work/install" \
MOLTNET_AGENT_BIN_DIR="$work/bin" \
  sh "$work/install.sh"

payload="$work/install/$version"
test -x "$payload/bin/moltnet-agent"
node - "$payload/manifest.json" "$version" <<'NODE'
const fs = require('node:fs');
const [manifestPath, version] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (manifest.version !== version) {
  throw new Error(
    `published Agent Daemon is ${manifest.version}; expected ${version}`,
  );
}
if (manifest.platform !== 'linux-x64') {
  throw new Error(
    `published Agent Daemon is for ${manifest.platform}; expected linux-x64`,
  );
}
NODE

if [ -e "$destination" ]; then
  echo "refusing to replace existing Agent Daemon payload: $destination" >&2
  exit 1
fi
mkdir -p "$(dirname "$destination")"
cp -a "$payload" "$destination"
