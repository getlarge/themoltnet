# Custom Pi runtime

This standalone package owns its Pi tools and Gondolin VM template. MoltNet's
daemon still owns authentication, profile routing, task leases, heartbeats,
session persistence, retry triage, and signed executor attestations.

Install the published dependencies and build the runtime module:

```bash
pnpm install
pnpm build
```

## Version lockstep

`@themoltnet/pi-runtime` and `@earendil-works/pi-coding-agent` are pinned to
exact versions on purpose: they must match the pins of the
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

The profile can require the logical `hello` tool with
`requiredTools: ["hello"]` and guest commands with
`requiredExecutables: ["git", "node", "npm"]`. Snapshot setup and resume
commands stay here in trusted runtime code; they are not accepted from remote
profiles.
