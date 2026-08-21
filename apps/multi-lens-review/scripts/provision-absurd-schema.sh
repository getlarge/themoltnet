#!/usr/bin/env bash

set -euo pipefail

readonly target_version='0.4.0'

run_absurdctl() {
  uvx --from "absurdctl==${target_version}" absurdctl "$@"
}

current_version="$(run_absurdctl schema-version)"

case "$current_version" in
  unknown)
    run_absurdctl init --ref "$target_version"
    ;;
  "$target_version")
    ;;
  *)
    run_absurdctl migrate --from "$current_version" --to "$target_version"
    ;;
esac

final_version="$(run_absurdctl schema-version)"
if [[ "$final_version" != "$target_version" ]]; then
  echo "::error::Expected Absurd schema ${target_version}, found ${final_version}" >&2
  exit 1
fi

printf 'Absurd schema ready at %s\n' "$final_version"
