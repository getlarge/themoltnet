#!/usr/bin/env bash
# One package list for native tests, PR packages, and signed Linux releases.
# The list lives in linux-build-dependencies.txt so the cached CI install in
# .github/actions/setup-workspace reads the same source.
# Extra arguments (for example --cache-dir DIR) are passed to apt-install.sh.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
mapfile -t packages < <(grep -vE '^\s*(#|$)' "$here/linux-build-dependencies.txt")
exec "$here/../../ci/apt-install.sh" "$@" "${packages[@]}"
