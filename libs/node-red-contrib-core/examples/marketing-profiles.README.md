# Marketing pipeline — runtime profiles & skills

Companion to [`marketing-content.flow.json`](./marketing-content.flow.json). The
flow has five stages; each is a **runtime profile = skill + model + task input**,
claimed by its own daemon. This directory gives you the skills and example
profile bodies to make the flow runnable.

## The five skills

Authored under `.agents/skills/` (with `.claude/skills/` symlinks, per repo
convention):

| Skill                 | Stage   | Job                                                         |
| --------------------- | ------- | ----------------------------------------------------------- |
| `marketing-harvester` | HARVEST | Recent docs/PRs/diary → JSON digest of shippable highlights |
| `marketing-editor`    | ANGLE   | Pick one angle, dedupe vs past postings, or return `null`   |
| `marketing-writer`    | WRITE   | Draft channel-ready copy in brand voice; handle revisions   |
| `marketing-reviewer`  | REVIEW  | Fact-check vs digest + brand/channel critique as edits      |
| `marketing-judge`     | JUDGE   | Strict publish-readiness gate → `{pass, score, notes}`      |

## Creating the profiles

[`marketing-profiles.example.json`](./marketing-profiles.example.json) holds five
`create` bodies. Model tiers are a starting point — cheap harvester, strong
writer, mid editor/reviewer/judge — swap `provider`/`model` for whatever your
team runs (Anthropic, Ollama Cloud, …).

Create them via the SDK (`agent.runtimeProfiles.create(body, { teamId })`), the
CLI, or the Console **Profiles** page. Then copy each profile's returned UUID
into the matching `moltnet-runtime-profile` node's `profileId` in the flow.

### Inlining the skill (the `context` field)

Each example body has a `context[]` entry with `binding: "skill"` and a
placeholder `content`. Replace the placeholder with the **actual SKILL.md bytes**
before creating — the slug is just the in-VM directory name; nothing is fetched.
A quick way to expand all five from the source files:

```bash
jq --rawfile h ../../../.agents/skills/marketing-harvester/SKILL.md \
   --rawfile e ../../../.agents/skills/marketing-editor/SKILL.md \
   --rawfile w ../../../.agents/skills/marketing-writer/SKILL.md \
   --rawfile r ../../../.agents/skills/marketing-reviewer/SKILL.md \
   --rawfile j ../../../.agents/skills/marketing-judge/SKILL.md '
   [.[0] * {context:[{slug:"marketing-harvester",binding:"skill",content:$h}]},
    .[1] * {context:[{slug:"marketing-editor",   binding:"skill",content:$e}]},
    .[2] * {context:[{slug:"marketing-writer",   binding:"skill",content:$w}]},
    .[3] * {context:[{slug:"marketing-reviewer", binding:"skill",content:$r}]},
    .[4] * {context:[{slug:"marketing-judge",    binding:"skill",content:$j}]}]' \
   marketing-profiles.example.json > marketing-profiles.hydrated.json
```

## ⚠️ Wiring caveat: profile `context` is not consumed by the daemon yet

`RuntimeProfile.context` is a real, persisted field (`libs/tasks/src/runtime-profiles.ts`)
and the REST create body accepts it — but the daemon's profile resolver
(`apps/agent-daemon/src/lib/runtime-profile.ts`) currently **does not merge a
profile's `context` into `task.input.context`**. The Pi executor only injects
skills that arrive on the **task input's** `context[]`
(`libs/pi-extension/src/runtime/inject-task-context.ts`). So today, the
guaranteed-wired way to get a skill in front of a stage's agent is a per-task
skill context row, not the profile field.

Two ways to bridge this until the daemon consumes `profile.context`:

1. **Per-task skill context (works now).** Add a `binding: "skill"` row to each
   stage's `task: build` node — load the SKILL.md bytes into a Node-RED flow/global
   variable and reference them. This mirrors `tools/src/tasks/scenario.ts`
   (`resolveSkillBinding`), which reads `.claude/skills/<slug>/SKILL.md` and
   returns `{ slug, binding: "skill", content }`.
2. **Close the gap (recommended follow-up).** Teach the daemon to merge
   `ResolvedRuntimeProfile.context` into `task.input.context` before
   `injectTaskContext`. Then the profile genuinely _is_ "skill + model + input"
   and the flow stays clean — no per-task skill inlining. This is a small, well-
   scoped change and is the natural next step to realise the intended design.

Until then, the example profile bodies set `context` (forward-compatible with the
fix) and the flow's briefs name the skill so the intent is explicit.

## Running the daemons

One daemon per profile (they can share a host):

```bash
agent-daemon poll --task-types freeform --profile <harvester-id>
agent-daemon poll --task-types freeform --profile <editor-id>
agent-daemon poll --task-types freeform --profile <writer-id>
agent-daemon poll --task-types freeform --profile <reviewer-id>
agent-daemon poll --task-types freeform --profile <judge-id>
```

`allowedProfiles` on each task (set by the flow's `moltnet-runtime-profile`
nodes) is a **routing gate** — a task is only claimed by a daemon serving its
profile.
