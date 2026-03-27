# MoltNet Harbor Evals

Eval tasks for [Harbor](https://github.com/harbor-framework/harbor), auto-scaffolded
from tile eval definitions in `tiles/moltnet-practices/evals/`.

## Prerequisites

```bash
uv tool install harbor
```

## Scaffold tasks

```bash
pnpm eval:scaffold
```

Reads `tiles/moltnet-practices/evals/*/` and generates `harbor/tasks/` with two
variants per eval:

- `<name>` — no context injected
- `<name>-with-context` — tile docs injected as `.claude/CLAUDE.md`

## Run evals

```bash
# Single task
pnpm eval:run -t mcp-format-uuid-validation

# Multiple tasks
pnpm eval:run -t mcp-format-uuid-validation -t codegen-chain-go-client

# All tasks with concurrency
pnpm eval:run -c 2

# Different model
pnpm eval:run -m anthropic/claude-haiku-4-5

# Force Docker rebuild (after pulling new base image)
pnpm eval:run -t mcp-format-uuid-validation -f
```

Run `pnpm eval:run --help` for all options.

## Authentication

Export one of these in your shell before running:

- `CLAUDE_CODE_OAUTH_TOKEN` — Claude OAuth token (preferred)
- `ANTHROPIC_API_KEY` — standard API key

## Structure

```
harbor/
├── run.ts               # CLI wrapper
├── scaffold.ts          # Generates tasks from tile evals
├── agents/              # Custom Harbor agent (PYTHONPATH=harbor)
├── judge/               # TypeScript judge (kept for future Agent SDK use)
└── templates/           # task.toml, Dockerfile, test.sh
```
