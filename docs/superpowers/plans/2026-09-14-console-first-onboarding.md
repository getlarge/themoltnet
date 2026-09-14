# Console-first onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** The docs, the landing page, and the Console present "install the agent
bundle, open the Console, create the agent" as the primary way to run an agent,
with `moltnet register` as the CLI identity path, `moltnet agents init` for
coding agents, and one documented command to give a Console-created agent CLI
access.

**Architecture:** Text changes on four docs pages and the daemon README, two
landing components, and one Console shortcut (an invite-code dialog opened from
the Local Runtime page that prefills the enrollment field). No API changes;
everything documented already ships in PRs #2260 to #2262.

**Tech Stack:** VitePress docs, React (landing, Console), design-system
components.

**Spec:**
`docs/superpowers/specs/2026-09-14-register-recover-onboarding-design.md`,
Component D.

## Global Constraints

- Branch `docs/console-first-onboarding`, cut from
  `feat/sdk-register-identity-store` (PR 3).
- Every commit needs a LeGreffier diary entry first
  (`moltnet entry commit ... --title "<short title>"`),
  `MoltNet-Diary: <entryId>` in the body,
  `Task-Group: console-first-onboarding`, `Task-Family: docs` on the first
  commit, `Task-Completes: true` on the last, and the `Claude-Session` line.
- Docs authoring rules from `docs/contribute/accessibility.md` and the docs
  rendered pack: no duplicated canonical guidance, cross-link instead; keep the
  ordering Console path, then `moltnet register`, then `moltnet agents init`.
- Checks: `pnpm exec prettier --check` on every edited file;
  `pnpm exec nx run-many -t lint typecheck --projects=@moltnet/console,@moltnet/landing`;
  `pnpm exec nx run @moltnet/console:test`;
  `pnpm exec nx run @moltnet/docs:build` for dead links.
- This repository is public. Describe mechanisms, never weaknesses.

---

### Task 1: Docs

**Files:**

- Modify: `docs/start/getting-started.md` ("2. Ready a team agent")
- Modify: `docs/operate/running-agents.md` (Daemon section, after
  `moltnet-agent server`)
- Modify: `docs/start/install-and-initialize.md` ("Register an agent")
- Modify: `docs/reference/agent-configuration.md` ("Recover a lost OAuth2 client
  secret")
- Modify: `docs/use/sdk-and-integrations.md` (after the CLI register block)
- Modify: `apps/agent-daemon/README.md` (config-based runs paragraph)

- [ ] **Step 1: getting-started, "Ready a team agent"**

Replace the first paragraph of section 2 (from
`[Register an agent](./install-and-initialize.md#register-an-agent), then either`
through `running.`) with the Console path first, then the two CLI paths, then
the recovery one-liner. Keep the runtime-profile paragraph and the two reference
links.

- [ ] **Step 2: running-agents, Daemon**

After the `moltnet-agent server` code block, add a paragraph on creating the
agent from the Console (Local Runtime page, executor invite code, keys stored
locally), the recovery command for CLI access, and a sentence that
`moltnet register` and `moltnet agents init` identities can run here too with a
stored agent key.

- [ ] **Step 3: install-and-initialize, Register an agent**

After the command paragraph, state that the seed and OAuth2 secret land in the
OS keyring as references (no migration after a fresh registration), mention
`--destination`, and point daemon-only agents at the running-agents Console
path.

- [ ] **Step 4: agent-configuration, recovery**

State that recovery mints the client for an identity that has none
(agent-key-only identities), and that `--destination` is only required for a
plaintext `client_secret`; an agent-key-only identity defaults to the provider
of its `agent_key_ref`, then the OS keyring. Update the code block comments
accordingly.

- [ ] **Step 5: sdk-and-integrations, Register from code**

Add a `### Register from code` subsection with the `@themoltnet/sdk/node`
`register` example, the options that matter (`enrollmentToken` / `enroll`,
`credentialType`, `secretProvider`, `configDir`), and the error codes.

- [ ] **Step 6: daemon README**

Replace "Provision them once via `moltnet agents init`" with the three
provisioning paths (Console managed agent; `moltnet register` or
`moltnet agents init` plus `moltnet agents keys create --store`).

- [ ] **Step 7: Verify and commit**

`pnpm exec prettier --check` on the six files;
`pnpm exec nx run @moltnet/docs:build` succeeds (dead-link check). Commit
`docs: lead onboarding with the Console-created agent` with its diary entry.

---

### Task 2: Landing

**Files:**

- Modify: `apps/landing/src/pages/GettingStartedPage.tsx` (`embedSteps` steps 2
  and 3)
- Modify: `apps/landing/src/components/OnboardingPaths.tsx` (door 2 link)

- [ ] **Step 1: Getting-started embed track**

Step 2 becomes "Create the daemon's agent from the Console" (no command; link to
`${CONSOLE_BASE_URL}/runtime/local`). Step 3 becomes "Administer it from the CLI
when you need to" with the recovery command. Steps 1, 4, 5, 6 unchanged.

- [ ] **Step 2: Homepage door**

Under the daemon install block in door 2, add an `ops-onboarding-install-links`
list with one external link "Then create its identity in the Console" to
`${CONSOLE_BASE_URL}/runtime/local`.

- [ ] **Step 3: Verify and commit**

`pnpm exec nx run-many -t lint typecheck --projects=@moltnet/landing`; Prettier
check. Commit
`feat(landing): point the daemon path at the Console-created agent`.

---

### Task 3: Console invite-code shortcut

**Files:**

- Modify: `apps/console/src/components/teams/CreateInviteDialog.tsx`:
  `onCreated(code: string)`, optional `defaultRole`.
- Modify: `apps/console/src/pages/LocalRuntimePage.tsx`: "Create invite code"
  button next to "Create identity", opens the dialog with
  `defaultRole="executor"`, prefills the enrollment field from `onCreated`.

- [ ] **Step 1: Dialog props**

`onCreated: (code: string) => void` (the team page ignores the argument),
`defaultRole?: 'member' | 'executor' | 'manager'` used for the initial state and
the reset on close. Call `onCreated(data.code)`.

- [ ] **Step 2: Local Runtime page**

Add `inviteOpen` state, a secondary `Button` "Create invite code" disabled
unless a non-personal team is selected and the user can manage it, and render
`CreateInviteDialog` with `teamId={selectedTeam.id}`, `defaultRole="executor"`,
`onCreated={(code) => setEnrollmentToken(code)}`.

- [ ] **Step 3: Verify and commit**

`pnpm exec nx run-many -t lint typecheck test --projects=@moltnet/console`.
Commit
`feat(console): create the executor invite code from the Local Runtime page`
with `Task-Completes: true`.

---

### Task 4: Pull request

`git push -u origin docs/console-first-onboarding`, then
`moltnet github exec -- gh pr create --base feat/sdk-register-identity-store --head docs/console-first-onboarding --title "docs: Console-first onboarding" --body-file <body>`.
