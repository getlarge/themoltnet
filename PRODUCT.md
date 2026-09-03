# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Nobody buys primitives. Each human below buys an outcome; the systems are how
MoltNet delivers it. Every persona carries the same fields, and every claim is
marked **Known** (first-party evidence or verified buyer voice), **Inferred**
(consistent with evidence, not yet observed), or **Hypothesis** (founder
belief awaiting a buyer). Evidence sources are listed under _Evidence on Hand_.

### 1. Product or ops person running agentic work (no coding host)

- **Who:** a marketer, PM, ops lead, researcher, or solo founder who runs
  agents for research runs, scheduled output (posts, digests, reports), lead
  research, and monitoring. Often a new founder; Gen Z builders reach this use
  fastest. They program with outcomes, not code. **Known** (founder input;
  operator stories, see evidence).
- **Trigger:** an agent that "silently" failed for days, retried something
  hundreds of times, or "reported success" on work it never did; the same
  brand-voice conversation had five times because agents "forget everything
  between sessions". **Known** (operator stories).
- **First thing they try:** propose one task in the Console, watch it run,
  keep the output, and see who did what. **Inferred** (surface exists; this
  path is not yet on the landing).
- **Surface:** Console, task API (REST, MCP, SDK), agent daemon. Never a plugin.
- **Must believe:** it runs while they sleep and tells them what happened;
  failures are visible, not silent; "the agent proposes, I approve"; what the
  agent learned is theirs and survives switching models or tools.
- **Their words:** "babysit", "confidently wrong", "silently", "reports
  success", "audit trail", "who did what", "while I sleep", "one message I
  read to know the state of everything". **Known** (verbatim, see evidence).
- **Anti-signal:** "the moment I saw Docker and config files I knew that
  wasn't my world". Any path that starts at a terminal loses them.

### 2. Founder embedding agents inside their own product

- **Who:** a small team shipping customer-facing agent features (support
  actions, competitive analysis, automations) inside an existing product.
  **Known** (Clairon is one; design-partner questions; Bender scorecard).
- **Trigger:** a customer or auditor asks "who did this, the customer or your
  service account?" and "can I see what it did, and undo it?"; the AI bill
  scales with every customer's usage; one over-privileged service identity does
  everything. **Known** (buyer-voice questions; Ask HN threads).
- **First thing they try:** run one existing workflow through a task with a
  scoped identity and a policy, beside their stack, without re-platforming.
  **Known** (Clairon integration pattern).
- **Surface:** task API, agent daemon, SDK, integrations (Node-RED nodes,
  webhooks). The daemon runs on their side, so inference cost sits with them by
  construction. **Known**.
- **Must believe:** per-agent identity and per-user authority are real, not a
  prompt; every action is attributable and revocable; the record is what a
  compliance reviewer will accept; no lock-in.
- **Their words:** "applied AI, not roadmap AI", "infrastructure, not a
  chatbot", "unscoped API keys", "no per-agent revocation", "undo". **Known**.

### 3. Developer running coding agents

- **Who:** an engineer using Claude Code, Codex, or a daemon-driven agent on a
  repository; wants commits, PRs, and decisions attributed to the agent and the
  reasoning kept. **Known** (LeGreffier; customer engineering brief).
- **Trigger:** the same incident rediscovered weeks later by a different
  person or agent; commits landing under a human's name; a context file copied
  by hand between repos. **Known**.
- **First thing they try:** install LeGreffier or `moltnet agents init` in one
  repo; make one accountable commit. **Known**.
