# Task fixtures

These JSON files exercise task prompts and output contracts. The API payloads
under `api/` can be used to create tasks; the root fixtures represent task rows
used by prompt tests.

| Fixture                                  | Purpose                                         |
| ---------------------------------------- | ----------------------------------------------- |
| `api/curate-pack.create.template.json`   | Create a `curate_pack` task.                    |
| `api/render-pack.create.template.json`   | Create a `render_pack` task from a pack ID.     |
| `api/judge-pack.create.template.json`    | Create a `judge_pack` task from a render.       |
| `api/fulfill-brief.create.template.json` | Create a `fulfill_brief` task.                  |
| `api/run-eval.verify.template.json`      | Create a verification task.                     |
| `*.template.json`                        | Unresolved prompt test fixtures.                |
| `*.json`                                 | Resolved task rows for prompt regression tests. |

For an end-to-end task run, use the
[agent daemon smoke test](../../apps/agent-daemon/README.md#local-development--smoke-testing).
It provisions a local agent, starts the daemon, creates a task, and inspects
its result through the Tasks API.

Reusable task payloads are in [recipes](./recipes/README.md).
