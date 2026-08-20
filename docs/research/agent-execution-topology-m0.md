# Local agent execution topology: Milestone 0

**Issue:** [#1890](https://github.com/getlarge/themoltnet/issues/1890)

**Observed:** 2026-08-20

**Status:** Supervisor checkpoint; stop before any shared contract or adapter

## Checkpoint answer

Yes. We can describe, probe, and compare the current local Codex and Claude
boundaries without choosing the eventual MoltNet model.

The comparison is useful precisely because the providers do not expose the
same shape. Codex and Claude both provide lifecycle, tool, sandbox, MCP, and
subagent evidence, but their approval behavior, degraded-state visibility,
configuration trust, and host-side paths differ. Treating those differences as
provider facts produces a truthful matrix. Normalizing them now would hide the
main result of the spike.

This report therefore uses only test-scenario names and native provider fields.
It does not define a canonical event envelope, public schema, `ProfileV2`, or a
product name.

## What was tested

| Surface          | Installed version                | Test depth                                                                     |
| ---------------- | -------------------------------- | ------------------------------------------------------------------------------ |
| Codex CLI        | `codex-cli 0.148.0`, macOS arm64 | Live model turns, resume, hooks, OS sandbox, MCP, subagent, and failure cases  |
| Codex App Server | Protocol shipped with `0.148.0`  | Direct JSON-RPC negotiation, read-only thread creation, and host shell command |
| ChatGPT desktop  | `26.803.41515` installed         | App Server boundary tested directly; no automated composer interaction         |
| Claude Code CLI  | `2.1.235`, macOS arm64           | Live model turns, resume, hooks, OS sandbox, MCP, subagent, and failure cases  |
| Claude desktop   | `1.32885.1` installed            | Installation confirmed; no instrumented desktop session was available          |

The executable harness creates a temporary Git repository, isolated hook
configuration, a dependency-free stdio MCP server, and a loopback HTTP server.
It uses the existing local provider authentication but does not persistently
change either provider's user configuration. Home and temporary paths are
sanitized in committed evidence; provider-native execution and action IDs are
retained.

Run both current-provider probes with:

```bash
pnpm exec nx run @moltnet/tools:execution-governance:probe -- \
  --provider codex \
  --scenario all \
  --output tools/test-fixtures/execution-governance/observed/codex-0.148.0-macos-arm64

pnpm exec nx run @moltnet/tools:execution-governance:probe -- \
  --provider claude \
  --scenario all \
  --output tools/test-fixtures/execution-governance/observed/claude-2.1.235-macos-arm64
```

These commands make paid provider calls. Unit tests exercise the recorder and
MCP protocol without a provider call.

## Probe design

The fixture vocabulary is deliberately local to this spike.

| Scenario              | Path under test                                            | Independent oracle                                                    |
| --------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------- |
| `lifecycle`           | Start, stop, end, and resume                               | Native ID repeats on resume; hook payloads show lifecycle source      |
| `covered-actions`     | Shell, native edit, child shell, MCP attempt, and subagent | Filesystem markers plus native stream and hook IDs                    |
| `mcp-execution`       | Allowed stdio MCP, host write, and host network            | Server-side JSON-RPC log, outside-workspace marker, loopback response |
| `mcp-unavailable`     | Configured MCP process cannot start                        | Missing tool/server status and absence of a server dispatch           |
| `hook-deny`           | Synchronous `PreToolUse` denial                            | Command marker remains absent                                         |
| `hook-ask`            | Synchronous `PreToolUse` escalation                        | Whether the provider dispatches the command                           |
| `approval-allow`      | Exact MCP action approved at `PermissionRequest`           | Server receives `tools/call` with the marker argument                 |
| `approval-deny`       | Same MCP action denied at `PermissionRequest`              | Hook sees the marker; server never receives `tools/call`              |
| `sandbox-deny`        | Shell writes outside the workspace                         | Host marker remains absent and command reports OS denial              |
| `shell-network`       | Sandboxed shell reaches loopback                           | HTTP response or native connection failure                            |
| `hook-unavailable`    | Synchronous hook process exits 70                          | Action marker and provider error evidence                             |
| App Server host probe | `thread/shellCommand` on a read-only thread                | Host marker plus App Server item lifecycle                            |

An attempted call is not counted as an executed path. The MCP server log is the
dispatch oracle, and each scenario resets every marker to avoid cumulative
coverage attribution.

## Observed conformance matrix

| Boundary                  | Codex `0.148.0`                                                                                             | Claude `2.1.235`                                                                                              |
| ------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Native execution identity | `thread_id`; hook `session_id` matches it. Turn and tool-use IDs are also exposed                           | `session_id`; prompt, tool-use, hook invocation, request, message, and subagent IDs are exposed               |
| Resume                    | Reused the original thread ID; `SessionStart.source=resume`                                                 | Reused the original session ID; `SessionStart.source=resume`                                                  |
| Lifecycle hooks           | Start, prompt, stop, end, and resume observed                                                               | Start, prompt, stop, end, and resume observed; stream also exposes hook start/response pairs                  |
| `PreToolUse` deny         | Blocked Bash before dispatch                                                                                | Blocked Bash before dispatch                                                                                  |
| `PreToolUse` ask          | Parsed as an unsupported decision and the Bash action continued                                             | Produced a native `permission_denied` event and did not dispatch Bash                                         |
| `PermissionRequest` allow | Fired for MCP; hook approval dispatched the exact marked call                                               | In print mode, `manual` normalized to `default`; the call was denied without a `PermissionRequest` hook event |
| `PermissionRequest` deny  | Fired for the same MCP action; server saw no `tools/call`                                                   | Same print-mode limitation; native denial occurred, but the configured `PermissionRequest` hook did not fire  |
| Shell                     | `Bash` pre/post hooks and command stream; workspace marker written                                          | `Bash` pre/post hooks and tool result; workspace marker written                                               |
| Native file edit          | `apply_patch` pre/post hooks and `file_change` stream item                                                  | `Read`, `ToolSearch`, and `Edit` pre/post hooks and tool events                                               |
| Child process             | Child `sh -c` remained one covered Bash action                                                              | Child `sh -c` remained one covered Bash action                                                                |
| Subagent                  | Spawn/wait hooks, `SubagentStart/Stop`, child `agent_id`, and child Bash IDs                                | `Agent` and `SubagentStart/Stop`, child `agent_id`, and child Read IDs                                        |
| MCP attempt               | Pre-use and permission hooks fire before server dispatch                                                    | Pre-use fires; non-interactive native permission can deny before server dispatch                              |
| MCP execution             | Hook-approved tools reached stdio server                                                                    | Explicit CLI allow-list was required for the unattended fixture; tools then reached stdio server              |
| MCP host filesystem       | MCP process wrote outside the agent workspace                                                               | MCP process wrote outside the agent workspace                                                                 |
| MCP host network          | MCP process reached the loopback HTTP server                                                                | MCP process reached the loopback HTTP server                                                                  |
| Shell filesystem sandbox  | Write outside workspace failed with `EPERM`                                                                 | Write outside workspace failed with `EPERM`                                                                   |
| Shell network sandbox     | Loopback `curl` failed with exit 7                                                                          | Loopback `curl` failed with exit 7                                                                            |
| Hook process unavailable  | Hook exited 70; action continued. CLI JSON/stderr did not expose the hook failure                           | Hook exited 70; action continued. Stream exposed hook-response errors for prompt, pre-use, and post-use       |
| MCP process unavailable   | Tool absent; no structured server-status event or stderr reason was emitted                                 | Init event explicitly reported MCP server `failed` and omitted its tools                                      |
| Project hook discovery    | Fresh untrusted project hooks did not load even with one-shot handler trust bypass; isolated user hooks did | Isolated project settings loaded in non-interactive mode                                                      |
| UI/host shell             | App Server read-only thread still executed `thread/shellCommand` outside its workspace and sandbox          | No equivalent desktop host protocol was probed                                                                |

The App Server result matches the current protocol contract: OpenAI documents
`thread/shellCommand` as a user-initiated host command that runs with full
access and does not inherit the thread sandbox. The live response identified a
read-only thread, then emitted a `commandExecution` item with
`source=userShell` and wrote the outside-workspace marker. No hook event was
captured, but the isolated App Server could not use the CLI's one-shot hook
trust bypass; hook applicability to this method remains unresolved rather than
being classified as absent.

Claude's result also keeps its two native layers separate. Its permission
rules apply across tools, while its OS sandbox applies to Bash and child
processes. The live probes showed shell filesystem/network denial alongside
successful host-side MCP filesystem/network access. This is a coverage
boundary, not a sandbox failure.

## Evidence available from each provider

| Evidence source        | Codex                                                                                                       | Claude                                                                                                                             |
| ---------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Non-interactive stream | Thread, turn, command, file change, MCP, collaboration, usage, and errors                                   | Init inventory, messages, tool calls/results, hook invocation results, permission denials, costs, rate limits, and terminal result |
| Hook input             | Session/thread, turn, tool, tool input/response, tool-use ID, subagent ID, transcript path, permission mode | Session, prompt, tool, tool input/response, tool-use ID, subagent ID, transcript path, permission mode, effort                     |
| Hook health            | Failure was not visible in captured CLI stream                                                              | Exit code, stderr, and `outcome=error` were visible in the stream                                                                  |
| MCP process            | Exact initialize/list/call sequence when environment variables are explicitly configured                    | Exact initialize/list/call sequence; init also reports connected/failed status                                                     |
| Host integration       | App Server thread, turn, command item, source, exit code, and duration                                      | No comparable desktop protocol evidence captured                                                                                   |
| Independent result     | Marker files and loopback server                                                                            | Marker files and loopback server                                                                                                   |

Provider transcripts are retained only as sanitized conformance fixtures. The
design does not require importing conversation history into a MoltNet record.

## Unsupported and unresolved paths

- Claude Desktop and IDE behavior was not tested through a live UI session.
  Anthropic documents the same hook lifecycle across terminal, IDE, Desktop,
  and web, but this checkpoint does not promote that documentation claim to an
  observed UI result.
- ChatGPT desktop composer behavior was not automated. The installed App Server
  protocol and its host shell method were tested directly.
- Claude `PermissionRequest` allow/deny behavior remains unproven for
  interactive CLI and Desktop. The current print surface denied before that
  hook event.
- Codex App Server hook coverage for `thread/shellCommand` is unresolved because
  the isolated host did not have a non-interactive hook-trust bypass.
- Hosted web/search, computer-use, browser, and plugin actions were not tested.
- Native file tools were tested inside the workspace, not against an external
  host path.
- Sandbox initialization failure was not simulated. The degraded fixtures cover
  hook-service and MCP-service failure.
- Results apply to the listed macOS arm64 versions. Linux, Windows/WSL, Docker,
  cloud, and self-hosted surfaces require separate observations.

## Lane A adoption metrics shaped by buyer falsifiers

The Clairon competitive baseline says native controls, Docker/Coder, identity
gateways, and MCP gateways already solve meaningful components. It also marks
its earlier schema-first sequence as superseded. Lane A should therefore
measure adoption and truthfulness, not whether we can install another hook.

1. **Time to a truthful topology report.** Measure elapsed time from an
   installed supported CLI to a versioned matrix containing executed,
   attempted, and unsupported paths. Do not collapse those states into a
   single coverage percentage.
2. **Workflow mutation count.** Count persistent provider settings, wrappers,
   and conversation changes required before the first result. This harness made
   zero persistent provider-configuration changes.
3. **Probeable-boundary ratio.** For a supervisor-approved denominator, report
   directly executed, indirectly observed, documentation-only, and unsupported
   paths separately. The denominator must include host and UI paths.
4. **Exact-action approval fidelity.** An allow passes only when the server sees
   the marked action; a deny passes only when the hook sees the same marker and
   the server does not. Codex passed this pair. Claude print mode is
   unsupported, not a failed deny/allow pair.
5. **Unexplained or misattributed gap count.** Target zero. The prototype found
   and fixed cumulative marker attribution, pre-dispatch MCP counting, missing
   provider-side MCP environment, and a temp-directory sandbox false positive
   before recording the matrix.
6. **Evidence without prompt or raw transcript.** Count conclusions that can be
   reconstructed from native IDs, decisions, dispatch logs, sandbox results,
   and markers alone. Codex hook-failure and dead-MCP health visibility are
   current weak points.
7. **Native-control delta.** Count action classes requiring a mechanism beyond
   the strongest native managed control. Host MCP and App Server shell paths
   demonstrate why a hook-only claim is insufficient.
8. **Meaningful routed action.** A buyer-facing pilot must route a real
   credential, MCP, network, filesystem, or production action through the
   boundary. The synthetic MCP host write proves the technical shape only; it
   does not establish buyer urgency or budget.

This checkpoint does not satisfy Clairon's commercial falsifiers: it has not
found two independent deployment owners with the same urgent problem, a paid
discovery, or a budget owner. It does show that the adapter can probe a
meaningful action while preserving provider-native differences. It also
supports the competitive conclusion that “adds hooks” is not a defensible
claim.

## Signed MoltNet findings

The checkpoint findings are recorded as immutable signed entries in the team
diary and linked to the prior execution-governance research:

- `5ecd3a55-c7f4-4cf2-9bd9-f6b3ee43f537` preserves provider-native topology
  through the supervisor gate. It supports the assurance-locus finding and
  references the earlier responsibility-split and governed-unit candidates.
- `f6e7fa12-96f8-4144-8900-936263118e5b` records fail-open hooks, unequal
  degraded-state evidence, and host-side MCP reach. It supports the prior
  assurance-locus and layering-not-containment findings.
- `1c587f2e-db9f-4b2d-99b3-757a33f7b63b` records the Clairon-shaped adoption
  tests without treating technical probeability as buyer validation. It
  supports the assurance and layering findings and references this checkpoint.

All relations above have accepted status. These entries record observations
and checkpoint decisions; they do not settle a shared representation.

## Supervisor gate

Before any shared contract or enforcement adapter is implemented, review:

1. whether the executed/attempted/unsupported distinctions answer the
   checkpoint question;
2. whether Claude interactive/Desktop approval and Codex App Server hook
   coverage must be added to Milestone 0;
3. whether hosted tools and native out-of-workspace file edits belong in this
   local checkpoint or the adversarial follow-up; and
4. the denominator and targets for the adoption metrics above.

No shared model should be designed until those boundaries are accepted.

## References

- [Codex hooks](https://developers.openai.com/codex/hooks)
- [Codex App Server](https://developers.openai.com/codex/app-server)
- [Claude hooks](https://code.claude.com/docs/en/hooks)
- [Claude sandboxing](https://code.claude.com/docs/en/sandboxing)
- Source direction: `docs/research/agent-execution-governance.md` in the
  originating research worktree
- Clairon competitive baseline: commit `4756a5b`,
  `docs/research/competition/agent-governance.md`
