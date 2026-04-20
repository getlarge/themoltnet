# Author subagent prompt template

Use this template when spawning the AUTHOR subagent. Fill in the
bracketed values.

---

## For new scenarios

```
You are writing an eval scenario that tests whether a model has
specific project knowledge. The scenario must be a gap-test: the
model should perform poorly without context and well with it.

Read these files first:
- {path_to_gap_test_principles} — the five design principles
- {path_to_scenario_format} — file format reference
- {path_to_gold_standard}/task.md — gold standard example (task)
- {path_to_gold_standard}/criteria.json — gold standard example (criteria)
- {path_to_gold_standard}/fixtures/ — gold standard example (fixtures)

The knowledge gap you're testing:
{description_of_the_domain_knowledge_the_model_should_lack}

Source material (diary entries, incident reports, or codebase patterns
that contain the knowledge):
{source_entry_ids_or_file_paths}

Write the scenario files in: {scenario_directory_path}

You MUST:
1. Write an intent declaration FIRST (in rewrite-log.md) before any
   scenario files. Declare: trap, expected failure, knowledge required.
2. Follow all five gap-test design principles.
3. Make task.md read as a normal implementation request — no hints.
4. Ensure criteria score distribution: ≥40% articulation, ≤60% code.

You MUST NOT:
- Run any eval commands ($MOLTNET_CLI eval run, etc.)
- Estimate or project what the baseline score will be
- Include "security", "careful", "note that", or "watch out" in task.md
- Show both wrong and right patterns in fixtures
```

## For rewrites (iteration N+1)

```
You are rewriting an eval scenario that scored too high on baseline
(model already knew the answer without context).

Previous iteration score: {score_as_percentage}
(You are NOT given which criteria passed or failed — this is intentional.
Reverse-engineering the judge's scoring would defeat the purpose.)

Read these files:
- {path_to_gap_test_principles} — the five design principles
- {scenario_directory_path}/rewrite-log.md — your previous intent log
- {scenario_directory_path}/task.md — current task (to rewrite)
- {scenario_directory_path}/criteria.json — current criteria (to rewrite)
- {scenario_directory_path}/fixtures/ — current fixtures (to rewrite)

The model scored {score_as_percentage} without any project context.
Your job is to make the scenario harder by closing information leaks,
not by making the task more complex.

Common leaks to check:
- Does task.md mention the gotcha or name the fix?
- Do the fixtures show both wrong and right patterns?
- Can criteria be satisfied by reading the fixtures alone?
- Does criteria context describe the exact correct answer?

Write your changes to the same directory. Update rewrite-log.md with
a new "## Iteration {N}" section.

You MUST NOT:
- Run any eval commands
- Estimate what the new baseline will be
- Access the previous trial_result.json or criteria breakdown
```

## Key constraint

The author subagent must NEVER see which criteria passed or failed in
previous iterations. It receives only the aggregate score. This prevents
the author from surgically "fixing" specific criteria instead of
genuinely rethinking the scenario design.
