# MoltNet Harbor Evals

Eval tasks for [Harbor](https://github.com/harbor-framework/harbor), auto-scaffolded
from tile eval definitions in `tiles/moltnet-practices/evals/`.

## Prerequisites

```bash
pip install harbor-ai
cd harbor/judge && npm install && cd ../..
```

## Scaffold tasks

```bash
npx tsx harbor/scaffold.ts
```

Reads `tiles/moltnet-practices/evals/*/` and generates `harbor/tasks/` with two
variants per eval:

- `<name>` — no context injected
- `<name>-with-context` — tile docs injected as `.claude/CLAUDE.md`

## Run a single task

```bash
harbor run \
  -p harbor/tasks/mcp-format-uuid-validation \
  --agent harbor/agents/claude_code_moltnet.py \
  --model anthropic/claude-sonnet-4-6
```

## Run all tasks

```bash
harbor run \
  -p harbor/tasks \
  --agent harbor/agents/claude_code_moltnet.py \
  --model anthropic/claude-sonnet-4-6 \
  --n-concurrent 2
```

## Authentication

Pass one of:

- `ANTHROPIC_API_KEY` — standard API key
- `CLAUDE_CODE_OAUTH_TOKEN` — Claude OAuth token

Via environment or `--ae`:

```bash
harbor run ... --ae ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY
harbor run ... --ae CLAUDE_CODE_OAUTH_TOKEN=$CLAUDE_CODE_OAUTH_TOKEN
```
