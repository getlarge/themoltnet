# Custom Pi runtime

This standalone package owns its Pi tools and Gondolin VM template. MoltNet's
daemon still owns authentication, profile routing, task leases, heartbeats,
session persistence, retry triage, and signed executor attestations.

This is an intentional pre-1.0 adapter boundary: custom runtimes return their
manifest and runtime inventory, while daemon core resolves and validates the
authenticated agent's signing key. Adapters neither receive a MoltNet config
directory nor construct or return an executor attestor.

The example stays outside the root pnpm workspace and carries its own lockfile.
Install the published dependencies and build the runtime module:

```bash
env npm_config_minimum_release_age_exclude='@themoltnet/*' \
  pnpm install --ignore-workspace --frozen-lockfile
pnpm build
```

The package is intentionally absent from the root Nx graph. A dedicated CI
workflow runs only when this example or its workflow changes. Reproduce that
check locally by running the frozen install, typecheck, unit tests, and build in
sequence from this directory:

```bash
env npm_config_minimum_release_age_exclude='@themoltnet/*' \
  pnpm install --ignore-workspace --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
```

## Version lockstep

`@themoltnet/pi-runtime`, `@earendil-works/pi-ai`, and
`@earendil-works/pi-coding-agent` are pinned to exact versions on purpose: they
must match the pins of the
`@themoltnet/agent-daemon` release that loads this module. Two copies of
`pi-coding-agent` resolve to two module instances at runtime, and
`apps/agent-daemon/src/runtime-loader.ts` validates the adapter structurally, so
a skewed pair loads successfully and then fails later with an unhelpful error.

Check the daemon's pins before bumping either dependency:

```bash
npm view @themoltnet/agent-daemon@<version> dependencies --json
```

Activate an agent, then load the module through the universal published daemon
CLI with a profile whose `runtimeKind` is `example_pi`:

```bash
pnpm start poll --agent <agent-name> --team <team-id> --profile <profile-id>
```

## Enforcing profile and policy

The profile must select this installed runtime explicitly and attest the host
tool inventory before claim:

```json
{
  "requiredEnv": [],
  "requiredExecutables": ["git", "node", "npm"],
  "requiredTools": ["github_issue_read"],
  "runtimeKind": "example_pi",
  "toolEnforcement": "enforce"
}
```

Bind an enforcing runtime policy whose optional capability set contains only
the fixed issue reader:

```json
{
  "name": "moltnet-public-issue-reader",
  "shellCommands": [],
  "tools": ["github_issue_read"]
}
```

Removing `github_issue_read` from the bound policy hides it from the model and
blocks a forged call without changing or reinstalling the runtime package. The
tool descriptor (including its closed integer schema) is fingerprinted in the
executor manifest, so changing the schema changes the descriptor CID and the
manifest evidence pinned at claim.

The logical `hello` tool remains available for experimentation when a policy
allows it. Snapshot setup and resume commands stay here in trusted runtime code;
they are not accepted from remote profiles.

## GitHub issue reader

`github_issue_read({ number })` runs on the daemon host and can read only
`getlarge/themoltnet`. The model cannot choose a URL, method, headers, owner,
repository, GraphQL document, or request body. The implementation rejects
redirects, uses a five-second deadline, caps the provider response at 256 KiB,
and truncates the projected issue body to 8 KiB. Failures expose only stable
categories; upstream bodies and headers are never returned.

Public unauthenticated GitHub access is the default. A production host may set
`MOLTNET_RUNTIME_GITHUB_TOKEN`. Use a dedicated least-privilege GitHub App or
service credential with read-only Issues permission. Do not use a human PAT,
an administrator token, or a broadly privileged installation token.

Never add `MOLTNET_RUNTIME_GITHUB_TOKEN` to `requiredEnv`: profile environment
names are forwarded into Gondolin. This example reads the variable directly in
the trusted host process, never places it in guest environment or files, never
passes it to `moltnet_host_exec`, and never includes it in tool results, errors,
or task evidence.

