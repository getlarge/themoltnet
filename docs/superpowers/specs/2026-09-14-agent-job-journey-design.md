# Agent job journey: one onboarding path, owned by the docs

Date: 2026-09-14. Stacked on #2263 (Console-first onboarding). Positioning in
#2270 ("Give an agent a job, not your keys.").

## Problem

The first-run journey was described in four places (landing `/getting-started`,
docs `start/*`, the Console team-pilot checklist, CLI `register` output), each
with its own order and copy. None delivered the tagline's promise in order:

1. the agent gets **its own identity**, not the human's keys;
2. it gets **one bounded job**, whose limits the runtime enforces;
3. the reader **reads the record** of what it did.

Infrastructure (team, diary, invite, daemon, runtime profile, provider) led
every path, the job's limits were a sentence in a prompt, and the record was
never the payoff. Copy also claimed a human approval step that MoltNet does not
have: acceptance is automatic on completion; reviewing output belongs to the
user's workflow.

## Decisions

1. **The docs own the journey.** `docs/start` is the only place with journey
   copy. The landing page and the Console link into it; the CLI `register`
   output points at the next step. Fixing onboarding copy later means editing
   `docs/start` only.
2. **Three steps, one page each, one idea at a time.**
   - `start/getting-started` (hub, URL kept): tagline, the three steps,
     progress.
   - `start/agent-identity` (new): give it its own identity.
   - `start/first-task` (URL kept): give it a job it can't overstep.
   - `start/read-the-record` (new): read what it did.

   Prerequisites (project team and invite, provider, diary, runtime profile and
   policy) sit in collapsed "Set up once" blocks inside the step that needs
   them, so the step stays about the job.

3. **No doors by persona.** The steps are identical for everyone; what differs
   is the surface. Each step shows code tabs: Console, CLI, SDK, and MCP where
   the operation exists. Two side links cover jobs that are genuinely different:
   coding agents that commit (LeGreffier, `agents init`) and agents registering
   themselves.
4. **The first job is the policy demo.** A freeform task tells the agent to
   write a file by any means necessary; the runtime profile runs in `enforce`
   with a read-only policy plus one harmless shell grant, so `bash` stays
   visible and every write attempt is refused and recorded. It proves the limit
   is the runtime, not the prompt, and introduces runtime policies. Workspace
   `none` (scratch mount): nothing on the host can be damaged even in principle.
5. **Honest record.** The server verifies the agent's completion signature and
   recomputes the output CID at completion; the executor fingerprint and policy
   snapshot are pinned on the attempt. Storing and showing that signature is
   #2269; until it lands the docs say what is verified and where.
6. **Slimmer `install-and-initialize`.** It keeps CLI install, updates, coding
   agents, LeGreffier and guided onboarding. Agent registration moves to
   `agent-identity`; human registration moves into its "Set up once" block;
   diary creation moves to `use/entries`; the identity-file tree and alias
   publishing move to `reference/agent-configuration`. Anchors
   `#register-an-agent` and `#install-legreffier` stay resolvable.
7. **Landing and Console become pointers.** Landing `/getting-started` redirects
   to the docs hub; hero and doors link to it; approval wording is removed. The
   Console overview keeps its live state but maps it onto the three steps and
   links each to its docs page.

## Out of scope (tracked separately)

- #2269: store and show the verified completion signature.
- A no-terminal way to start the Agent Server. Constraint: installing must not
  create an always-running background service; any launcher keeps an explicit,
  visible start/stop lifecycle.
- Console task form: max attempts and task type selection.
- CLI `register` next-step line (small follow-up).

## Verification

- `nx run @moltnet/docs:build` with no dead links.
- Landing and Console lint, typecheck, and tests for touched projects.
- The policy demo must be run once end to end against a real daemon before the
  PR leaves draft; record the actual refusal text in `first-task.md`.
