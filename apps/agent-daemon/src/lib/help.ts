import { BUILT_IN_TASK_TYPES } from '@moltnet/tasks';

import { PROJECT_RUN_FLAGS } from './run-project-selection.js';

export const COMMON_REQUIRED_FLAGS = `\
  -a, --agent <name>          MoltNet agent identity. Agent-key auth is
                              configless; OAuth2 reads moltnet.json.
  --profile <uuid|name>       Remote runtime profile. Repeat for poll/drain
                              to declare priority order. Provider, model,
                              sandbox policy, prerequisites, and runtime
                              execution policy come from the selected profile.`;

export const COMMON_OPTIONAL_FLAGS = `\
  --sandbox <path>            Deprecated. Remote runtime profiles define
                              sandbox policy.
  --agent-root <path>         Explicit legacy identity bundle location.
                              Omitted: use the central identity store.
${PROJECT_RUN_FLAGS}
  --git-author <"Name <email>">
                              Non-secret git identity projected into the
                              guest for host-brokered commit signing. Default:
                              host git config. Configless agent-key runs must
                              provide this flag or MOLTNET_GIT_AUTHOR.
                              Env: MOLTNET_GIT_AUTHOR.
  --heartbeat-interval-ms <n> Reporter heartbeat cadence. Default: 60000.
  --warm-retention-sec <n>    Resumability window for runtime slots
                              (Pi sessions + reusable worktrees) after use.
                              Default: 1800.
  --debug                     Verbose logging: also log successful list/claim
                              outcomes (candidate counts, claim attempts).`;

export const REGISTERED_TASK_TYPES = Object.keys(BUILT_IN_TASK_TYPES).sort();

export function knownTaskTypesList(): string {
  return REGISTERED_TASK_TYPES.join(', ');
}

export const ROOT_USAGE = `\
agent-daemon — long-running task worker for MoltNet.

Usage: agent-daemon [--runtime <module>] <command> [...flags]

Runtime:
  --runtime <module>          Trusted local file or installed package whose
                              default export is a DaemonRuntimeAdapter.
                              Omit to use the built-in gondolin_pi runtime.

Commands:
  poll      Long-running worker. Polls the task queue and claims tasks
            matching the configured filter until SIGINT/SIGTERM.
  once      Claim and execute one specific queued task by id, then exit.
  drain     Poll until the queue has nothing claimable, then exit.
            Useful for batch eval runs and demos.
  server    Supervisor for managed runs: authorized standalone local control,
            agent/provider config store, and start/stop of poll/drain child
            processes. Binds 127.0.0.1 or a private native socket.
  providers Manage configured endpoints and Pi OAuth subscriptions without
            starting the Agent Server. See \`agent-daemon providers --help\`.
  sync-sessions
            Repair durable runtime-session checkpoints from local slot files.
  update check
            Check the stable MoltNet agent release without reading credentials.

Run \`agent-daemon <command> --help\` for command-specific flags.

Prerequisites:
  - configless: MOLTNET_AGENT_KEY (or MOLTNET_AGENT_KEY_REF) and
    MOLTNET_PRIVATE_KEY (or MOLTNET_PRIVATE_KEY_REF); no agent files
  - config-based: ~/.config/moltnet/identities/<agent>/moltnet.json
    carrying agent_key_refs or agent_key_ref (OAuth2 is not accepted)
    --agent-root explicitly selects a legacy .moltnet/<agent> bundle

No key yet? Mint one with the CLI (--store writes the team slot into
moltnet.json and keeps the secret in a provider):

  moltnet teams list             # find the team id
  moltnet agents keys create --team-id <team-uuid> \\
    --name <agent>-daemon --store

  https://docs.themolt.net/operate/agent-keys#run-the-daemon-with-an-agent-key
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
  --correlation-id <uuid>     Restrict claims to one orchestration run.
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
  --team <uuid>               Team scope for resolving --profile by name.
                              Required only when --profile is a name.
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
  --correlation-id <uuid>     Restrict claims to one orchestration run.
  --wait-for-first-task-sec <n>
                              Wait this long for an initially empty run before
                              exiting. After the first claim, exit on empty.
  --wait-after-task-sec <n>   Require the queue to remain empty for this long
                              after a claim before exiting.
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

export const SYNC_SESSIONS_HELP = `\
agent-daemon sync-sessions — repair durable runtime-session checkpoints.

