#!/bin/sh
# Sign every native file in a moltnet-agent payload, inside-out, with the
# hardened runtime — runbook on #2063, "Step 2 — sign".
#
#   sign.sh --payload DIR (--identity "Developer ID Application: …" | --adhoc) [--verify]
#
# --adhoc signs with the ad-hoc identity ("-") so the flow can be exercised
# on any machine; Gatekeeper/notarization need the Developer ID identity.
#
# Entitlements:
#   - libexec/moltnet-agent (the Node runtime) keeps the JIT pair V8 needs;
#   - gondolin-krun-runner keeps whatever it already carries (hypervisor):
#     we extract and re-apply, never author, its entitlements;
#   - dylibs / .node addons / other executables get none.
set -eu

payload=""
identity=""
verify=0
while [ $# -gt 0 ]; do
  case "$1" in
    --payload) payload=$2; shift 2 ;;
    --identity) identity=$2; shift 2 ;;
    --adhoc) identity="-"; shift ;;
    --verify) verify=1; shift ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[ -n "$payload" ] || { echo "--payload is required" >&2; exit 2; }
[ -n "$identity" ] || { echo "--identity or --adhoc is required" >&2; exit 2; }
[ -f "$payload/manifest.json" ] || { echo "no manifest.json in $payload" >&2; exit 2; }
[ "$(uname -s)" = "Darwin" ] || { echo "sign.sh only runs on macOS" >&2; exit 2; }

if [ "$identity" = "-" ]; then
  # Timestamps require a real identity; hardened runtime is fine ad-hoc.
  common="--force --options runtime"
  # Hardened runtime enforces library validation: an executable may only
  # load dylibs/addons signed by the same Team ID. Ad-hoc signatures carry
  # none, so executables (node runtime, krun runner, qemu-img) need the
  # opt-out to load our ad-hoc dylibs/addons. A Developer ID build shares
  # one Team ID across every file and keeps validation ON.
  adhoc_lib_validation=1
else
  common="--force --timestamp --options runtime"
  adhoc_lib_validation=0
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

cat > "$work/node.plist" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>com.apple.security.cs.allow-jit</key><true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
</dict></plist>
EOF
cat > "$work/exec.plist" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
</dict></plist>
EOF
# Add the library-validation opt-out to an entitlements plist (ad-hoc only).
add_lib_validation_optout() {
  [ "$adhoc_lib_validation" = 1 ] || return 0
  /usr/libexec/PlistBuddy -c "Add :com.apple.security.cs.disable-library-validation bool true" "$1" >/dev/null 2>&1 || true
}
add_lib_validation_optout "$work/node.plist"
add_lib_validation_optout "$work/exec.plist"

# manifest.native[].path, one per line — no jq dependency on the runner.
native_paths=$(node -e '
  const m = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  console.log(m.native.map((f) => f.path).join("\n"));
' "$payload/manifest.json")

runtime=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).runtime)' "$payload/manifest.json")

sign_one() {
  file="$payload/$1"
  case "$1" in
    "$runtime")
      # shellcheck disable=SC2086
      codesign $common --identifier net.themolt.agent --entitlements "$work/node.plist" -s "$identity" "$file"
      ;;
    *gondolin-krun-runner)
      # Preserve the entitlements it ships with (hypervisor), whatever they are.
      if codesign -d --entitlements "$work/krun.plist" --xml "$file" 2>/dev/null && [ -s "$work/krun.plist" ]; then
        add_lib_validation_optout "$work/krun.plist"
        # shellcheck disable=SC2086
        codesign $common --entitlements "$work/krun.plist" -s "$identity" "$file"
      else
        # shellcheck disable=SC2086
        codesign $common --entitlements "$work/exec.plist" -s "$identity" "$file"
      fi
      ;;
    *.dylib|*.so|*.node)
      # shellcheck disable=SC2086
      codesign $common -s "$identity" "$file"
      ;;
    *)
      # Other executables (qemu-img): no entitlements in release; the
      # ad-hoc opt-out only.
      # shellcheck disable=SC2086
      codesign $common --entitlements "$work/exec.plist" -s "$identity" "$file"
      ;;
  esac
  echo "signed  $1"
}

# Inside-out: shared objects and addons first, then executables, runtime last.
echo "$native_paths" | grep -E '\.(dylib|so|node)$' | while IFS= read -r p; do [ -n "$p" ] && sign_one "$p"; done
echo "$native_paths" | grep -vE '\.(dylib|so|node)$' | grep -v "^$runtime$" | while IFS= read -r p; do [ -n "$p" ] && sign_one "$p"; done
sign_one "$runtime"

if [ "$verify" = 1 ]; then
  echo "$native_paths" | while IFS= read -r p; do
    [ -n "$p" ] || continue
    codesign --verify --strict -v "$payload/$p" 2>&1 | sed "s#^#verify  #"
  done
  echo "entitlements on $runtime:"
  codesign -d --entitlements - "$payload/$runtime" 2>/dev/null | grep -E "allow-jit|unsigned-executable-memory" || echo "  (none found — V8 JIT would break)" >&2
  krun=$(echo "$native_paths" | grep 'gondolin-krun-runner$' | head -1 || true)
  if [ -n "$krun" ]; then
    echo "entitlements on $krun:"
    codesign -d --entitlements - "$payload/$krun" 2>/dev/null | grep -E "hypervisor" || echo "  (hypervisor entitlement missing)" >&2
  fi
  if [ "$identity" != "-" ]; then
    spctl -a -vv -t execute "$payload/$runtime" 2>&1 | sed "s#^#spctl   #"
  fi
fi
