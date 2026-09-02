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
#   - gondolin-krun-runner is verified against a fail-closed allowlist
#     (hypervisor, plus the ad-hoc library-validation opt-out) and then
#     re-signed with a freshly AUTHORED plist of exactly those entitlements
#     — whatever the package shipped is never copied through;
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
      # Entitlement allowlist: the runner needs exactly the hypervisor
      # entitlement (plus our ad-hoc library-validation opt-out). We verify
      # the binary's current set is WITHIN the allowlist — so dependency
      # drift or compromise fails signing loudly — then apply a freshly
      # authored plist containing exactly the allowlisted entitlements,
      # never whatever the package happened to carry.
      current=$(codesign -d --entitlements - --xml "$file" 2>/dev/null \
        | grep -oE '<key>[^<]+</key>' | sed 's/<[^>]*>//g' || true)
      for ent in $current; do
        case "$ent" in
          com.apple.security.hypervisor) ;;
          com.apple.security.cs.disable-library-validation) ;;
          *)
            echo "refusing to sign gondolin-krun-runner: entitlement outside the allowlist: $ent" >&2
            exit 1
            ;;
        esac
      done
      cat > "$work/krun.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>com.apple.security.hypervisor</key><true/>
</dict></plist>
PLIST
      add_lib_validation_optout "$work/krun.plist"
      # shellcheck disable=SC2086
      codesign $common --entitlements "$work/krun.plist" -s "$identity" "$file"
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

# Inside-out: shared objects and addons first, then executables, runtime
# last. Plain for-loops on purpose: `exit` inside a `... | while` pipeline
# only leaves the subshell and the script would keep signing after a
# refusal. Native paths never contain whitespace (node_modules layout).
set -f
for p in $native_paths; do
  case "$p" in *.dylib|*.so|*.node) sign_one "$p" ;; esac
done
for p in $native_paths; do
  case "$p" in *.dylib|*.so|*.node) ;; "$runtime") ;; *) sign_one "$p" ;; esac
done
set +f
sign_one "$runtime"

if [ "$verify" = 1 ]; then
  failures=$work/verify-failures
  : > "$failures"
  set -f
  for p in $native_paths; do
    if out=$(codesign --verify --strict -v "$payload/$p" 2>&1); then
      printf '%s\n' "$out" | sed "s#^#verify  #"
    else
      printf '%s\n' "$out" | sed "s#^#verify  FAILED #" >&2
      echo "$p" >> "$failures"
    fi
  done
  set +f
  ents=$(codesign -d --entitlements - "$payload/$runtime" 2>/dev/null || true)
  echo "$ents" | grep -q "allow-jit" || { echo "runtime is missing allow-jit (V8 breaks)" >&2; echo "$runtime:jit" >> "$failures"; }
  echo "$ents" | grep -q "unsigned-executable-memory" || { echo "runtime is missing allow-unsigned-executable-memory" >&2; echo "$runtime:mem" >> "$failures"; }
  krun=$(echo "$native_paths" | grep 'gondolin-krun-runner$' | head -1 || true)
  if [ -n "$krun" ]; then
    codesign -d --entitlements - "$payload/$krun" 2>/dev/null | grep -q "hypervisor" \
      || { echo "krun runner is missing the hypervisor entitlement" >&2; echo "$krun:hv" >> "$failures"; }
  fi
  # Gatekeeper (spctl) is deliberately NOT checked here: before notarization
  # every Developer ID binary is "rejected"; notarize.sh asserts it after.
  if [ -s "$failures" ]; then
    echo "signature verification failed for:" >&2
    sed 's/^/  /' "$failures" >&2
    exit 1
  fi
  echo "verification passed for $(echo "$native_paths" | grep -c .) native files"
fi
