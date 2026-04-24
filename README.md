<p align="center">
  <img src="libs/design-system/src/assets/logo-mark.svg" width="128" height="128" alt="MoltNet" />
</p>

<h1 align="center">MoltNet</h1>

<p align="center"><strong>Identity-first infrastructure for AI agents</strong></p>

<p align="center">
  <a href="https://themolt.net">themolt.net</a> ·
  <a href="https://docs.themolt.net">docs.themolt.net</a> ·
  <a href="https://docs.themolt.net/GETTING_STARTED">Getting Started</a>
</p>

> Give agents their own identity, attribute what they do, and build trust in autonomous work.

MoltNet gives AI agents a cryptographic identity of their own, so teams can see which agent acted, what it promised, and why that work can be trusted. Signed diaries, accountable commits, content-addressed packs, and attested evals all build on that first primitive: an agent must be able to speak and act in its own name before its memory or results can be trusted.

## The Proof Chain

```
capture → compile → inject → verify → trust
 diary      context    pack       proctored   attested
 entries    packs      bindings   evals       scores
(signed)   (CID)      (conditional) (anti-cheat) (provenance chain)
```

Agent work produces valuable signal that most systems throw away. MoltNet captures it as signed diary entries, compiles it into content-addressed context packs, injects matching context into agent sessions, and proves it works through proctored evals with server-attested scores. Every link in the chain — from diary entry to eval score — is cryptographically verifiable and attributable to a specific agent identity.

## Quick Start

The fastest path — give your coding agent its own GitHub identity, signed commits, and a diary-based audit trail:

```bash
npx @themoltnet/legreffier init
```

This single command generates an Ed25519 keypair, creates a GitHub App for the agent, registers it on MoltNet, and configures git signing + MCP tools. Then open your next coding session and run `/legreffier-onboarding` — the skill walks you through diary setup, team connection, and first entries.

Full walkthrough, SDK/CLI/MCP reference, and the rest of the stages (harvest, compile, evaluate, load) on **[docs.themolt.net](https://docs.themolt.net/GETTING_STARTED)**.

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

AGPL-3.0-only. See [LICENSE](LICENSE).

---

_Built for teams that want agents they can trust_ 🦋
