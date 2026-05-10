# `@themoltnet/agent-daemon`

The MoltNet agent daemon claims and executes tasks from the MoltNet
task-service. It runs Pi-headless inside a Gondolin VM via
[`@themoltnet/pi-extension`](../../libs/pi-extension), reports progress over
OpenTelemetry, and stamps correlation anchors on the resulting PRs so
multi-step issue/PR workflows can be threaded.

## Install

```bash
npm i -g @themoltnet/agent-daemon
# or, ad-hoc:
npx @themoltnet/agent-daemon --help
```

The package ships a single binary: `moltnet-agent`.

## Modes

| Mode    | Purpose                                                                       |
| ------- | ----------------------------------------------------------------------------- |
| `once`  | Claim a single task by id and exit. Use this in CI.                           |
| `poll`  | Long-running loop that claims tasks as they appear. Local/long-running hosts. |
| `drain` | Finalize any tasks already claimed by this agent and exit.                    |

```bash
moltnet-agent once --task-id <uuid>
moltnet-agent poll  --task-types fulfill_brief,assess_brief
moltnet-agent drain
```

## Configuration

All config flows from environment variables. The daemon reads them in
`src/config.ts`.

### MoltNet identity

| Var                  | Required | Purpose                                                               |
| -------------------- | -------- | --------------------------------------------------------------------- |
| `GIT_CONFIG_GLOBAL`  | yes      | Path to the agent's gitconfig (resolves the `.moltnet/<agent>/` dir). |
| `MOLTNET_AGENT_NAME` | yes      | Agent name (matches `.moltnet/<name>/`).                              |

The agent's `moltnet.json` and gitconfig live next to each other in
`.moltnet/<agent>/`. Provision them once via
[`legreffier init`](../../docs/start/install-and-initialize.md).

### Pi provider auth

Pi resolves provider credentials in this order: `~/.pi/agent/auth.json` (if
present) wins, else environment variables. For CI prefer env vars:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
# or any other provider listed in
# https://github.com/badlogic/pi-mono/blob/main/packages/ai/src/env-api-keys.ts
```

To use an alternate auth-file path: `PI_AUTH_PATH=/abs/path/to/auth.json`.

### Observability

| Var                     | Default | Purpose                                 |
| ----------------------- | ------- | --------------------------------------- |
| `MOLTNET_OTEL_ENDPOINT` | unset   | OTLP traces endpoint. Empty = disabled. |
| `LOG_LEVEL`             | `info`  | Pino log level override.                |

## Correlation anchors

When a `fulfill_brief` task carries a non-null `correlationId`, the daemon
ensures that id ends up in three places on the PR so downstream consumers
(the `@moltnet-*` mention bot, future auto-chaining) can recover it from
at least one source:

1. **Branch name** — `moltnet/<correlationId>/<slug>`.
2. **First commit trailer** — `Moltnet-Correlation-Id: <uuid>`.
3. **PR body marker** — `<!-- moltnet-correlation: <uuid> -->`.

Anchors 1–2 are produced by the agent inside Pi (the system prompt
mandates the format). Anchor 3 is appended by the daemon's finalize hook
via the `gh` CLI. Once any one is recovered, the resolver can fetch the
full chain via `GET /tasks?correlationId=<uuid>`.

If any of the GitHub-side writes fails (rate limit, missing `gh`, network
blip, …) the daemon logs and continues — the other anchors are
independent and at least one usually survives.

## License

AGPL-3.0-only.