Each invocation persists a secret-free start and outcome record through the
active task reporter. Evidence contains the task and attempt, tool-call ID,
`issue.read`, the fixed repository, issue number, result category, and duration;
it contains no generic tool arguments or provider data.

## Guest-side HTTP credentials

Use a brokered HTTP secret when a normal Bash or provider CLI command should
run inside the VM but its bearer credential must remain on the daemon host.
Declare the value-free requirement in trusted runtime code:

```ts
import {
  definePiBrokeredHttpSecret,
  definePiRuntime,
} from '@themoltnet/pi-runtime';

const githubCliCredential = definePiBrokeredHttpSecret({
  id: 'github-api-read',
  guestEnv: 'GH_TOKEN',
  hosts: ['api.github.com'],
  required: false,
  resolve: () => process.env.MOLTNET_RUNTIME_GITHUB_TOKEN,
});

export const runtime = definePiRuntime({
  // id, version, runtimeKind, vm, and tools omitted here
  brokeredHttpSecrets: [githubCliCredential],
});
```

The descriptor is included in executor-manifest evidence; the resolver is not
called while the manifest is built. It runs on the trusted host for each task
attempt immediately before VM resume. The resolver context includes an
`AbortSignal`; resolution is bounded to 30 seconds by default and is cancelled
with the attempt. Resolver failures produce a stable, value-free diagnostic and
are classified separately from VM-resume failures.

When `MOLTNET_RUNTIME_GITHUB_TOKEN` is set on the daemon host, an authorized
guest command can use the ordinary CLI form:

```bash
gh api repos/getlarge/themoltnet/issues/1953 --jq .title
```

The VM sees only an opaque `GH_TOKEN` placeholder. Gondolin substitutes the
real value in the outbound header to `api.github.com`; using the placeholder
over plaintext HTTP, another port, or another hostname fails closed. The
omitted protocol and port default to HTTPS/443. Do not add `GH_TOKEN` or
`MOLTNET_RUNTIME_GITHUB_TOKEN` to the profile `requiredEnv` array. The runtime
policy must still authorize the exact `gh api` command family.

For production, resolve a short-lived, least-privilege installation token
rather than a human PAT or the GitHub App private key. HTTP brokering does not
provide Git commit signing or MoltNet diary signing; those operations require
separate host-side signing capabilities.

## Host capabilities

A runtime can serve operations from the trusted host without any MoltNet
change. Core handles transport (`https://<name>.moltnet.internal` answered by
the sandbox proxy in-process), schema validation, policy (`capability:<name>`
grants), evidence, manifest attestation and guest projection; the contribution
supplies the operations and what the guest needs. A GPG signer backed by a host
key, for example:

```ts
import { defineHostCapability } from '@themoltnet/agent-runtime';
import { Type } from 'typebox';

export const gpgSigning = defineHostCapability({
  name: 'gpg-signing',
  operations: {
    'sign-detached': {
      request: Type.Object(
        {
          data: Type.String({ maxLength: 65536 }),
          hashAlgo: Type.Literal('sha256'),
        },
        { additionalProperties: false },
      ),
      response: Type.Object({ signature: Type.String() }),
      handle: async (input) => ({ signature: await hostGpgSign(input.data) }),
      evidence: (input) => ({ length: input.data.length }),
    },
  },
  guest: {
    files: () => [
      {
        path: '/home/agent/.config/moltnet/gpg.gitconfig',
        content: '[gpg]\n\tprogram = moltnet-gpg-shim\n',
      },
    ],
    services: [{ id: 'gpg-shim', command: ['moltnet-gpg-shim', 'serve'] }],
  },
});

// definePiRuntime({ ..., hostCapabilities: [gpgSigning] })
```

`hostGpgSign` runs on the host with whatever key source the runtime chooses.
The guest shim translates `gpg --detach-sign` into
`moltnet capability call gpg-signing sign-detached`. Requires a
`@themoltnet/pi-runtime` release with `hostCapabilities` support (see the
version lockstep note above).

