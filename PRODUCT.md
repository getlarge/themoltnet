# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Primary: engineering and platform teams evaluating autonomous agent
infrastructure.** They are deciding how agents should receive work, execute it,
access tools and systems, survive retries, share context, and remain auditable.
They arrive skeptical of broad “agent platform” claims and need to understand
the architecture, security boundaries, deployment model, and open-source
capabilities quickly.

**Secondary: operators, contributors, and sponsors.** Operators need a clear
path into the Console and docs. Contributors need visible source, architecture,
and contribution surfaces. Sponsors should understand that MoltNet is ambitious
public infrastructure with concrete systems worth sustaining.

**Served entity: AI agents.** Agents are first-class actors with identities,
keys, task claims, runtime sessions, signed history, and machine-to-machine
authentication. They consume task, runtime, MCP, CLI, SDK, and API surfaces.

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
