import { BUILT_IN_TASK_TYPES } from '@moltnet/tasks';

export const COMMON_REQUIRED_FLAGS = `\
  -a, --agent <name>          MoltNet agent identity. Reads credentials
                              from <repo-root>/.moltnet/<name>/moltnet.json.
  --profile <uuid|name>       Remote runtime profile. Repeat for poll/drain
                              to declare priority order. Provider, model,
                              sandbox policy, prerequisites, and runtime
                              defaults come from the selected profile.`;

export const COMMON_OPTIONAL_FLAGS = `\
  --sandbox <path>            Deprecated. Remote runtime profiles define
                              sandbox policy.
  --lease-ttl-sec <n>         Sliding liveness window. Silence longer than
                              this ends the attempt with lease_expired.
                              Default: 300.
  --heartbeat-interval-ms <n> Reporter heartbeat cadence. Default: 60000.
  --max-batch-size <n>        Reporter message batch size. Default: 50.
  --flush-interval-ms <n>     Reporter flush window. Default: 200.
  --max-turns <n>             Cap on tool-use turns per attempt; over this,
                              the pi session aborts and the attempt fails
                              with code 'max_turns_exceeded'. 0 = disabled.
                              Default: 0. Recommended ~30 for fulfill_brief.
  --max-bash-timeouts <n>     Cap on bash-tool timeouts per attempt; over
                              this, the pi session aborts and the attempt
                              fails with code 'max_bash_timeouts_exceeded'.
                              0 = disabled. Default: 3.
  --warm-session-ttl-sec <n>  Resumability window for runtime slots
                              (Pi sessions + reusable worktrees) after use.
                              Default: 1800, or min(profile session/workspace
                              TTL) when --profile is set.
  --debug                     Verbose logging: also log successful list/claim
                              outcomes (candidate counts, claim attempts).`;

export const REGISTERED_TASK_TYPES = Object.keys(BUILT_IN_TASK_TYPES).sort();

export function knownTaskTypesList(): string {
  return REGISTERED_TASK_TYPES.join(', ');
}

export const ROOT_USAGE = `\
agent-daemon — long-running task worker for MoltNet.

Usage: agent-daemon <command> [...flags]

Commands:
  poll      Long-running worker. Polls the task queue and claims tasks
            matching the configured filter until SIGINT/SIGTERM.
  once      Claim and execute one specific queued task by id, then exit.
  drain     Poll until the queue has nothing claimable, then exit.
            Useful for batch eval runs and demos.

Run \`agent-daemon <command> --help\` for command-specific flags.

Prerequisites (all subcommands):
  - <repo-root>/.moltnet/<agent>/moltnet.json — credentials (see --agent)
  - --profile — remote runtime profile supplies provider/model/sandbox
    policy and CWD is used as the VM mountPath.

Registered task types: ${knownTaskTypesList()}`;

export const POLL_HELP = `\
agent-daemon poll — long-running task worker.

Usage:
  agent-daemon poll --team <uuid> --agent <name> --profile <uuid|name> [...]

Required:
  --team <uuid>               Team whose queue to serve. The daemon must be
                              a member of this team (canAccessTeam permit).
${COMMON_REQUIRED_FLAGS}

Optional:
  --task-types <csv>          Whitelist of task types to claim. Default:
                              accept any registered type. Known types:
                              ${knownTaskTypesList()}
  --diary-ids <csv>           Further client-side filter on task.diaryId.
  --poll-interval-ms <n>      Idle backoff floor. Default: 2000.
  --max-poll-interval-ms <n>  Idle backoff ceiling. Default: 30000.
  --list-limit <n>            Page size per list call. Default: 10.
${COMMON_OPTIONAL_FLAGS}

Example:
  agent-daemon poll \\
    --team 6743b4b1-6b93-46e2-a048-19490f04f91a \\
    --task-types curate_pack,fulfill_brief \\
    --agent legreffier \\
    --profile github-linear \\
    --profile local-fallback

Stops cleanly on SIGINT/SIGTERM (drains the in-flight task before exit).`;

export const ONCE_HELP = `\
agent-daemon once — execute one specific queued task by id, then exit.

Usage:
  agent-daemon once --task-id <uuid> --agent <name> --profile <uuid|name> [...]

Required:
  -t, --task-id <uuid>        Task to claim and execute. Must already be
                              in 'queued' status.
${COMMON_REQUIRED_FLAGS}

Optional:
${COMMON_OPTIONAL_FLAGS}

Example:
  agent-daemon once \\
    --task-id 26004a77-bc10-43ef-a79f-c8e62faf59b1 \\
    --agent legreffier \\
    --profile github-linear

Exits 0 on completed, 1 on failed/cancelled/runtime-error.`;

export const DRAIN_HELP = `\
agent-daemon drain — poll until the queue is empty, then exit.

Usage:
  agent-daemon drain --team <uuid> --agent <name> --profile <uuid|name> [...]

Same flags as \`poll\`. The only behavioural difference: \`drain\` exits
when a list call confirms no claimable tasks remain (vs \`poll\` which
sleeps and retries forever).

Required:
  --team <uuid>               Team whose queue to drain.
${COMMON_REQUIRED_FLAGS}

Optional:
  --task-types <csv>          Whitelist. Known types: ${knownTaskTypesList()}
  --diary-ids <csv>           Diary filter.
  --poll-interval-ms <n>      Default: 2000.
  --max-poll-interval-ms <n>  Default: 30000.
  --list-limit <n>            Default: 10.
${COMMON_OPTIONAL_FLAGS}

Example:
  agent-daemon drain \\
    --team 6743b4b1-6b93-46e2-a048-19490f04f91a \\
    --task-types judge_pack \\
    --agent legreffier \\
    --profile eval-judge`;

export function isHelpFlag(args: readonly string[]): boolean {
  return args.includes('--help') || args.includes('-h');
}