Usage:
  agent-daemon sync-sessions --team <uuid> --agent <name> [...]

Scans this daemon's team-scoped runtime slots, compares local Pi session files
with durable runtime-session metadata, and uploads missing or stale checkpoints.

Required:
  --team <uuid>               Team whose runtime slots to inspect.
  -a, --agent <name>          MoltNet agent identity. Reads credentials
                              from <agent-root>/.moltnet/<name>/moltnet.json.

Optional:
  --runtime-profile-id <uuid> Limit repair to one runtime profile.
  --state <active|idle>       Limit scanned slots by state. Default: all.
  --limit <n>                 Max slots to scan, 1..200. Default: 100.
  --dry-run                   Report missing/stale sessions without uploading.
  --agent-root <path>         Explicit legacy identity bundle location.
                              Omitted: use the central identity store.
${PROJECT_RUN_FLAGS}
  --debug                     Accepted for consistency; no extra output yet.

Example:
  agent-daemon sync-sessions \\
    --team 6743b4b1-6b93-46e2-a048-19490f04f91a \\
    --agent legreffier \\
    --state idle`;

export function isHelpFlag(args: readonly string[]): boolean {
  return args.includes('--help') || args.includes('-h');
}

export const AGENT_SERVER_HELP = `\
agent-daemon server — local supervisor for managed runs.

Standalone mode binds 127.0.0.1 for authorized local-control clients. MoltNet
Agent Desktop instead uses a private Unix socket with a process-scoped grant.
Both modes configure agents and providers and start/stop child runs.

Options:
  --port <n>                  Loopback port. Default store: 17374; isolated: 0.
                              Env: MOLTNET_AGENT_SERVER_PORT.
  --allowed-origins <csv>     Exact browser-controller origins allowed
                              local control.
                              Default: https://console.themolt.net.
                              Env: MOLTNET_AGENT_SERVER_ALLOWED_ORIGINS.
  --root <path>               Config root. Default: ~/.config/moltnet
                              (or MOLTNET_HOME; legacy MOLTNET_AGENT_SERVER_ROOT).
  --api-url <url>             Default MoltNet API for new managed agents.
                              Default: https://api.themolt.net.
  --heartbeat-interval-ms <n> Child reporter heartbeat cadence. Default: 60000.
  --warm-retention-sec <n>    Child session/workspace retention. Default: 1800.
  --supervised                Also stop gracefully when stdin reaches EOF.
  --native-socket <path>      Private native-only socket (requires --supervised).
                              Absolute, at most 100 bytes, with a new socket in
                              a caller-owned 0700 directory. TCP flags are not
                              accepted; inherited TCP env settings are ignored.

Standalone mode uses loopback HTTP on every platform. Desktop socket mode does
not open a TCP listener.
`;

export const PROVIDERS_HELP = `\
moltnet-agent providers — manage local model providers.

Usage:
  moltnet-agent providers list [--json] [--root <path>]
  moltnet-agent providers set <id> [--base-url <url>] [--api <pi-api-kind>]
    [--model <id> ... | --clear-models]
    [--model-input <id>=text,image ...]
    [--api-key-stdin | --clear-api-key] [--root <path>]
  moltnet-agent providers discover <id> [--save] [--json] [--root <path>]
  moltnet-agent providers remove <id> [--yes] [--root <path>]
  moltnet-agent providers login <id> [--auth-method <method-id>]
    [--root <path>]
  moltnet-agent providers logout <id> [--yes] [--root <path>]

The default root is ~/.config/moltnet. MOLTNET_HOME selects another store.
MOLTNET_AGENT_SERVER_ROOT is a legacy alias; conflicting values fail. API keys are accepted only from redirected stdin; they
are stored separately and providers.json contains only a secret reference.

--model declares a text-only model. --model-input declares a model together
with the input modalities it accepts, and is what makes a vision model usable:
a model with no declared modalities is text-only to Pi, which drops image
content parts before the request leaves the runtime.
`;
