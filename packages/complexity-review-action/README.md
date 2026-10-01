# Complexity review action

A bundled composite action for the three-stage MoltNet PR complexity review.
The public entry point is
[complexity-review-reusable.yml](../../.github/workflows/complexity-review-reusable.yml).
The caller workflow owns triggers and names protected runtime paths. The
reusable workflow pins one runtime commit, checks out the PR base as trusted
code, fetches the PR head as inert git data, and runs two released daemon
workers in parallel. The required `providers` input is forwarded to
`agent-daemon-action`, which discovers the consumer's provider models.
Repository Pi configuration is not used.

The action has `prepare` and `review` steps. `prepare` collects PR facts,
reads `.github/complexity-review.json` at the PR base, checks protected paths,
and emits one versioned JSON payload. `review` runs the bundled library and
posts a head-aware comment through the configured GitHub App. The repository
config selects the rubric file; the default is
`rubrics/pr-complexity-binary-v1.json` when the config is absent.

The action bundles are committed under `dist/`, and `runtime.lock` hashes the
reusable workflow and worker action it runs. Build with
`pnpm exec nx run @themoltnet/complexity-review-action:build` and refresh the
lock after staging changed runtime files with
`node tools/src/release/action-runtime-lock.ts --write`.

The portable [profile](./setup/complexity-review-profile.json) and
[input-only policy](./setup/complexity-review-input-only-policy.json) are
shipped with the action. Bind the policy separately after creating the profile;
the profile API does not accept a `policies` field. The repository copies under
`.github/runtime-profiles` and `.github/runtime-policies` configure MoltNet
itself.
