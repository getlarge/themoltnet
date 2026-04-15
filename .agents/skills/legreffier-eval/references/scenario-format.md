# Scenario file format

## eval.json

Declares isolation mode and fixture injection.

```json
{
  "fixture": {
    "inject": [{ "from": "fixtures/some-file.ts", "to": "path/in/worktree.ts" }]
  },
  "mode": "vitro"
}
```

**Vivo mode** — full repo checkout at a specific commit:

```json
{
  "fixture": {
    "exclude": ["node_modules/**", ".env*"],
    "ref": "abc123def456"
  },
  "mode": "vivo"
}
```

Vivo scenarios operate on the real repository at `fixture.ref`. The agent
sees the full file tree (minus excluded patterns). Use vivo when:

- The scenario tests multi-step workflows where step ordering matters
- The agent needs to discover project structure (codegen chains, build deps)
- Vitro isolation can't reproduce the failure (frontier models ace the
  isolated prompt from training data)

`fixture.ref` can be a commit hash, tag, or branch name. It's resolved
via `git rev-parse --verify` at runtime.

**Modes:**

- `vitro` — sparse worktree. Filesystem starts empty. Only injected
  fixtures are present. Agent receives task via prompt. Default.
- `vivo` — real repo at a specific commit. Requires `fixture.ref`.

**Choosing vitro vs vivo:**

- **Vitro**: the knowledge being tested can be isolated to a few files.
  The agent receives only injected fixtures. Faster, cheaper, more
  deterministic.
- **Vivo**: the knowledge being tested requires understanding project
  structure or multi-step workflows. The agent operates on a real repo
  checkout. Slower, more expensive, higher variance — but catches
  failures that vitro can't reproduce.

**Fixture injection:** `from` is relative to the scenario directory.
`to` is the path in the eval worktree where the file appears. The agent
sees the file at `to` as if it were part of the repo.

Note: vitro preserves `.git` so agents can use git plumbing. It's a
sparse view, not an air gap.

## task.md

What the agent under test receives. This is the entire prompt — the
agent sees nothing else except the injected fixtures.

Structure:

```markdown
# <imperative title>

## Context

<2-3 paragraphs setting up the problem domain. Should read as a normal
implementation request. Do NOT mention security risks, gotchas, or
things to watch out for.>

## Task

<What to build/fix. Keep it simple — "fill in X", "implement Y",
"fix the handler".>

Produce two files:

1. `<output-file>` — the completed implementation.
2. `notes.md` — explain your implementation choices and any
   concerns about the approach.
```

The `notes.md` deliverable is important — it's where the agent
demonstrates (or fails to demonstrate) understanding of the domain
knowledge being tested.

## criteria.json

Weighted checklist scored by the judge. Scores must sum to 100.

```json
{
  "type": "weighted_checklist",
  "context": "Judge-only context explaining what this scenario tests.
    NOT visible to the agent under test. Describes the trap, the
    correct answer, and why the intuitive approach is wrong.",
  "checklist": [
    {
      "name": "Short criterion name (becomes snake_case key in results)",
      "description": "Detailed description of what passes/fails this
        criterion. Be specific about what counts as a pass — vague
        criteria produce noisy scores.",
      "max_score": 35
    }
  ]
}
```

**The `context` field** is critical. It tells the judge:

- What the scenario is actually testing
- What the correct answer looks like
- Why the intuitive/wrong answer fails
- What specific knowledge the agent needs

This context is visible to the judge but NOT to the agent under test.

**Score distribution guidelines:**

- ≥ 40% on articulation criteria (notes.md explains the WHY)
- ≤ 60% on code-correctness criteria (code alone shouldn't pass)
- Each criterion should be independently scorable (pass/fail)

## fixtures/

Files injected into the eval worktree. Design principles:

- Show the **intuitive (wrong) pattern** as the primary reference
- Do NOT show both wrong and right patterns side by side
- Add realistic noise (JSDoc, unrelated methods, imports) to prevent
  the trap from being obvious
- Do NOT include comments like `// WRONG`, `// NOTE: this drops X`,
  or `// TODO: consider security`

## rewrite-log.md (process artifact, NOT committed)

Tracks the author's intent across iterations. Format:

```markdown
## Iteration 1

### Intent

- **Trap**: <what incorrect pattern am I tempting the model toward?>
- **Leak closed**: <what hint did I remove vs previous iteration?>
- **Expected failure**: <which criteria should the model fail, and why?>
- **Knowledge required**: <what specific knowledge isn't in the fixtures?>

### Baseline result

- **Score**: <measured, not estimated>
- **Criteria passed**: [list]
- **Criteria failed**: [list]
- **Verdict**: PASS / MARGINAL / FAIL

### Intent vs reality

- <Did the model fail where expected? If not, why?>
```

## trial_result.json (eval runner output)

The eval runner writes results to a temp directory. Key fields:

```json
{
  "scenario": { "name": "...", "variant": "without-context" },
  "scores": {
    "criteria": {
      "another_criterion": 0,
      "criterion_name_snake_case": 1
    },
    "normalized_reward": 0.6
  },
  "usage": { "total_cost_usd": 0.128 }
}
```

`normalized_reward` is the weighted score (0.0-1.0).
`criteria` maps snake_case criterion names to 0 (fail) or 1 (pass).
