#!/bin/sh
# Print the path of an OpenSSL 3+ binary for the Apple signing checks.
#
# Which OpenSSL comes first on PATH differs between macOS runner instances
# (some resolve OpenSSL 1.1.1) and developer machines (macOS ships LibreSSL),
# and those builds handle `pkcs12 -legacy`, `-ignore_critical` and the
# `-trusted`/`-untrusted` chain differently. Resolve one OpenSSL 3+ build so
# the verifier and its tests always agree.
#
# Order: $OPENSSL (must be 3+, never silently replaced), Homebrew openssl@3,
# then `openssl` on PATH.
set -eu

is_openssl3() {
  case "$("$1" version 2>/dev/null || true)" in
    "OpenSSL "[3-9].*) return 0 ;;
    *) return 1 ;;
  esac
}

if [ -n "${OPENSSL:-}" ]; then
  if is_openssl3 "$OPENSSL"; then
    printf '%s\n' "$OPENSSL"
    exit 0
  fi
  echo "OPENSSL=$OPENSSL is not OpenSSL 3+ ($("$OPENSSL" version 2>&1 || true))" >&2
  exit 1
fi

for candidate in \
  /opt/homebrew/opt/openssl@3/bin/openssl \
  /usr/local/opt/openssl@3/bin/openssl \
  "$(command -v openssl 2>/dev/null || true)"; do
  if [ -n "$candidate" ] && [ -x "$candidate" ] && is_openssl3 "$candidate"; then
    printf '%s\n' "$candidate"
    exit 0
  fi
done

echo "No OpenSSL 3+ found. Set OPENSSL to an OpenSSL 3 binary (macOS: brew install openssl@3). PATH openssl: $(openssl version 2>&1 || echo none)" >&2
exit 1
