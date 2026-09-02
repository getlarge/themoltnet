#!/bin/sh
# Notarize a signed moltnet-agent payload — runbook on #2063, "Step 3".
#
#   notarize.sh --payload DIR [--zip OUT.zip] [--dry-run]
#
# Requires an App Store Connect API key in the environment:
#   NOTARY_KEY_ID, NOTARY_ISSUER_ID, NOTARY_KEY (path to the .p8, or its contents)
#
# A bare tarball cannot be stapled; Gatekeeper verifies the ticket online on
# first run. Stapling applies to the future .pkg path only.
set -eu

payload=""; zip=""; dry_run=0
while [ $# -gt 0 ]; do
  case "$1" in
    --payload) payload=$2; shift 2 ;;
    --zip) zip=$2; shift 2 ;;
    --dry-run) dry_run=1; shift ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[ -n "$payload" ] || { echo "--payload is required" >&2; exit 2; }
[ -n "$zip" ] || zip="$payload.notarize.zip"

if [ "$dry_run" = 0 ]; then
  : "${NOTARY_KEY_ID:?}" "${NOTARY_ISSUER_ID:?}" "${NOTARY_KEY:?}"
fi

work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
if [ -f "${NOTARY_KEY:-}" ]; then key_path="$NOTARY_KEY"
else key_path="$work/AuthKey.p8"; printf '%s' "${NOTARY_KEY:-}" > "$key_path"; fi

echo "ditto -c -k --keepParent $payload $zip"
[ "$dry_run" = 1 ] || ditto -c -k --keepParent "$payload" "$zip"

# Uploading ~100 MB and Apple's scan routinely take 10-20 minutes; bound
# the wait so a stuck submission fails the job instead of hanging it.
echo "xcrun notarytool submit $zip --key <p8> --key-id <key-id> --issuer <issuer> --wait --timeout 45m"
[ "$dry_run" = 1 ] || xcrun notarytool submit "$zip" \
  --key "$key_path" --key-id "$NOTARY_KEY_ID" --issuer "$NOTARY_ISSUER_ID" --wait --timeout 45m

# spctl assesses app bundles and rejects raw executables as "not an app" even
# when their notarization ticket is valid. For non-app code, require the ticket
# directly through codesign (Apple DTS, "Testing a Notarised Product").
runtime=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).runtime)' "$payload/manifest.json")
echo "codesign -vvvv -R=notarized --check-notarization $payload/$runtime"
[ "$dry_run" = 1 ] || codesign -vvvv -R="notarized" --check-notarization "$payload/$runtime"
