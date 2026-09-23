#!/usr/bin/env bash
# Stage the exact signed linux-x64 Agent Daemon a Desktop release pins, and
# verify it through the same installer users run (publisher signature,
# checksum, launcher self-check) plus the pinned version.
#
#   stage-agent.sh <version> <output-dir> [source-dir]
#
# source-dir holds the tarball, .sha256 and .sha256.sig signed earlier in the
# same workflow run. Without it, the files are downloaded from the published
# agent-daemon release. Only the verified tarball is written to output-dir.
set -euo pipefail

version=${1:?usage: stage-agent.sh <version> <output-dir> [source-dir]}
output=${2:?usage: stage-agent.sh <version> <output-dir> [source-dir]}
source_dir=${3:-}
tools=$(cd "$(dirname "$0")/.." && pwd)
signer_root=${RELEASE_SIGNER_ROOT:-$(cd "$tools/../.." && pwd)}
name=moltnet-agent-linux-x64.tar.gz
files=("$name" "$name.sha256" "$name.sha256.sig")

[[ "$version" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] || {
  echo "Agent Daemon version is not canonical: $version" >&2
  exit 1
}
work=$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/moltnet-desktop-agent.XXXXXX")
trap 'rm -rf "$work"' EXIT

if [ -n "$source_dir" ]; then
  for file in "${files[@]}"; do cp "$source_dir/$file" "$work/$file"; done
else
  base="https://github.com/${GITHUB_REPOSITORY:-getlarge/themoltnet}/releases/download/agent-daemon-v$version"
  for file in "${files[@]}"; do
    curl -fsSL --retry 5 --retry-all-errors --connect-timeout 15 --max-time 600 \
      -o "$work/$file" "$base/$file"
  done
fi

pubkey=$(bash "$tools/release-signer-pubkey.sh" "$signer_root" | cut -d' ' -f1-2)
sed -e "s#^RELEASE_SIGNER_PUBKEY=\"\"#RELEASE_SIGNER_PUBKEY=\"$pubkey\"#" \
  "$tools/agent-bundle/install.sh" > "$work/install.sh"
grep -q '^RELEASE_SIGNER_PUBKEY="ssh-' "$work/install.sh"

MOLTNET_AGENT_ARCHIVE="$work/$name" \
MOLTNET_AGENT_HOME="$work/home" \
MOLTNET_AGENT_BIN_DIR="$work/bin" \
  sh "$work/install.sh"

# A local archive names its own version, so bind it to the pin here.
node - "$work/home/current/manifest.json" "$version" <<'NODE'
const fs = require('node:fs');
const [path, version] = process.argv.slice(2);
const { version: actual, platform } = JSON.parse(fs.readFileSync(path, 'utf8'));
if (actual !== version || platform !== 'linux-x64') {
  throw new Error(
    `Agent Daemon payload is ${actual} (${platform}); expected ${version} (linux-x64)`,
  );
}
NODE

mkdir -p "$output"
cp "$work/$name" "$output/$name"
echo "staged verified Agent Daemon $version"
