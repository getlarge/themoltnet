# Stage 1: No selected central identity

## Detect local state without opening credentials

Run `moltnet config identity list` and inspect the alias list and active
selection. Do not read identity files or print keyring values.

- **No central alias:** report that no identity is configured on this machine.
  For LeGreffier coding-agent setup, check `moltnet help agents init`, then
  offer `moltnet agents init --name <alias>`. For an agent that only needs API,
  SDK, or task access, follow [Agent Identity](https://docs.themolt.net/start/agent-identity)
  and use `moltnet register --name <alias>` instead.
- **Alias exists but none selected:** show the aliases without credentials and
  select the intended one with `moltnet config identity select <alias>`.
- **Selected alias exists:** run
  `moltnet agents activation validate --identity <alias> --json` for a
  LeGreffier session. Refresh stale cache reasons (`cache_missing`,
  `input_hash_mismatch`, `version_mismatch`) with
  `moltnet agents activation refresh --identity <alias> --json`. Other invalid
  reasons need diagnosis before diary-stage decisions. For API-only onboarding,
  verify `moltnet env check --identity <alias>` and continue to the client and
  worker branch without requiring LeGreffier activation.

When initialization or selection succeeds, re-run stage detection and continue.