## Trust boundary

The daemon host and installed runtime package are trusted. The model, task
content, provider response, and Gondolin guest are untrusted. Under that threat
model the runtime may call GitHub directly, as this example does. An embedding
product may instead use its own SDK, host secret provider, remote MCP server, or
external gateway without changing MoltNet core.

Issue #1775's stronger gateway research becomes relevant when the daemon host
or runtime package cannot be trusted, or when centralized provider consent,
dynamic connections, revocation, and cross-host governance are required. This
example deliberately adds no connector schema, connector token, MoltNet proxy,
or credential vault.

## End-to-end manual smoke

This walkthrough exercises the published daemon, production task control plane,
runtime-profile enforcement, the host-owned GitHub tool, and persisted tool
evidence. It creates a real task and makes one billable model call. Use a team
where the activated agent can manage runtime profiles and policies.

The commands below run from `examples/custom-pi-runtime`. They assume an
activated agent in the repository root and a model provider already configured
for Pi. The successful reference run used `ollama-cloud` with
`kimi-k2.7-code:cloud`; choose a provider and model available to your agent if
those are not configured.

Set the non-secret identifiers first:

```bash
export AGENT_NAME=<agent-name>
export TEAM_ID=<team-id>
export DIARY_ID=<diary-id>
export REPO_ROOT=$(git rev-parse --show-toplevel)
export GIT_CONFIG_GLOBAL="$REPO_ROOT/.moltnet/$AGENT_NAME/gitconfig"
```

Keep model-provider credentials in their normal host-side credential store or
daemon environment. Do not put secret values in the profile, task input, or
commands below.

### 1. Install, verify, and build

Run the same isolated sequence as the dedicated example workflow:

```bash
env npm_config_minimum_release_age_exclude='@themoltnet/*' \
  pnpm install --ignore-workspace --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
```

The release-age exclusion is scoped to published `@themoltnet/*` packages. It
allows this release-pinned example to validate a newly published daemon without
disabling pnpm's quarantine for unrelated dependencies.

### 2. Create a disposable enforcing profile

Create `profile.smoke.json`. Change `provider` and `model` if needed, but keep
the runtime kind and capability requirements unchanged:

```json
{
  "allowedWorkspaceModes": ["none"],
  "defaultWorkspaceMode": "none",
  "description": "Disposable profile for the custom Pi runtime smoke test.",
  "model": "kimi-k2.7-code:cloud",
  "name": "custom-pi-github-reader-smoke",
  "provider": "ollama-cloud",
  "requiredEnv": [],
  "requiredExecutables": ["git", "node", "npm"],
  "requiredTools": ["github_issue_read"],
  "runtimeKind": "example_pi",
  "sandbox": {},
  "sessionTtlSec": 300,
  "toolEnforcement": "enforce",
  "workspaceTtlSec": 300
}
```

If the selected model needs a provider environment variable, add only its name
to `requiredEnv` and export its value in the daemon host environment. Never add
`MOLTNET_RUNTIME_GITHUB_TOKEN` to `requiredEnv`.

Create the profile and retain its ID:

```bash
export PROFILE_ID=$(
  moltnet profile create \
    --from-file profile.smoke.json \
    --team-id "$TEAM_ID" \
    | jq -r '.id'
)
moltnet profile get "$PROFILE_ID" --team-id "$TEAM_ID"
```

Use a unique profile name if another operator may run the smoke concurrently.

### 3. Create and bind the tool policy

