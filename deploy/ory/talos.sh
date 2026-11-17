#!/bin/sh
set -eu
umask 077
case "${1:-}" in
  init)
    # Lock before inspecting state. Only the lock owner can clean up staging.
    staging=/var/lib/talos/.initialize-lock
    mkdir "$staging" 2>/dev/null || {
      echo 'Talos initialization lock exists; ensure no initializer is running before recovery' >&2
      exit 1
    }
    trap 'rm -rf "$staging"' EXIT
    trap 'exit 130' INT
    trap 'exit 143' TERM
    if [ -n "$(find /var/lib/talos -mindepth 1 -maxdepth 1 ! -name .initialize-lock -print -quit)" ]; then
      echo 'Talos initialization requires an empty volume; restore complete state instead' >&2
      exit 1
    fi
    # Stage the complete pair before publication; a generation failure leaves
    # no live keys. Interrupted publication remains partial state and is refused.
    talos jwk generate eddsa --jwks --kid moltnet -o "$staging/jwks.json"
    head -c 32 /dev/urandom > "$staging/random"
    test "$(wc -c < "$staging/random")" -eq 32
    base64 < "$staging/random" > "$staging/hmac-secret"
    test -s "$staging/jwks.json" && test -s "$staging/hmac-secret"
    mv "$staging/jwks.json" "$staging/hmac-secret" /var/lib/talos/
    ;;
  migrate|serve)
    test -s /var/lib/talos/jwks.json && test -s /var/lib/talos/hmac-secret || {
      echo 'Talos key material missing; initialize a new volume or restore complete state' >&2
      exit 1
    }
    export SECRETS_HMAC_CURRENT="$(cat /var/lib/talos/hmac-secret)"
    export CREDENTIALS_DERIVED_TOKENS_JWT_SIGNING_KEYS_URLS_0="base64://$(base64 -w 0 /var/lib/talos/jwks.json)"
    if [ "$1" = migrate ]; then
      exec talos migrate up --config /etc/config/talos/talos.yaml
    fi
    test -s /var/lib/talos/talos.db || {
      echo 'Talos database missing; run the explicit migration job first' >&2
      exit 1
    }
    exec talos serve --config /etc/config/talos/talos.yaml
    ;;
  *) echo 'Expected init, migrate, or serve' >&2; exit 2 ;;
esac
