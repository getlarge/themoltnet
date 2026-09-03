#!/bin/sh
# Verified direct CLI replacement. This script is rendered at release time with
# a fixed version and publisher key; it never discovers a target itself.
set -eu
REPO=getlarge/themoltnet
RELEASE_PINNED_VERSION=""
RELEASE_SIGNER_PUBKEY=""
PRINCIPAL=legreffier@themolt.net
TARGET=
[ "${1:-}" = "--replace" ] && TARGET=${2:-}
[ -n "$TARGET" ] || { echo 'error: pass --replace /absolute/path/to/moltnet' >&2; exit 2; }
case "$TARGET" in /*) ;; *) echo 'error: replacement target must be absolute' >&2; exit 2;; esac
[ -f "$TARGET" ] && [ -x "$TARGET" ] || { echo 'error: refusing to replace a non-executable target' >&2; exit 2; }
[ -n "$RELEASE_PINNED_VERSION" ] && [ -n "$RELEASE_SIGNER_PUBKEY" ] || { echo 'error: installer has no release trust anchor' >&2; exit 2; }
os=$(uname -s); arch=$(uname -m)
case "$os/$arch" in Darwin/arm64) name="moltnet_${RELEASE_PINNED_VERSION}_darwin_arm64.tar.gz";; Darwin/x86_64) name="moltnet_${RELEASE_PINNED_VERSION}_darwin_amd64.tar.gz";; Linux/x86_64|Linux/amd64) name="moltnet_${RELEASE_PINNED_VERSION}_linux_amd64.tar.gz";; Linux/aarch64|Linux/arm64) name="moltnet_${RELEASE_PINNED_VERSION}_linux_arm64.tar.gz";; *) echo "error: unsupported platform $os/$arch" >&2; exit 2;; esac
work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
base="https://github.com/$REPO/releases/download/cli-v$RELEASE_PINNED_VERSION"
curl -fsSL "$base/$name" -o "$work/archive"; curl -fsSL "$base/checksums.txt" -o "$work/checksums.txt"; curl -fsSL "$base/checksums.txt.sig" -o "$work/checksums.txt.sig"
printf '%s namespaces="moltnet-release" %s\n' "$PRINCIPAL" "$RELEASE_SIGNER_PUBKEY" > "$work/allowed_signers"
ssh-keygen -Y verify -f "$work/allowed_signers" -I "$PRINCIPAL" -n moltnet-release -s "$work/checksums.txt.sig" < "$work/checksums.txt" >/dev/null
expected=$(awk -v n="$name" '$2==n || $2=="*"n {print $1}' "$work/checksums.txt"); actual=$( (sha256sum "$work/archive" 2>/dev/null || shasum -a 256 "$work/archive") | awk '{print $1}')
[ -n "$expected" ] && [ "$expected" = "$actual" ] || { echo 'error: checksum mismatch' >&2; exit 1; }
tar -xzf "$work/archive" -C "$work"; candidate=$(find "$work" -type f -name moltnet -perm -u+x | head -1)
[ -n "$candidate" ] && "$candidate" version | grep -q "moltnet $RELEASE_PINNED_VERSION" || { echo 'error: archive product/version validation failed' >&2; exit 1; }
backup="$TARGET.moltnet-update-backup.$$"; mv "$TARGET" "$backup"
if mv "$candidate" "$TARGET" && "$TARGET" version | grep -q "moltnet $RELEASE_PINNED_VERSION"; then rm -f "$backup"; else mv -f "$backup" "$TARGET"; echo 'error: replacement failed; restored prior binary' >&2; exit 1; fi
