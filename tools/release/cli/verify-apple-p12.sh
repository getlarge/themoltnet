#!/bin/sh
# Verify that APPLE_CERT_P12 contains the complete Developer ID chain Quill
# needs to produce a valid macOS designated requirement.

set -eu

usage() {
  echo "usage: verify-apple-p12.sh --p12 FILE" >&2
  exit 2
}

p12=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --p12)
      [ "$#" -ge 2 ] || usage
      p12=$2
      shift 2
      ;;
    *) usage ;;
  esac
done

[ -n "$p12" ] || usage
[ -f "$p12" ] || { echo "P12 file not found: $p12" >&2; exit 1; }
[ -n "${APPLE_CERT_PASSWORD:-}" ] || {
  echo "APPLE_CERT_PASSWORD is required to verify the P12" >&2
  exit 1
}

work=$(mktemp -d "${TMPDIR:-/tmp}/moltnet-p12-check.XXXXXX")
cleanup() {
  rm -f "$work/bundle.pem" "$work/cert-1.pem" "$work/cert-2.pem" "$work/cert-3.pem"
  rmdir "$work"
}
trap cleanup EXIT HUP INT TERM

if ! openssl pkcs12 -legacy -in "$p12" -passin env:APPLE_CERT_PASSWORD \
  -nokeys -out "$work/bundle.pem" 2>/dev/null; then
  echo "APPLE_CERT_P12 could not be decoded; check the P12 and password" >&2
  exit 1
fi

cert_count=$(awk '/^-----BEGIN CERTIFICATE-----$/ { count++ } END { print count + 0 }' "$work/bundle.pem")
if [ "$cert_count" -ne 3 ]; then
  echo "APPLE_CERT_P12 must contain exactly 3 certificates (Developer ID leaf + G2 intermediate + Apple root); found $cert_count" >&2
  exit 1
fi

awk -v dir="$work" '
  /^-----BEGIN CERTIFICATE-----$/ { count++; file = dir "/cert-" count ".pem" }
  file != "" { print > file }
  /^-----END CERTIFICATE-----$/ { close(file); file = "" }
' "$work/bundle.pem"

leaf=
intermediate=
root=
for cert in "$work"/cert-*.pem; do
  subject=$(openssl x509 -in "$cert" -noout -subject -nameopt RFC2253)
  case "$subject" in
    *"CN=Developer ID Application:"*) leaf=$cert ;;
    *"CN=Developer ID Certification Authority"*) intermediate=$cert ;;
    *"CN=Apple Root CA"*) root=$cert ;;
  esac
done

[ -n "$leaf" ] || { echo "APPLE_CERT_P12 has no Developer ID Application leaf certificate" >&2; exit 1; }
[ -n "$intermediate" ] || { echo "APPLE_CERT_P12 has no Developer ID Certification Authority intermediate" >&2; exit 1; }
[ -n "$root" ] || { echo "APPLE_CERT_P12 has no Apple Root CA certificate" >&2; exit 1; }

root_subject=$(openssl x509 -in "$root" -noout -subject -nameopt RFC2253 | sed 's/^subject=//')
root_issuer=$(openssl x509 -in "$root" -noout -issuer -nameopt RFC2253 | sed 's/^issuer=//')
if [ "$root_subject" != "$root_issuer" ]; then
  echo "APPLE_CERT_P12 Apple root certificate is not self-signed" >&2
  exit 1
fi

# Developer ID certificates contain Apple-specific critical extensions that
# generic OpenSSL does not interpret. Quill ignores those known extensions;
# -ignore_critical lets OpenSSL validate the cryptographic chain itself.
if ! openssl verify -ignore_critical -purpose any -CAfile "$root" -untrusted "$intermediate" "$leaf" >/dev/null 2>&1; then
  echo "APPLE_CERT_P12 does not contain a valid Developer ID leaf-to-root chain" >&2
  exit 1
fi

echo "APPLE_CERT_P12 contains a valid 3-certificate Developer ID chain"