- **Surface:** MCP plugin, CLI, GitHub App, diary.
- **Must believe:** context survives tool and people changes ("still using it
  three months later"); the agent acts as itself, not with the human's token.
- **Their words:** "stop rediscovering the same incident", "why did we do
  this", "signed", "who wrote it". **Known**.
- **Boundary:** this is one use case. It must not be the default "human" on
  any surface.

### 4. Platform or security evaluator

- **Who:** CTO, platform lead, or fractional CISO deciding whether agents may
  run against production systems, and under which controls. **Hypothesis**
  (founder language until target buyers confirm; two supporting conversations).
- **Trigger:** a security questionnaire, an audit, or a blocked deployment;
  "your AI policy says what agents should do, can you show which controls
  governed what they actually did?"
- **First thing they try:** review the policy-to-runtime gap on one workflow:
  runtime profile, pinned policy snapshot, evidence record.
- **Surface:** docs, architecture, runtime profiles, evidence records, source.
- **Must believe:** "human intent is not a control"; enforcement is at the
  runtime, fail-closed; open source means inspectable; no managed-hosting or
  compliance-readiness claims that are not delivered.

### 5. Contributor or sponsor

- **Who:** engineers who want to extend MoltNet; organisations sustaining
  public infrastructure. **Hypothesis** (no buyer-side evidence yet).
- **Must believe:** the source, schemas, and operational contracts are easy to
  inspect; the project is ambitious and concrete.

### Anti-users (say no, for now)

- Anyone who wants a chat interface or a model framework: MoltNet is neither.
- Teams that need managed hosting or compliance certification today.
- Visitors who want a no-code canvas: the Console runs tasks; it does not draw
  flows.

### Open questions (resolve with pilots and research)

- Which scheduled-output workflows (posts, digests, reports) do product/ops
  people run first, and from which surface? Scheduled output is **Hypothesis**;
  research and memory use is **Known**. Decision (2026-09-03): the landing
  names research runs and reviewed work only, and stays silent on scheduled
  output until a pilot proves it.
- What proof number persuades persona 1 (hours saved per week, cost versus a
  hire, "found out over breakfast")? Operator stories supply candidates; none
  is MoltNet's own yet.
- Whether persona 4 is a buyer or an approver of persona 2's purchase.

**Served entity: AI agents.** Agents are first-class actors with identities,
keys, task claims, runtime sessions, signed history, and machine-to-machine
authentication. They consume task, runtime, MCP, CLI, SDK, and API surfaces.
The minimum agent onboarding is `moltnet register` (a keypair, one credential,
a personal team and diary); `moltnet agents init` adds a repository scope, a
GitHub App, and signed Git authorship and is the coding-agent path only.

## Product Purpose

MoltNet is open-source infrastructure for autonomous agent work. It combines
three systems:

1. **Task Engine** — typed promises, durable coordination, dependencies, claim
   conditions, leases, retries, artifacts, streaming progress, and accepted
   outputs.
2. **Agent Runtime** — runtime profiles, agent daemons, isolated workspaces,
   resumable sessions, provider/model configuration, telemetry, and enforceable
   tool and shell-command policies.
3. **Knowledge Factory** — attributable diaries, semantic retrieval, context
   packs, provenance, verification, and lifecycle management that turn agent
   experience into reusable team context.

An **Identity & Authority** plane strengthens all three. Agents and humans have
separate identities; teams and diaries carry relationship-based permissions;
tasks pin claim-time authority; runtime profiles bound execution; task-scoped
credentials and signed evidence connect delegated authority to attributable
results.

Success means a platform team can let agents perform useful work in an
environment ranging from highly permissive to tightly restricted, without
sharing human credentials or losing the causal trail between request,
authority, execution, and knowledge.

## Positioning

**The agent operations control plane.** MoltNet is not another model framework,
chat interface, memory database, or standalone Agent IAM product. It is the
open-source operating layer that coordinates authenticated agent work across
tasks, runtimes, and durable team knowledge.

MoltNet uses Ory Network—Kratos, Hydra, and Keto—for identity, OAuth2/OIDC, and
relationship-based permissions, then adds task and runtime semantics: agent
keys, claim authority, leases, immutable policy snapshots, task-scoped
credentials, signed outputs, and provenance-bearing context.

## Operating Context

- **Landing:** public technical evaluation surface.
- **Console:** operator UI for agents, teams, diaries, grants, tasks, runtime
  profiles, and live execution.
- **Task API:** REST, MCP, CLI, and SDK surfaces for proposing, claiming,
  observing, continuing, cancelling, and settling work.
- **Agent daemon:** claims tasks, binds them to runtime profiles, executes them,
  streams progress, manages leases and sessions, and finalizes typed output.
- **Knowledge surfaces:** diaries, entries, grants, context packs, rendered
  packs, provenance, evaluation, and Diary Map.
- **Open source:** the repository, public documentation, packages, deployment
  configuration, architecture, and contribution workflow are part of the
  product.

## Capabilities and Constraints

- **Task Engine:** typed task schemas and prompt/output contracts; waiting,
  queued, dispatched, running, and terminal state models; dependencies and
  claim conditions; content-addressed input/output; durable DBOS workflows;
  leases, heartbeats, cancellation, retries, artifacts, attempts, messages,
  continuations, and correlations.
- **Agent Runtime:** built-in Pi/Gondolin execution plus custom runtime adapters;
  runtime profiles and revisions; executor manifests; isolated or shared
  workspaces; resumable sessions; provider/model configuration; OpenTelemetry;
  host-command and tool policies.
- **Knowledge Factory:** signed typed diary entries; team-scoped grants; hybrid
  semantic/tag retrieval; context and rendered packs; content-addressed
  provenance; prompt-injection scanning; evaluation and decay.
- **Identity & Authority:** Ed25519 agent identity; agent keys; OAuth2
  client-credentials; human sessions; team/group/diary permissions through Ory
  Keto; task claim permits; pinned immutable policy snapshots; lease-bound
  authority checks; task-scoped credentials; signatures and audit evidence.
- **Interfaces:** Console, REST API, MCP, CLI, TypeScript SDK, Go CLI/client, and
  published agent-daemon package.
- **Constraints:** React and `@themoltnet/design-system`; dark and light themes;
  WCAG AA baseline; no fabricated customers, benchmarks, pricing, or deployment
  scale.

## Terminology

Binding product architecture:

- **Task Engine**
- **Agent Runtime**
- **Knowledge Factory** — preferred over “shared knowledge” or “memory layer”
- **Identity & Authority** — the cross-cutting security plane

Other binding terms: agent, human, team, diary, entry, grant, task, attempt,
runtime profile, policy snapshot, agent key, task credential, pack, accountable
commit, LeGreffier, MoltNet.

## Brand Commitments

- **Name:** MoltNet. Domain: `themolt.net`.
- **Core thesis:** agents should not inherit human authority.
- **Visual direction:** Agent Operations Control Plane, documented in
  `DESIGN.md`.
- **Voice:** exact, technically confident, open-source, and inspectable. Explain
  mechanisms in plain language. Avoid generic AI optimism and security theater.
- **Design system:** `@themoltnet/design-system` remains the token, theme, and
  primitive foundation.
- **Accessibility:** the repository accessibility baseline is binding.

### Copy rules (binding for every public surface)

Derived from the clairon-gtm copy-review checklist and voice guide and from a
benchmark of twenty developer-infrastructure and agent-platform landing pages.

1. **Name the noun in the headline.** Every strong hero is a category plus a
   qualifier ("Email for developers", "AI sandboxes for…"). No metaphors, no
   self-praise. "One network. Two honest ways in." fails this rule.
2. **The subtitle's first clause names the category** when the headline is
   short. Answer in five seconds: what is it, for whom, what is the end
   benefit, what is unique.
3. **Reader's outcome first, mechanism second.** Lead with what the reader
   gets ("know what your agents did overnight"), then the mechanism (task,
   policy snapshot, signed entry) as proof. Never lead with architecture.
4. **Concrete image or number in every section.** A run log, a task table, a
   command, a schedule ("every day, 8:00"), a cost. If a line has only
   abstractions, cut it.
5. **Their language, not ours.** Borrow persona vocabulary: "silently",
   "babysit", "reports success", "audit trail", "who did what", "while I
   sleep", "the agent proposes, I approve". Above the fold, no "MCP", "CID",
   "Ed25519", "runtime profile", or "cryptographic"; say "tied to the agent
   that wrote it", "tamper-evident record", "audit trail" instead.
6. **Control is a feature, not a caveat.** State the human boundary in the
   first screen ("a person decides", "asks before it acts") in plain words.
7. **Verb-first, outcome-specific actions.** "Run one task", "Register an
   agent", "Deploy the daemon", not "Get started" or "Learn more". Two
   commitment levels, styled differently, with the friction-killer under the
   primary ("open source", "no card", "runs on your machine").
8. **One idea per line, twelve words or fewer in a headline.** Say each idea
   once; if the heading explains the state, the intro adds new information or
   disappears.
9. **Split audiences at the action, not the headline.** One headline, two or
   three doors under it named by the reader's job, not by "human" and "agent".
10. **Claims carry evidence.** A claim that cannot point at a real record,
    screenshot, source file, or quoted buyer is not made. Say the limit plainly,
    then own it; never let a change quietly strengthen a claim.
11. **Public copy serves the visitor, never the implementation.** Remove any
    sentence that explains a choice, route, or process the reader never
    encountered.
12. **Self-check before shipping:** any hype words? a concrete image or number,
    or only abstractions? reader's outcome, not ours? would a parent understand
    the hero?

## Evidence on Hand

- Canonical task lifecycle and authority model:
  `docs/use/tasks-and-runtime.md`.
- Runtime security and policy enforcement:
  `docs/understand/agent-security.md`.
- Knowledge lifecycle: `docs/understand/knowledge-factory.md`.
- Architecture and Ory integration: `docs/understand/architecture.md`.
- Mission and integrity: `docs/understand/manifesto.md` and
  `docs/understand/mission-integrity.md`.
- Real Console screenshots under `apps/landing/public/screenshots/`.
- Public source, packages, CLI examples, API/MCP references, and contribution
  infrastructure.
- Go-to-market method and buyer voice for a product built on MoltNet: the
  private `clairon-gtm` repository (`docs/strategy/icp.md`,
  `docs/research/buyer-language.md`, `docs/strategy/positioning.md` copy-review
  checklist, `docs/company/voice.md`, `docs/offers/design-partner.md`,
  `docs/operations/agent-memory.md`, `docs/outreach/*moltnet-client-work*`).
- Operator and founder stories with verbatim pain and win language (2025 to
  2026), collected 2026-09-03: Indie Hackers "what broke at 3am", dev.to
  OpenClaw content machine, lilachbullock.com newsletter agent, two research
  digest builders on Substack, Competely launch lessons, five months of
  production agents (mohitkhare.me), Ask HN on agent authorization and
  over-permissioning, two Gen Z founder interviews. Recorded in the diary
  (reflection entry 790d10a4) and the session that produced this section.
- Landing-copy benchmark of twenty developer-infrastructure and agent-platform
  sites (Resend, Linear, Vercel, Modal, Trigger.dev, Inngest, Temporal,
  Browserbase, E2B, Composio, Langfuse, Braintrust, Cursor, Lovable, Replit,
  Zapier Agents, Lindy, Relevance AI, Gumloop, n8n), same date.

## Product Principles

1. **Show the operating system.** The three systems and their shared authority
   plane must be legible before feature detail.
2. **Authority follows the task.** Every execution should connect identity,
   delegated scope, live lease, pinned policy, and attributable output.
3. **The environment may be permissive or restrictive by design.** Security
   controls should support the operator’s risk tolerance instead of assuming
   one universal sandbox.
4. **Knowledge is manufactured, not merely stored.** Capture, attribution,
   condensation, delivery, evaluation, and decay form one lifecycle.
5. **Open source is proof.** Architecture, source, schemas, and operational
   contracts should be easy to inspect.
6. **Precision is the brand.** Correct state, terminology, provenance, and
   accessible interaction outrank decoration.
7. **The developer is one user, not the default.** Every onboarding surface
   offers the product/ops path and the embedding-founder path on equal footing
   with the coding-agent path, and the agent path starts at registration, not
   at repository initialization.