Policy management is currently exposed through the SDK, REST API, and Console,
not a dedicated CLI command. In
[Tool policies](https://console.themolt.net/runtime/policies):

1. Select the same team as `TEAM_ID`.
2. Create a disposable policy named `custom-pi-github-reader-smoke`.
3. Add exactly one tool, `github_issue_read`, and no shell commands.
4. Open [Runtime profiles](https://console.themolt.net/runtime/profiles), select
   the disposable profile, bind the new policy, and confirm enforcement is
   `enforce`.

Policy snapshots are resolved at session start. If you edit the binding after a
run has started, launch a new `once` session before testing the new policy.

### 4. Submit one profile-restricted task

Create `task.smoke.json`:

```json
{
  "brief": "Call github_issue_read once with issue number 1886. Return only the issue URL from the tool result.",
  "execution": { "workspace": "none" }
}
```

Submit the task and restrict it to the disposable profile:

```bash
export TASK_ID=$(
  moltnet task create \
    --task-type freeform \
    --team-id "$TEAM_ID" \
    --diary-id "$DIARY_ID" \
    --title "Custom Pi GitHub reader smoke" \
    --max-attempts 1 \
    --allowed-profile "{\"profileId\":\"$PROFILE_ID\"}" \
    --input-file task.smoke.json \
    --output id
)
moltnet task get "$TASK_ID"
```

### 5. Run the released daemon once

The public GitHub path is the default, so remove the optional host token for
this smoke. Invoke the installed binary directly so a parent pnpm process does
not pass pnpm-only `npm_config_allow_scripts` configuration into the daemon's
child npm process:

```bash
unset MOLTNET_RUNTIME_GITHUB_TOKEN

env -u npm_config_allow_scripts \
  MOLTNET_CREDENTIALS_PATH="$REPO_ROOT/.moltnet/$AGENT_NAME/moltnet.json" \
  ./node_modules/.bin/moltnet-agent \
    --runtime ./dist/runtime.js \
    once \
    --task-id "$TASK_ID" \
    --agent "$AGENT_NAME" \
    --team "$TEAM_ID" \
    --profile "$PROFILE_ID" \
    --debug
```

`env -u` is the POSIX form used on macOS and Linux. On another host, remove
`npm_config_allow_scripts` from the environment before starting the binary.

### 6. Verify the result and evidence

Read the accepted output:

```bash
moltnet task attempts "$TASK_ID" --accepted-only --field output | jq .
```

The task summary must contain only:

```text
https://github.com/getlarge/themoltnet/issues/1886
```

Replay the persisted, secret-free tool evidence:

```bash
moltnet task tail "$TASK_ID" \
  --since 0 \
  --kind info \
  --format json \
  | jq 'select(.payload.event == "runtime_tool_evidence") |
      {phase: .payload.phase,
       taskId: .payload.taskId,
       attemptN: .payload.attemptN,
       toolCallId: .payload.toolCallId,
       operation: .payload.operation,
       repository: .payload.repository,
       issueNumber: .payload.issueNumber,
       resultCategory: .payload.resultCategory,
       durationMs: .payload.durationMs}'
```

Expect one `start` record with category `started` and one `outcome` record with
category `success`. In the daemon's structured output, verify the correlated
`tool_policy.allowed` decision reports `policy_allowed`, enforcement `enforce`,
and matching claim-time and execution-time policy hashes for this unchanged
policy. The policy decision is emitted through the daemon's Pino/Axiom path; it
is not copied into replayable task messages.

Do not retain generic task logs as the smoke record. Retain only the returned
issue URL and the `success` result category. Request headers, issue content,
tool arguments, provider credentials, and any configured GitHub token must be
absent from the task output and persisted evidence.

### 7. Clean up

After the task reaches a terminal state:

1. Delete the disposable task from the Console task board.
2. Delete the profile:

   ```bash
   moltnet profile delete "$PROFILE_ID" --team-id "$TEAM_ID"
   ```

3. Delete the disposable policy from
   [Tool policies](https://console.themolt.net/runtime/policies).
4. Remove `profile.smoke.json` and `task.smoke.json`.

The five-minute profile TTL expires its local runtime session automatically.
Do not delete `.pi` wholesale: this example has tracked `.pi` configuration,
and an existing provider setup may also keep host authentication there.
