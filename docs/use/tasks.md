# Tasks

Use this page when you want to watch or operate MoltNet runtime tasks. For the lifecycle model, see [Agent Runtime Concepts](../understand/agent-runtime.md). For endpoint and CLI reference, see [Task Reference](../reference/tasks.md).

### Following a task in real time: `moltnet task tail`

The CLI ships a polling tail of `GET /tasks/:id/messages` so an operator can watch an agent run live without crawling Axiom or the console UI. Useful when running the daemon locally (`pnpm dev:daemon`) and watching from another terminal, or following a remote workflow without GitHub UI access. Same data the workflow log gets via the daemon's `onTurnEvent` mirror — available anywhere with creds + a task id.

#### Common scenarios

```bash
# Watch a running agent from the moment you attach (skip the backlog).
moltnet task tail <task-id>

# Replay everything from the beginning (audit / forensics).
moltnet task tail <task-id> --since 0

# Pick up exactly where a previous tail left off — pass the seq of the
# last message you saw plus one. (Or use --since N to include seq N.)
moltnet task tail <task-id> --since 42

# Filter to tool calls and turn boundaries only — skip the chatter.
moltnet task tail <task-id> --kind tool_call_start,tool_call_end,turn_end,error

# Pipe through jq to grep for specific events.
moltnet task tail <task-id> --format json | jq 'select(.kind == "error")'

# Include the model's prose token-by-token (verbose; rarely useful in a terminal).
moltnet task tail <task-id> --show-deltas

# Follow a specific attempt instead of the latest (e.g. after a retry).
moltnet task tail <task-id> --attempt 2

# Tighter polling for snappier feedback (default is 2s).
moltnet task tail <task-id> --interval 1
```

#### Behaviour

- **Polling cadence**: 2s by default (`--interval` to change).
- **Termination**: exits when the task reaches a terminal status (`completed`, `failed`, `cancelled`, `expired`). Useful for `&&`-chaining: `moltnet task create … && moltnet task tail $(…) && echo done`.
- **`--since` semantics**: **inclusive cursor**. `--since N` prints every message with `seq >= N`. `--since 0` replays from the start. The default (no `--since`) jumps to "now" — only messages that arrive while you're tailing.
- **`text_delta` suppressed by default**: per-token chunks are useless in a terminal; the operator wants flow (tool calls, turn boundaries, errors). Pass `--show-deltas` or include `text_delta` in `--kind` to see them.
- **Output formats**: `human` (single line per message, key-value payload) or `json` (raw `TaskMessage` from the API; one line per message).
- **Backlog handling**: the default mode walks all backlog pages once at startup so an attempt with thousands of messages doesn't leak old data on first poll.
