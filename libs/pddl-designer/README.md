# PDDL designer (experimental)

Turns a natural-language process description into a typed planning domain,
renders it as PDDL, and checks it with a planner. Each extraction stage is a
contracted `freeform` MoltNet task, so the model returns structured data through
the validated submit tool instead of free text.

The design follows Acitelli et al., "Generating Domain Models for Automated
Planning from Natural Language Descriptions" (CAI 2026,
[code](https://github.com/giacomo1096/NL2PDDL)), with three changes found by
reproducing that pipeline:

| Paper                                                         | This library                                                                                                      |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| BAML classes; preconditions and effects as free-text strings  | TypeBox schemas sent as `outputContract`; preconditions and effects are typed atoms                               |
| An LLM stage writes the PDDL text                             | `render.ts` renders PDDL from the typed result, deterministically                                                 |
| Evaluation by an LLM judge and experts; syntax check with VAL | `check.ts` runs cross-stage checks after every stage, and `planner.ts` searches for a plan on the combined result |

The planner check matters because every stage can return a schema-valid result
while the domain is still wrong. In the reproduction, the generated problem
declared no objects of the types the actions produce, so the goal was
unreachable. With those objects added, the shortest plan merged a second issue
by reusing the first issue's pull request and approval.

## Stages

| Stage        | Returns                                                  | Checked by                                                                              |
| ------------ | -------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `types`      | Types, each with an optional parent                      | Undefined parents, cycles, the reserved root `object`                                   |
| `predicates` | Facts with typed parameters                              | Unknown parameter types, duplicates                                                     |
| `actions`    | Draft actions: parameters, preconditions, adds, deletes  | Unknown predicates, arity, non-parameter arguments, type mismatches                     |
| `refine`     | Complete action list and one line per change             | Same as `actions`; warns about facts that no action deletes                             |
| `problem`    | Objects, initial facts, and goal for the given situation | Undeclared objects, and actions whose parameter type has no object (they can never run) |

A result with errors gets one correction task listing the exact problems
(`--max-corrections`, default 1). Warnings from the draft actions are passed to
the refine stage as hints. After the last stage, the planner grounds every
action with the problem's objects and runs breadth-first search, so a plan it
finds is a shortest one.

## Output

`runPddlDesign` returns a `DesignRun` record:

- `status`: `planned`, `unsolvable`, `search_limit`, `invalid` (a stage still failed its checks after corrections), or `failed` (a task failed)
- `stages[]`: per attempt, the task id, the brief sent, the typed result, the findings, and the duration
- `domain`, `problem`: the typed IR
- `domainPddl`, `problemPddl`: the rendered PDDL
- `refinements`: what the refine stage reports changing
- `grounding[]`: concrete action count per action, and the parameter types with no objects
- `plan`: the steps, or why no plan was found
- `issues`: warnings left on the final domain and problem

A UI can render this record directly.

## Limits

- The supported fragment is STRIPS with typing and negative preconditions. There are no quantifiers, conditional effects, or numeric fluents.
- The built-in planner is a checker for small models. Its default limits are 50,000 concrete actions and 200,000 states. For larger models, give the rendered PDDL to Fast Downward.
- The output contract cannot carry `pattern`, so naming rules are checked by the stage parsers after the daemon accepts a result. A naming error fails that stage's task outcome; it does not trigger a correction.

## Runtime profile

`.github/runtime-profiles/legreffier-pddl-designer-v1.json` is input-only. It
has no workspace and no network, and it binds the empty tool policy
`.github/runtime-policies/legreffier-pddl-designer-input-only-v1.json`. Its
`pddl-modeling` skill carries the modeling rules shared by all stages. Each task
brief carries that stage's instructions and the earlier results.

The definitions are not applied automatically. Create them with the released
CLI:

```bash
moltnet policy create --from-file .github/runtime-policies/legreffier-pddl-designer-input-only-v1.json --team-id "$TEAM"
moltnet profile create --from-file .github/runtime-profiles/legreffier-pddl-designer-v1.json --team-id "$TEAM"
moltnet profile set-policies legreffier-pddl-designer-v1 --policy legreffier-pddl-designer-input-only-v1 --team-id "$TEAM"
moltnet profile allowed-tools legreffier-pddl-designer-v1 --team-id "$TEAM"
```

## Run

Inspect the first stage's task without creating anything:

```bash
pnpm --silent --dir libs/pddl-designer cli \
  --description examples/issue-workflow/description.md \
  --problem examples/issue-workflow/situation.md --dry-run
```

Run all stages. An agent daemon must be draining `freeform` tasks for the same
team and profile, for example `moltnet-agent drain --profile legreffier-pddl-designer-v1`:

```bash
pnpm --silent --dir libs/pddl-designer cli \
  --description examples/issue-workflow/description.md \
  --problem examples/issue-workflow/situation.md \
  --domain-name issue-workflow --problem-name two-issues \
  --team "$TEAM" --diary "$DIARY" --profile legreffier-pddl-designer-v1 \
  --out run.json
```

The run prints a one-line status on stderr and writes the `DesignRun` to
`--out`.
