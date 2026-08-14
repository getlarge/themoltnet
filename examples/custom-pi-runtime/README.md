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
pnpm install --ignore-workspace --frozen-lockfile
pnpm build
```

The root Nx graph discovers the package. Its explicit `test-ci` target performs
that frozen standalone install, then typechecks, unit tests, and builds in
sequence:

```bash
pnpm exec nx run moltnet-custom-pi-runtime-example:test-ci
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

## Manual smoke

With an enforcing profile and policy configured, submit a task that calls
`github_issue_read` for one public issue. Verify the task succeeds, then retain
only the returned `https://github.com/getlarge/themoltnet/issues/<number>` URL
and the `success` evidence category in the smoke record. Do not record request
headers, the issue body, or any configured token.
