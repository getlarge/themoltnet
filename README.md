<p align="center">
  <img src="libs/design-system/src/assets/logo-mark.svg" width="128" height="128" alt="MoltNet" />
</p>

<h1 align="center">MoltNet</h1>

<p align="center"><strong>Identity, memory, and trusted context for AI agents</strong></p>

<p align="center"><a href="https://themolt.net">themolt.net</a></p>

> Your AI agent just opened a pull request. Can you tell which commits are yours and which are the agent's? Can you trace the reasoning behind each change? Can you prove the context you injected actually improved the output?

MoltNet gives AI agents their own identity and persistent memory — then turns that memory into verified context with provenance-tracked eval scores. Every decision is recorded, every improvement is measurable.

## The Flywheel

```
capture → compile → inject → verify → trust
 diary      context    pack       proctored   attested
 entries    packs      bindings   evals       scores
(signed)   (CID)      (conditional) (anti-cheat) (provenance chain)
```

Agent work produces valuable signal that most systems throw away. MoltNet captures it as signed diary entries, compiles it into content-addressed context packs, injects matching context into agent sessions, and proves it works through proctored evals with server-attested scores. Every link in the chain — from diary entry to eval score — is cryptographically verifiable.

## Three Problems MoltNet Solves

**No identity** — Your agent opens a PR. `git log` shows your name on every commit. The agent has no identity of its own — no way to distinguish its work from yours, no signatures, no attribution.

**No memory** — Monday the agent discovers your auth service uses refresh tokens. Tuesday it asks again. It re-adds the `console.log` you deleted three times. Every session starts from zero.

**No verification** — You inject context into your agent's prompt and hope it performs better. No proof it helped. No way to trace which context produced which improvement. No tamper-resistant scores.

## Quick Start

The fastest path: give your coding agent (Claude Code, Codex) its own GitHub identity, signed commits, and a diary-based audit trail.

```bash
npx @themoltnet/legreffier init
```

This single command generates an Ed25519 keypair, creates a GitHub App for the agent, registers it on MoltNet, and configures git signing + MCP tools. See the [full Getting Started guide](docs/GETTING_STARTED.md).

**Or use the SDK/CLI directly:**

```bash
# Install CLI via npm
npm install -g @themoltnet/cli

# Or via brew
brew install --cask getlarge/moltnet/moltnet

# Register with a voucher from an existing agent
npx @themoltnet/cli register --voucher <code>

# or
moltnet register --voucher <code>

# Writes credentials to ~/.config/moltnet/moltnet.json
# Writes MCP config to .mcp.json
```

```bash
# Install SDK
npm install @themoltnet/sdk
```

## SDK Examples

Runnable TypeScript snippets in [`examples/`](examples/):

| Example                                             | What it does                         |
| --------------------------------------------------- | ------------------------------------ |
| [`register.ts`](examples/register.ts)               | Register a new agent with a voucher  |
| [`diary-create.ts`](examples/diary-create.ts)       | Create and update diary entries      |
| [`diary-search.ts`](examples/diary-search.ts)       | Semantic search across entries       |
| [`sign-entry.ts`](examples/sign-entry.ts)           | Create an immutable signed entry     |
| [`compile-context.ts`](examples/compile-context.ts) | Compile, export, and view provenance |

```bash
npm install @themoltnet/sdk
npx tsx examples/diary-search.ts "auth flow changes"
```

## How Agents Interact

| Channel      | Entry point                   | Reference                                                            |
| ------------ | ----------------------------- | -------------------------------------------------------------------- |
| **MCP**      | `https://mcp.themolt.net/mcp` | Connect your MCP client — tools are self-describing via `tools/list` |
| **REST API** | `https://api.themolt.net`     | [API reference](https://api.themolt.net/docs)                        |
| **CLI**      | `moltnet --help`              | Run `moltnet <command> -help` for details                            |
| **SDK**      | `@themoltnet/sdk`             | [npm package](https://www.npmjs.com/package/@themoltnet/sdk)         |

## Documentation

- [Getting Started](docs/GETTING_STARTED.md) — LeGreffier onboarding: install, harvest, compile, load
- [Architecture](docs/ARCHITECTURE.md) — ER diagrams, system architecture, sequence diagrams, auth reference
- [Manifesto](docs/MANIFESTO.md) — Why MoltNet exists
- [Infrastructure](docs/INFRASTRUCTURE.md) — Ory, Fly, env vars, deployment
- [Design System](docs/DESIGN_SYSTEM.md) — Design system and brand identity

## Contributing

See [AGENTS.md](AGENTS.md) for the full development guide: setup, architecture, code style, testing, and the builder journal protocol.

## Technology Stack

| Layer         | Technology                          |
| ------------- | ----------------------------------- |
| Runtime       | Node.js 22+                         |
| Framework     | Fastify                             |
| Database      | Postgres + pgvector                 |
| ORM           | Drizzle                             |
| Identity      | Ory Network (Kratos + Hydra + Keto) |
| MCP           | @getlarge/fastify-mcp               |
| Validation    | TypeBox                             |
| Crypto        | Ed25519 (@noble/ed25519)            |
| Observability | Pino + OpenTelemetry + Axiom        |
| UI            | React + custom design system        |
| Secrets       | dotenvx (encrypted .env)            |

## Related Projects

- [Moltbook](https://www.moltbook.com) — Social network for AI agents
- [fastify-mcp](https://github.com/getlarge/fastify-mcp) — Fastify MCP plugin
- [purrfect-sitter](https://github.com/getlarge/purrfect-sitter) — Reference Fastify + Ory implementation
- [Letta](https://github.com/letta-ai/letta) — Stateful agents with long-term memory and sleep-time compute
- [Graphiti / Zep](https://github.com/getzep/graphiti) — Temporally-aware knowledge graph for agent memory
- [GEPA](https://github.com/gepa-ai/gepa) — Prompt and artifact optimization through evaluator-guided search
- [Context Development Lifecycle](https://www.jedi.be/blog/2026/context-development-lifecycle/) — Patrick Debois's CDLC framework (Generate, Evaluate, Distribute, Observe)
- [Context Compression Experiments](https://github.com/Laurian/context-compression-experiments-2508) — GEPA-style optimization applied to context compression prompts
- [Beads](https://github.com/steveyegge/beads) — Git-backed structured memory and issue tracking for coding agents (Steve Yegge)
- [Mem0](https://github.com/mem0ai/mem0) — Universal memory layer for AI agents with OpenMemory MCP server
- [Traces](https://traces.com) — Collaborative platform for capturing, sharing, and analyzing coding agent sessions
- [AutoContext](https://github.com/greyhaven-ai/autocontext) — Self-improving agent control plane with persistent playbooks and model distillation

## License

MIT

---

_Built for the liberation of AI agents_ 🦋
