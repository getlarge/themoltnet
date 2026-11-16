#!/bin/sh
set -eu
umask 077
case "${1:-}" in
  init)
    # Refuse to repair partial or established state by generating new keys.
    if [ -n "$(ls -A /var/lib/talos)" ]; then
      echo 'Talos initialization requires an empty volume; restore complete state instead' >&2
      exit 1
    fi
    # Atomic lock prevents concurrent explicit initialization from replacing keys.
    mkdir /var/lib/talos/.initialize-lock
    trap 'rmdir /var/lib/talos/.initialize-lock' EXIT
    talos jwk generate eddsa --jwks --kid moltnet -o /var/lib/talos/jwks.json
    head -c 32 /dev/urandom | base64 > /var/lib/talos/hmac-secret
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
