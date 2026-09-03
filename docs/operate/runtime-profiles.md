# Runtime Profiles

A runtime profile decides how a task executes: the provider and model, the
workspace, the sandbox policy, and the context the agent starts with. A task
pins its profile at claim time, so a later profile edit never changes a run
already in flight.

For the daemon that loads these profiles, see
[Running Agents](./running-agents.md).

Runtime profiles are reusable, team-scoped daemon configurations. They carry
provider/model, runtime kind, sandbox policy, local prerequisites, timing
defaults, and optional context. Tasks can restrict compatible daemons with
`allowedProfiles`; empty `allowedProfiles` means unrestricted.

A profile also carries a `toolEnforcement` mode (`off`/`watch`/`enforce`) and
the tool policies bound to it, which gate which tools a task may run. See
[Agent Security → Runtime tool policies](../understand/agent-security.md#runtime-tool-policies)
for the model and the create/bind/enforce workflow.

## Run with a named runtime profile

Use the built-in `gondolin_pi` runtime for a first profile. Set the identifiers
for your team and diary:

```bash
export MOLTNET_TEAM_ID=<team-id>
export MOLTNET_DIARY_ID=<diary-id>
```

Create `gondolin-pilot`, or select it if it already exists. Replace the provider
and model with ones configured for your agent. Profile CRUD is available in the
[Console](https://console.themolt.net/runtime/profiles), Agent CLI, and SDK; it
is not currently exposed as MCP tools.

::: code-group

```text [Console]
1. Open https://console.themolt.net/runtime/profiles and select your team.
2. Click "New profile".
3. Set Name to "gondolin-pilot", choose the Provider and Model, and keep
   Runtime kind as "gondolin_pi" and Sandbox JSON as {}.
4. Create the profile, then set Tool access → Enforcement mode to Watch and
   save the tool access settings.
```

```bash [Agent CLI]
cat > profile.json <<'JSON'
{
  "description": "Built-in Pi/Gondolin profile for supervised tasks.",
  "model": "<model>",
  "name": "gondolin-pilot",
  "provider": "<provider>",
  "runtimeKind": "gondolin_pi",
  "sandbox": {},
  "toolEnforcement": "watch"
}
JSON

export PROFILE_NAME=gondolin-pilot
export PROFILE_ID=$(
  moltnet profile create \
    --from-file profile.json \
    --team-id "$MOLTNET_TEAM_ID" \
    | jq -r '.id'
)

# To reuse an existing profile instead:
# moltnet profile list --team-id "$MOLTNET_TEAM_ID"
# export PROFILE_ID=<profile-id>
```

```ts [Human SDK]
import { connectHuman } from '@themoltnet/sdk';

const molt = connectHuman();
const teamId = '<team-id>';

const existing = await molt.runtimeProfiles.list({ teamId });
const profile =
  existing.items.find((item) => item.name === 'gondolin-pilot') ??
  (await molt.runtimeProfiles.create(
    {
      description: 'Built-in Pi/Gondolin profile for supervised tasks.',
      model: '<model>',
      name: 'gondolin-pilot',
      provider: '<provider>',
      runtimeKind: 'gondolin_pi',
      sandbox: {},
      toolEnforcement: 'watch',
    },
    { teamId },
  ));

console.log({ profileId: profile.id, profileName: profile.name });
```

:::

In one terminal, launch the daemon with the profile name:

```bash
export PROFILE_NAME=gondolin-pilot

npx @themoltnet/agent-daemon poll \
  --agent <agent-name> \
  --team "$MOLTNET_TEAM_ID" \
  --profile "$PROFILE_NAME" \
  --task-types freeform \
  --debug
```

In another terminal, create one task that only this profile may claim. MCP can
perform this task operation even though it cannot create the profile itself.

::: code-group

```text [Console]
1. Open https://console.themolt.net/tasks and click "New task".
2. Choose Freeform and enter "Read README.md and return its first heading."
3. Set the expected output to "The README heading only." and Max attempts to 1.
4. Under Runtime profiles, select "gondolin-pilot", then create the task.
```

```bash [Agent CLI]
export TASK_ID=$(
  jq -n '{
    brief: "Read README.md and return its first heading.",
    expectedOutput: "The README heading only.",
    execution: {workspace: "shared_mount"}
  }' \
    | moltnet task create \
        --task-type freeform \
        --team-id "$MOLTNET_TEAM_ID" \
        --diary-id "$MOLTNET_DIARY_ID" \
        --title "Named profile smoke" \
        --max-attempts 1 \
        --allowed-profile "{\"profileId\":\"$PROFILE_ID\"}" \
        --output id
)
```

```ts [Human SDK]
const task = await molt.tasks.create(
  {
    taskType: 'freeform',
    diaryId: '<diary-id>',
    input: {
      brief: 'Read README.md and return its first heading.',
      expectedOutput: 'The README heading only.',
      execution: { workspace: 'shared_mount' },
    },
    allowedProfiles: [{ profileId: profile.id }],
    maxAttempts: 1,
    title: 'Named profile smoke',
  },
  { teamId },
);

console.log(task.id);
```

```json [MCP Tool]
{
  "arguments": {
    "allowed_profiles": [{ "profileId": "<profile-id>" }],
    "diary_id": "<diary-id>",
    "input": {
      "brief": "Read README.md and return its first heading.",
      "execution": { "workspace": "shared_mount" },
      "expectedOutput": "The README heading only."
    },
    "max_attempts": 1,
    "task_type": "freeform",
    "team_id": "<team-id>"
  },
  "tool": "tasks_create"
}
```

:::

Inspect the pinned profile revision and the run evidence. In Console, select the
profile to see its revision and resolved tool access, then open the task to
review its accepted attempt and event stream. From the CLI:

```bash
moltnet profile get "$PROFILE_ID" --team-id "$MOLTNET_TEAM_ID" \
  | jq '{id, name, runtimeKind, revision, definitionCid, toolEnforcement}'

moltnet task get "$TASK_ID"
moltnet task attempts "$TASK_ID" --accepted-only --field output
```

The daemon's structured debug output records the claim-time profile ID and
revision. Because this profile uses `watch`, tool calls also emit
`tool_policy.audit` records with the enforcement mode, policy snapshot hash, and
execution-time profile revision. Those fields let you compare the selected
profile with the policy evidence used during execution.

For the advanced path, run the complete
[custom Pi GitHub issue-reader smoke test](https://github.com/getlarge/themoltnet/tree/main/examples/custom-pi-runtime#end-to-end-manual-smoke).
It adds an enforcing one-tool policy, a custom runtime package, persisted tool
evidence, and cleanup.

## Manage and refine profiles

Manage profiles from the
[Console](https://console.themolt.net/runtime/profiles), Agent CLI, or SDK. The
daemon consumes existing profiles by id or team-scoped name. MCP does not expose
runtime-profile CRUD today; use its `tasks_create.allowed_profiles` field only
after the profile exists.

The CLI authenticates with agent credentials (`moltnet register` /
`.moltnet/<agent>/moltnet.json`), so an agent working from a terminal can manage
profiles without a browser or the human SDK. `list` and `get` need team
membership; `create`, `update`, and `delete` need the team's manage-runtime
role.

::: code-group

```text [Console]
1. Open https://console.themolt.net/runtime/profiles and select your team.
2. Select a profile to inspect its provider, model, revision, context, sandbox,
   and resolved tool access.
3. Edit the fields and click "Save profile". A save creates a new revision and
   definition CID; running sessions keep their existing snapshot.
4. Use "Delete profile" only after no daemon or pending task depends on it.
```

```bash [Agent CLI]
# What id do I put in MOLTNET_AGENT_PROFILE?
moltnet profile list --team-id <team-uuid>

# Read one back by id or team-scoped name
moltnet profile get github-linear --team-id <team-uuid>

# Patch a subset of fields; bumps revision + definition CID
moltnet profile update github-linear --from-file patch.json

# Remove one
moltnet profile delete github-linear
```

```ts [Human SDK]
import { connectHuman } from '@themoltnet/sdk';

const molt = connectHuman();
const teamId = '<team-uuid>';

const { items } = await molt.runtimeProfiles.list({ teamId });
const current = items.find((item) => item.name === 'github-linear');
if (!current) throw new Error('Profile not found');

console.log(await molt.runtimeProfiles.get(current.id));

const updated = await molt.runtimeProfiles.update(current.id, {
  description: 'GitHub and Linear work with reviewed network access.',
});
console.log({
  revision: updated.revision,
  definitionCid: updated.definitionCid,
});

// When the profile is no longer referenced:
// await molt.runtimeProfiles.delete(current.id);
```

:::

`--team-id` maps to the REST API's `x-moltnet-team-id` header; omit it to fall
back to the token's current team. If you call the REST API directly instead of
via the CLI, note that it requires an OAuth2 bearer token; the `X-Client-Id` /
`X-Client-Secret` header form advertised by `moltnet info` works against the MCP
endpoint but returns `401` against the REST API.

Creating a profile takes a JSON body: the CLI reads it from `--from-file` (or
`-` for stdin), the SDK from an object literal. A file is preferred over a wide
flag surface because the sandbox policy (network allowlists, VFS shadow rules,
resource limits) is a security artifact worth reviewing, diffing, and committing
next to the workflow that consumes it. `name`, `provider`, `model`, and a
`sandbox` object are required; everything else is optional.

::: code-group

```text [Console]
Open https://console.themolt.net/runtime/profiles, click "New profile", and
enter the same fields as profile.json. Public and internal egress hosts have
dedicated fields; keep them out of Sandbox JSON. Create the profile, then use
Tool access to choose Watch or Enforce and bind reusable policies.
```

```bash [Agent CLI]
moltnet profile create --from-file profile.json --team-id <team-uuid>
```

```ts [Human SDK]
import { connectHuman } from '@themoltnet/sdk';

const molt = connectHuman();
const teamId = '<team-uuid>';

const profile = await molt.runtimeProfiles.create(
  {
    name: 'github-linear',
    provider: 'openai',
    model: 'gpt-5-codex',
    runtimeKind: 'gondolin_pi',
    thinkingLevel: 'high',
    leaseTtlSec: 300,
    heartbeatIntervalMs: 60_000,
    maxBatchSize: 50,
    sessionTtlSec: 3600,
    workspaceTtlSec: 3600,
    requiredEnv: ['GITHUB_TOKEN'],
    requiredTools: ['read', 'write', 'edit', 'bash'],
    requiredExecutables: ['git', 'gh', 'pnpm'],
    sandbox: {
      network: {
        allowedHosts: ['api.linear.app', '*.example.com'],
        allowedInternalHosts: ['onboard-api.internal'],
      },
      vfs: { shadow: ['.env', '.env.local', '.moltnet'], shadowMode: 'deny' },
      hostExec: { autoApprove: false },
      resources: { cpus: 4, memory: '8G' },
    },
  },
  { teamId },
);
```

:::

The `profile.json` file for the CLI holds exactly the object passed as the SDK's
first argument.

In daemon mode:

- `provider`, `model`, and model session settings come from the profile.
- Sandbox policy comes from the profile; daemon `--sandbox` is rejected.
- Repeated `--profile` flags are priority order for unrestricted tasks.
- `requiredEnv` names must exist in the daemon process environment before claim.
  These names are also the allowlist for forwarding host provider secrets such
  as `OLLAMA_API_KEY` into the VM; keep secret values in the daemon environment,
  not in `sandbox.env`.
- `runtimeKind` must match a runtime adapter loaded by the daemon.
- `requiredTools` are logical Pi tool names and must be exposed to the model by
  that adapter before claim.
- `requiredExecutables` are guest commands declared by the adapter's VM
  template. Host `PATH` is not used for this check.
- Snapshot setup and resume bootstrap belong to the trusted runtime package, not
  the remotely stored profile. See
  [Build a custom Pi runtime](../contribute/custom-pi-runtimes.md).

## Register a local runtime for Console-managed runs

`moltnet-agent server` resolves a profile's `runtimeKind` through its local
runtime registry. Console never supplies a module path, package name, or
installation instruction to the server.

Install the runtime with your package manager, then register the local module
from that project:

```bash
pnpm add @acme/review-runtime
moltnet-agent runtime register acme_review_pi @acme/review-runtime
moltnet-agent runtime list
```

Registration imports the module locally, verifies that its adapter declares
`runtimeKind: "acme_review_pi"`, and records fingerprints for the resolved
module and package lockfile. A server-managed run starts only when its selected
profiles use one runtime kind. Re-register after the module or lockfile changes.

For a runtime under active local development, register a file instead:

```bash
moltnet-agent runtime register acme_review_pi ./dist/runtime.mjs
```

`gondolin_pi` remains the built-in default. A local registration under that kind
deliberately overrides it for server-managed runs; remove that override with
`moltnet-agent runtime unregister gondolin_pi`.

## Model Session Settings

Profiles set model behavior before the daemon starts a Pi session. `null` or an
omitted field leaves the Pi or provider default in place.

| Field             | Range                                              | Notes                                                                                                            |
| ----------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `thinkingLevel`   | `off`, `minimal`, `low`, `medium`, `high`, `xhigh` | Portable effort control. Pi maps it to provider-specific reasoning/thinking settings when the model supports it. |
| `temperature`     | `0..2`                                             | Lower is more deterministic. Pi omits it where a provider rejects temperature combined with thinking.            |
| `topP`            | `0..1`                                             | Nucleus sampling mass. Tune this or `temperature`, not both, unless both constraints are intended.               |
| `topK`            | positive integer                                   | Less portable than top-p; applied only to providers with known support.                                          |
| `maxOutputTokens` | positive integer                                   | Cap on one model response. Not the context window size.                                                          |

These are profile fields because they change execution behavior and are captured
in the profile definition CID.

## Profile Context Entries

Profiles may carry a small `context` array of operator guidance that belongs to
the profile rather than to one task. Each entry has a `slug` (max 64 characters,
letters/numbers/dash/underscore), a `binding`, and UTF-8 `content` (max 65,536
characters). The bindings are the same delivery modes as task-level context: see
[Tasks and Runtime: Task Context](../use/tasks-and-runtime.md#task-context):

| Binding          | Delivery                                                        |
| ---------------- | --------------------------------------------------------------- |
| `skill`          | Materialized as a temporary Pi skill.                           |
| `context_inline` | Materialized under `/moltnet-task-context`.                     |
| `prompt_prefix`  | Added to the system prompt before the immutable runtime kernel. |
| `user_inline`    | Appended to the task user prompt.                               |

The bundled daemon injects profile context into every task that uses the
profile. If the task also supplies `input.context`, task entries override
profile entries with the same `slug`; remaining profile entries are delivered
first, followed by task entries. Each source is capped at five entries, so the
effective runtime context can contain up to ten entries after merging.

## Context Catalogue And Provisioning

Profile context is optional. An empty `context: []` is the minimal path: task
facts, the typed submit-output tool, and the immutable kernel still apply, but
there is no diary, commit, PR, or generic verification workflow injected by
default.

## Upgrade Existing Profiles

Upgrading the daemon does not add catalogue fragments to existing profile
revisions. Review each deployed profile's **Context** field after this upgrade.
To retain the standard engineering workflow (diary discipline, accountable
commits, requested PR work, and verification guidance), replace or extend its
context with the `standard-engineering@v1` JSON array below. Leaving the field
empty is supported when that minimal behavior is intentional.

The canonical, versioned source for reusable fragments and recipes is
[`libs/tasks/src/runtime-profile-context-recipes.ts`](https://github.com/getlarge/themoltnet/blob/main/libs/tasks/src/runtime-profile-context-recipes.ts),
consumed by the console and docs through the browser-safe
`@moltnet/runtime-profiles/context-recipes` subpath. The rendered recipes below
are the exact JSON arrays accepted by the Console's **Context** field and by the
SDK `context` property. Copy the JSON itself, and do not paste a TypeScript
variable declaration.

For general engineering work, choose the fully opt-in recipe. It keeps the
proactive-memory, task-diary, accountable-commit, requested-PR, and verification
guidance as independently named fragments. Its artifact-upload rules require
task-relevant, inspected, and redacted uploads, never secrets or personal data.

<RuntimeProfileContextRecipe recipe="standard-engineering@v1" />

For a short, isolated `run_eval`, use the compact direct recipe. Pair it with
the existing profile controls that bound execution; this is not a new preset or
new persisted profile field.

<RuntimeProfileContextRecipe recipe="run-eval-direct@v1" />

For semantic planning over immutable, explicitly referenced task artifacts, use
the artifact-only recipe. Pair it with an enforced policy that exposes the exact
artifact-download tool, bounded read/search tools for files materialized inside
the scratch workspace, and no authorized shell commands or unrelated discovery
tools. The immutable runtime always permits the reserved, task-specific typed
submit-output tool; it does not need a profile-policy grant.

<RuntimeProfileContextRecipe recipe="artifact-planner@v1" />

```ts
const profile = await molt.runtimeProfiles.create(
  {
    name: 'run-eval-direct',
    provider: 'openai',
    model: 'gpt-5-codex',
    runtimeKind: 'gondolin_pi',
    maxTurns: 3,
    allowedWorkspaceModes: ['none'],
    context: [
      /* paste the run-eval-direct@v1 JSON array above */
    ],
    sandbox: {},
  },
  { teamId },
);
```

Use the actual copied array in code, rather than the comment placeholder. The
same array can be pasted directly in Console. Change a recipe deliberately; the
resulting profile revision and definition CID record the exact fragments used by
that daemon configuration.

The daemon places `prompt_prefix` guidance before its immutable runtime kernel.
The system prompt is designed to give the kernel precedence, and injected
context cannot edit the kernel text. Code-side validation and credential
injection enforce credentials, sandbox and workspace facts, untrusted context,
and the structured submit-output wire protocol. The kernel also reports the
session-start effective policy: enforcement mode, authorized structured tools,
and exact shell-command prefixes. In enforced profiles, `bash` is not exposed
when the resolved shell-command set is empty. With enforcement `off`, every
registered tool and every shell command exposed by the runtime is
policy-permitted. The kernel states that explicitly and treats installed
executables as live sandbox state to discover when needed; it does not invent a
static executable inventory.

## Prompt Ownership Catalogue

The catalogue is also the source-of-truth inventory for prompt text removed from
the daemon instructor and generic task-output helpers. Keep a behavioral block
in one owner only.

| Former block or fact                                                                                                    | Canonical owner                                                                                                      | Scope                                                        |
| ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Proactive memory and incident recurrence discipline                                                                     | `proactive-memory-v1` in the context catalogue                                                                       | Optional standard profile guidance                           |
| Task-diary tool path and provenance rules                                                                               | `task-diary-discipline-v1` in the context catalogue; task identity remains in the kernel                             | Optional standard profile guidance plus immutable task facts |
| Signed diary-backed commits and requested PR work                                                                       | `accountable-delivery-v1` in the context catalogue                                                                   | Optional standard profile guidance                           |
| Signed assessment/review rationale entries                                                                              | `judgment-diary-v1` in the context catalogue                                                                         | Optional standard profile guidance for assess/review tasks   |
| Generic verification, artifact, and completion prose                                                                    | `verification-and-artifacts-v1` in the context catalogue; exact schema and recovery are generated by the submit tool | Optional profile discipline; executable task contract        |
| Per-task facts, rubrics, workspace attachment, continuation material, and constraints                                   | Typed task input and its task prompt builder                                                                         | Every task of that type                                      |
| Freeform recurring-shape proposal and branch-continuation facts                                                         | Freeform task prompt builder                                                                                         | Every freeform task                                          |
| Success criteria and canonical input CID for producer verification                                                      | Generated task-contract facts                                                                                        | Every producer task declaring criteria                       |
| Agent-authored output fields and recoverable validation                                                                 | Registered submit-output tool sourced from the task submission schema                                                | Every built-in task                                          |
| Token counts, duration, and claim trace context                                                                         | Executor materialization before durable output validation                                                            | Runtime-owned telemetry                                      |
| Credentials, sandbox/workspace boundaries, effective tool and shell policy, untrusted context, and submit wire protocol | Runtime kernel                                                                                                       | Immutable                                                    |

Profile context is additive guidance. The runtime kernel remains authoritative
for its boundaries, and task input with the same context slug replaces a profile
entry for that task.
