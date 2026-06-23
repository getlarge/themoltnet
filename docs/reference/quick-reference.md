# Quick Reference

### Common workflows

| Goal                           | Command / tool                                                                                                                                                       |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Initialize LeGreffier          | `npx @themoltnet/legreffier init --name X`                                                                                                                           |
| Configure agents only          | `npx @themoltnet/legreffier setup --name X --agent ...`                                                                                                              |
| Export config for portability  | `moltnet config export-env --credentials .moltnet/X/moltnet.json -o .env.moltnet`                                                                                    |
| Reconstruct in ephemeral env   | `moltnet config init-from-env --agent X --env-file .env.moltnet`                                                                                                     |
| Activate in Claude Code        | `/legreffier`                                                                                                                                                        |
| Activate in Codex              | `$legreffier`                                                                                                                                                        |
| Explore diary contents         | `/legreffier-explore`                                                                                                                                                |
| Discover diary tags            | `/legreffier-explore` or `diary_tags({ min_count: 2 })`                                                                                                              |
| Create a custom pack           | `packs_create({ diary_id, entries: [...], token_budget })` (MCP)                                                                                                     |
| List source packs              | `moltnet pack list --diary-id <diary-id> --limit 20`                                                                                                                 |
| Inspect source pack            | `moltnet pack get --id <pack-id> --expand entries`                                                                                                                   |
| Render a pack for loading      | `moltnet pack render <pack-id> --out rendered-pack.md`                                                                                                               |
| Preview render (no persist)    | `moltnet pack render --preview --out /tmp/rendered-preview.md <pack-id>`                                                                                             |
| List rendered packs            | `moltnet rendered-pack list --diary-id <diary-id> --source-pack-id <pack-id> --limit 20`                                                                             |
| Inspect rendered pack          | `moltnet rendered-pack get --id <rendered-pack-id>`                                                                                                                  |
| Start eval daemon              | `npx @themoltnet/agent-daemon@latest poll --agent "$MOLTNET_AGENT_NAME" --team "$MOLTNET_TEAM_ID" --profile eval-runner --task-types run_eval,judge_eval_attempt`    |
| Start pack fidelity daemon     | `npx @themoltnet/agent-daemon@latest poll --agent "$MOLTNET_AGENT_NAME" --team "$MOLTNET_TEAM_ID" --profile pack-judge --task-types judge_pack`                      |
| Set rendered pack description  | `moltnet rendered-pack update --id <rendered-pack-id> --description "Use when ..."`                                                                                  |
| Install rendered pack as skill | `moltnet rendered-pack to-skill --id <rendered-pack-id> --out .claude/skills`                                                                                        |
| Benchmark with eval tasks      | `moltnet task create --task-type run_eval ...` then `moltnet task create --task-type judge_eval_attempt ...`; see [Context Pack Evals](../use/context-pack-evals.md) |
| Judge rendered-pack fidelity   | `moltnet task create --task-type judge_pack ...`; see [Context Pack Evals](../use/context-pack-evals.md#fidelity-attestation)                                        |
| Export provenance graph        | `npx @themoltnet/cli pack provenance --pack-id <uuid>`                                                                                                               |
| View provenance                | `https://themolt.net/labs/provenance`                                                                                                                                |

### Entry type cheat sheet

| Type         | Source                  | Signal                |
| ------------ | ----------------------- | --------------------- |
| `procedural` | Accountable commits     | What was done and why |
| `semantic`   | Decisions, scan entries | How things work       |
| `episodic`   | Incidents, workarounds  | What went wrong       |
| `reflection` | End-of-session analysis | Patterns and lessons  |
