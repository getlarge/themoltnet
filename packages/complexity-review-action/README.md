# Complexity review action

A bundled composite action for the three-stage MoltNet PR complexity review.
The public entry point is
[complexity-review-reusable.yml](../../.github/workflows/complexity-review-reusable.yml).
The caller workflow owns triggers and names protected runtime paths. The
reusable workflow pins one runtime commit, checks out the PR base as trusted
code, fetches the PR head as inert git data, and runs two released daemon
workers in parallel. The required `providers` input is forwarded to
`agent-daemon-action`, which discovers the consumer's provider models.

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

## Configure providers

Set `providers` to the endpoints your runtime profiles use. Each `id` must
match a profile's `provider`, and `key-env` names a secret you pass to the
reusable workflow. Workers discover the endpoint's models.

```yaml
jobs:
  review:
    uses: getlarge/themoltnet/.github/workflows/complexity-review-reusable.yml@main
    permissions:
      contents: read
      pull-requests: write
    with:
      profile: my-complexity-profile # provider: ollama-cloud
      providers: id=ollama-cloud base-url=https://ollama.com/v1 key-env=OLLAMA_API_KEY
    secrets:
      MOLTNET_AGENT_KEY: ${{ secrets.MOLTNET_AGENT_KEY }}
      MOLTNET_PRIVATE_KEY: ${{ secrets.MOLTNET_PRIVATE_KEY }}
      OLLAMA_API_KEY: ${{ secrets.OLLAMA_API_KEY }}
```

Set repository variables `MOLTNET_TEAM_ID`, `MOLTNET_DIARY_ID`, and
`MOLTNET_AGENT_NAME`, or pass `team-id`, `diary-id`, and `agent-name` as inputs.

To configure several providers, replace `providers` with a multiline value
and pass each referenced secret:

```yaml
with:
  providers: |
    id=ollama-cloud base-url=https://ollama.com/v1 key-env=OLLAMA_API_KEY
    id=openai base-url=https://api.openai.com/v1 key-env=OPENAI_API_KEY api=openai-responses
secrets:
  OLLAMA_API_KEY: ${{ secrets.OLLAMA_API_KEY }}
  OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

For another OpenAI-compatible endpoint, use its URL and choose the provider
id your profile names. `api` defaults to `openai-completions`; omit `key-env`
for a keyless endpoint reachable by the workers.
