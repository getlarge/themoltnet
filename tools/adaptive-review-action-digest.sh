#!/usr/bin/env bash
# Digest of the built adaptive review action, so jobs that download the
# bundle from prepare run exactly the files prepare built.
#   adaptive-review-action-digest.sh <dist>              prints digest=<sha256>
#   adaptive-review-action-digest.sh --verify <sha> <dist>
set -euo pipefail

if command -v sha256sum >/dev/null; then SHA256=(sha256sum); else SHA256=(shasum -a 256); fi

# Hash every file with its relative path, then hash that list, so content,
# names and the file set all count.
combined() {
  [ -d "$1" ] || { echo "::error::review action bundle $1 is missing" >&2; return 1; }
  (cd "$1" && find . -type f -print0 | LC_ALL=C sort -z | xargs -0 "${SHA256[@]}") \
    | "${SHA256[@]}" | cut -d' ' -f1
}

if [ "${1:-}" = --verify ]; then
  expected="${2:-}"
  if ! [[ "$expected" =~ ^[0-9a-f]{64}$ ]]; then
    echo '::error::expected review action digest is not a SHA-256' >&2
    exit 1
  fi
  actual="$(combined "${3:?bundle path required}")"
  if [ "$actual" != "$expected" ]; then
    echo "::error::review action bundle digest $actual does not match prepare ($expected)" >&2
    exit 1
  fi
  exit 0
fi
echo "digest=$(combined "${1:?bundle path required}")"
