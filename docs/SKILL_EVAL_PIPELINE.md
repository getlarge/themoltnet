# Skill Eval Pipeline

Scores how well a Claude Code agent executes a skill, then optionally optimizes the skill text via GEPA.

## Side effects

| What              | Details                                                                                              |
| ----------------- | ---------------------------------------------------------------------------------------------------- |
| Docker containers | 8 containers (Postgres, Ory, REST API, MCP). Ports: 5433, 4434, 4445, 4466-4467, 8080, 8001          |
| Files created     | `.eval-env.json`, `.moltnet/eval-agent/`, `evals/runs/*.md`, `/tmp/gpack-*/` (worktrees, cleaned up) |
| API costs         | ~$0.10-0.50 per eval task (Claude Code). GEPA teacher calls are cheap (~$0.01/trial)                 |
| Diary entries     | Written to local `eval-workspace` diary. Gone when you `docker compose down -v`                      |

## Usage

```bash
# Start e2e stack
COMPOSE_DISABLE_ENV_FILE=true docker compose -f docker-compose.e2e.yaml up -d --build

# Bootstrap eval agent (one-time)
pnpm --filter @moltnet/tools run eval:setup

# Baseline (single task)
pnpm --filter @moltnet/tools run gpack:skill-eval --eval legreffier-commit-fix --baseline --verbose

# Baseline (all Group 1)
pnpm --filter @moltnet/tools run gpack:skill-eval --eval all --baseline

# GEPA optimization
pnpm --filter @moltnet/tools run gpack:skill-eval \
  --eval legreffier-commit-feat,legreffier-commit-fix,legreffier-commit-test \
  --ai-key "$OPENAI_API_KEY" --model gpt-4o-mini --teacher-model gpt-4o --num-trials 5

# Tear down
COMPOSE_DISABLE_ENV_FILE=true docker compose -f docker-compose.e2e.yaml down -v
```

Do **not** use `--` between script name and flags.

## CLI flags

| Flag              | Default           | Description                             |
| ----------------- | ----------------- | --------------------------------------- |
| `--eval`          | required          | Eval name(s), comma-separated, or `all` |
| `--baseline`      | false             | Score once, no optimization             |
| `--ai-key`        | env               | Key for GEPA student/teacher LLMs       |
| `--model`         | auto              | GEPA student model                      |
| `--teacher-model` | none              | GEPA teacher model                      |
| `--claude-model`  | claude-sonnet-4-6 | Model for the eval agent                |
| `--num-trials`    | 8                 | GEPA trials                             |
| `--max-evals`     | 30                | Max metric calls                        |
| `--verbose`       | false             | Per-task progress                       |

## Running from inside Claude Code

Works. Three env vars are stripped automatically by `getRuntimeEnv()`:

- `CLAUDECODE` — nested-session guard
- `CLAUDE_CODE_OAUTH_TOKEN` — causes 401

Hooks are disabled via `settings: { disableAllHooks: true }`.

**The Agent SDK does NOT need `ANTHROPIC_API_KEY`.** It authenticates via macOS keychain.

## Workflow

**Always run baseline before GEPA.** Baseline validates which tasks the agent can complete. GEPA cannot learn from tasks that fail for infrastructure reasons. Only feed passing tasks into optimization.

## Scoring

Scores are 0.0–1.0 based on three tiers:

| Tier         | Weight | What it checks                                                                                                                |
| ------------ | ------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Must-have    | 60%    | Diary entry exists, `MoltNet-Diary:` trailer in commit, trailer ID matches entry                                              |
| Should-have  | 30%    | `accountable-commit` tag, `risk:<level>`, `branch:<branch>`, `entry_type: procedural`, `Task-Group`/`Task-Completes` trailers |
| Nice-to-have | 10%    | Valid signature, complete metadata block                                                                                      |

A score of **0.9** = must+should pass, nice-to-have fails (typically signature — see issue #407).

## GEPA notes

GEPA (Genetic Pareto) from `@ax-llm/ax` optimizes instruction text iteratively.

Training examples are **test cases**, not training data. GEPA calls `adapter.evaluate()` directly with them, so they must contain the full `SkillEvalTask` shape (`baseCommit`, `patchFiles`, etc.). Slim `{ id, taskPrompt }` stubs cause `fatal: invalid reference: undefined`.

## Troubleshooting

**`ENOENT: .eval-env.json`** — run `eval:setup` first.

**Score always 0** — check `~/.claude/debug/` (most recent file). The scorer needs a `MoltNet-Diary:` trailer in the commit AND a diary entry tagged `accountable-commit`.

**`fatal: invalid reference: undefined`** — training examples missing `baseCommit`. Ensure `trainingExamples` maps full task fields.

**Stale worktrees** — `git worktree list` to find orphans from killed runs, `git worktree remove <path>` to clean up.

**GEPA best score 0.000** — all tasks scored 0 across trials. Run baseline first, only feed passing tasks into GEPA.

**Broken symlink warnings** — `settings.local.json` symlink is broken in worktrees. `disableAllHooks: true` should handle it.
