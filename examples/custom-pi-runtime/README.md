# Custom Pi runtime

This standalone package owns its Pi tools and Gondolin VM template. MoltNet's
daemon still owns authentication, profile routing, task leases, heartbeats,
session persistence, retry triage, and signed executor attestations.

Install the published dependencies and build the runtime module:

```bash
pnpm install
pnpm build
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
