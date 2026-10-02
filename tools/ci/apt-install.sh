#!/usr/bin/env bash
# Install apt packages, optionally through a cached apt state directory.
#
# Usage: apt-install.sh [--cache-dir DIR] PACKAGE...
#
# Without --cache-dir this is a plain `apt-get update && apt-get install` with
# retries and timeouts. With --cache-dir, DIR holds both the package index
# (DIR/lists) and the downloaded archives (DIR/archives):
#   1. packages already installed on the runner image are skipped;
#   2. if DIR was restored by actions/cache, apt installs by package name
#      against the cached index and archives with --no-download, so the
#      mirror is never contacted and apt still resolves and orders the set;
#   3. otherwise, or if the offline install fails, it refreshes the index
#      into DIR/lists, installs from the network, and keeps every archive in
#      DIR/archives for the caller's cache step to save.
# The cache key must include the runner image version: the cached index and
# archives only match the base packages of the image they were taken on.
set -euo pipefail

cache_dir=''
if [ "${1:-}" = '--cache-dir' ]; then
  cache_dir=$2
  shift 2
fi
[ "$#" -gt 0 ] || { echo 'apt-install.sh: no packages given' >&2; exit 2; }

apt_opts=(-o Acquire::Retries=5 -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30)

missing_packages() {
  local pkg
  for pkg in "$@"; do
    if ! dpkg-query -W -f='${Status}' "$pkg" 2>/dev/null | grep -q 'install ok installed'; then
      printf '%s\n' "$pkg"
    fi
  done
}

mapfile -t missing < <(missing_packages "$@")
if [ "${#missing[@]}" -eq 0 ]; then
  echo "apt-install: all $# packages already installed"
  exit 0
fi

if [ -z "$cache_dir" ]; then
  sudo apt-get update "${apt_opts[@]}"
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y "${apt_opts[@]}" "${missing[@]}"
  exit 0
fi

lists="$cache_dir/lists"
archives="$cache_dir/archives"
sudo mkdir -p "$lists/partial" "$archives/partial"
cache_opts=(-o Dir::State::Lists="$lists" -o Dir::Cache::Archives="$archives")

release_cache() {
  # apt writes these as root; hand them back so the cache step can save them.
  sudo rm -rf "$lists/partial" "$lists/lock" "$archives/partial" "$archives/lock"
  sudo chown -R "$(id -u):$(id -g)" "$cache_dir"
}

if compgen -G "$lists/*_Packages*" >/dev/null && compgen -G "$archives/*.deb" >/dev/null; then
  echo "apt-install: installing ${missing[*]} offline from the cached index"
  if sudo DEBIAN_FRONTEND=noninteractive apt-get install -y --no-download \
    "${apt_opts[@]}" "${cache_opts[@]}" "${missing[@]}"; then
    release_cache
    exit 0
  fi
  echo 'apt-install: offline install failed; refreshing from the network'
fi

sudo apt-get update "${apt_opts[@]}" "${cache_opts[@]}"
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y "${apt_opts[@]}" "${cache_opts[@]}" \
  -o APT::Keep-Downloaded-Packages=true "${missing[@]}"
release_cache
