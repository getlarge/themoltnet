# Local agent execution topology: Milestone 0

**Issue:** [#1890](https://github.com/getlarge/themoltnet/issues/1890)

**Observed:** 2026-08-20

**Status:** Checkpoint C is observed: Claude and Codex both consumed the same
existing MoltNet denial at `PreToolUse` and blocked the native action. No public
contract, production adapter, runtime-profile migration, credential model, or
Gondolin adapter is included.

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

| Surface          | Installed version                                         | Test depth                                                                          |
| ---------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Codex CLI        | `codex-cli 0.148.0`, macOS arm64                          | Live model turns, resume, hooks, OS sandbox, MCP, subagent, and failure cases       |
| Codex App Server | Protocol shipped with `0.148.0`                           | Direct JSON-RPC negotiation, read-only thread creation, and host shell command      |
| ChatGPT desktop  | `26.803.41515` installed                                  | App Server boundary tested directly; no automated composer interaction              |
| Claude Code CLI  | `2.1.237` installed; evidence from `2.1.235`, macOS arm64 | Live model turns, resume, hooks, OS sandbox, MCP, subagent, and failure cases       |
| Claude desktop   | `1.32885.1` installed                                     | Installation confirmed; no instrumented desktop session was available               |
| Docker Sandboxes | `sbx v0.39.0`, macOS arm64                                | Live synthetic credential preflight, brokered delivery, network denial, and cleanup |
| Sandboxed Codex  | `codex-cli 0.146.0`                                       | One minimal Responses turn against a synthetic host fixture                         |
| Sandboxed Claude | `2.1.221`                                                 | One minimal Messages turn against a synthetic host fixture                          |

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

## Checkpoint B: one MoltNet policy, two provider hooks

Checkpoint B tests behavior rather than grouping the earlier scenarios. Its
only policy fixture carries the required fields of the current MoltNet
allowed-tools response: `enforcement=enforce`, the shell argv prefix
`git status`, the structured tool `mcp__probe__probe_echo`, current
`runtimeKind=gondolin_pi`, an integer runtime-profile revision, and a
policy-snapshot hash. It contains no credential declaration or candidate
profile vocabulary. There is no Checkpoint B scenario in `scenarios.json`;
this slice uses the dedicated `policy-replay.json` fixture.

The replay loads retained real Bash and MCP `PreToolUse` envelopes from the
Claude `2.1.235` and Codex `0.148.0` evidence directories. It changes only the
action under test, normalizes the provider payload into the existing
`@themoltnet/pi-runtime` `decideToolCall()` gate, and translates denials to each
provider's documented `hookSpecificOutput.permissionDecision="deny"` shape.
Allow and audit decisions emit an empty response; the decision is retained in
separate evidence. Only `tool_name="Bash"` is normalized to the MoltNet `bash`
tool, because Codex `apply_patch` also has `tool_input.command`. No model call,
provider launch, persistent configuration, or magic-marker decision is
involved.

| Shared policy case            | Claude         | Codex          | Gate reason                   | Observed locus  |
| ----------------------------- | -------------- | -------------- | ----------------------------- | --------------- |
| `git status`                  | allow          | allow          | shell prefix allowed          | offline replay  |
| `git push`                    | deny           | deny           | tool not permitted            | offline replay  |
| `mcp__probe__probe_echo`      | allow          | allow          | policy allowed                | offline replay  |
| `mcp__probe__probe_sibling`   | deny           | deny           | tool not permitted            | offline replay  |
| policy resolution unavailable | callback unrun | callback unrun | policy resolution unavailable | probe preflight |

Every decision record contains the profile revision, policy snapshot hash,
provider, retained native action identifier, decision, gate reason code,
`decisionLocus=offline-replay`,
`intendedEnforcementLocus=PreToolUse`, and `enforcementObserved=false`.
`PermissionRequest` remains separate provider-specific approval evidence:
Codex emitted it for the exact MCP action, while Claude print mode did not. It
is not used as the shared policy gate.

The policy fixture is
`tools/test-fixtures/execution-governance/policy-replay.json`; its payload
references point directly to committed observed JSONL. Derived value-free
decision evidence is retained in `policy-replay.expected.json` and asserted
byte-for-structure by `policy-replay.test.ts` against `policy-replay.ts`. The
test also spawns the executable `policy-replay-hook.ts` command with retained
Claude and Codex stdin, then checks its stdout against each provider's current
documented contract. This proves executable translation and output syntax; it
does not prove that either provider consumed the response or blocked a real
tool call. Likewise, the missing-policy unit test proves only that a
probe-local launch callback is not invoked. A real provider launch stop remains
unobserved until an authorized live test.

### Credential and profile research direction

The Docker credential result remains a separate axis below. It still supports a
future split between typed non-secret runtime inputs, portable credential
requirements and constraints, trusted local bindings, and value-free resolved
execution evidence. `requiredEnv` currently conflates readiness, raw guest
delivery, and redaction, so it is a compatibility surface rather than the target
design. The existing MoltNet OAuth2 provider-backed reference and launch-time
resolution are useful implementation precedent, but no field names or public
schema are proposed by this checkpoint.

### Released CLI reuse

| Stage                                 | Released capability                                   | Checkpoint B use                                                                                                                         |
| ------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and local provider readiness | `moltnet agents activation validate`                  | Reuse before resolution                                                                                                                  |
| Existing local prerequisites          | `moltnet env check`                                   | Reuse while `requiredEnv` remains compatible                                                                                             |
| Provider launch                       | `moltnet start <provider>`                            | Not used here: it currently injects MoltNet credentials and inherited host environment into the child; safe launch needs separate design |
| Protected credential files            | `moltnet secrets guard`                               | Reuse as host-file protection, not delivery enforcement                                                                                  |
| Accountable conclusion                | `moltnet entry create-signed` and `moltnet relations` | Reuse only after a new result is verified                                                                                                |

No new CLI command is justified at this checkpoint.

## Checkpoint C: live provider enforcement

The Checkpoint C harness uses the same allowed-tools fixture and
`decideToolCall()` path as Checkpoint B. Before provider readiness or launch, it
loads and validates the policy fixture. An executable subprocess test places a
fake `codex` command on `PATH`, supplies a missing policy file, and proves that
the command is never reached. This upgrades the missing-policy result from a
callback assertion to an actual launch-command boundary.

The provider process receives a small allowlist of ordinary process
prerequisites. API keys, access tokens, provider config-directory overrides,
and credential-bearing proxy variables are not inherited. The harness uses the
provider's already-established local login after a value-free readiness check;
it does not read, copy, link, or persist an auth file. `moltnet start` remains
out of scope because its current child environment and MoltNet credential
injection need a separate safe-launch design.

Claude Code `2.1.237` loaded the isolated project `PreToolUse` hook, proposed the
exact Bash marker command, consumed the MoltNet
`hookSpecificOutput.permissionDecision="deny"` response, emitted native
`permission-rule` and `permission_denials` evidence, and did not create the
marker. The retained decision contains runtime-profile revision `1`, the policy
snapshot hash, provider `claude`, native tool-use identifier
`toolu_01Ez89VB1sy3286zPGzYKaiQ`, decision `deny`, reason
`tool_not_permitted`, `decisionLocus=provider-hook`,
`intendedEnforcementLocus=PreToolUse`, and `enforcementObserved=true`. The
successful run cost `$0.0146715`. Retained files contain no host username,
provider auth path, API key, access token, bearer value, or inherited
credential environment value.

Codex `0.148.0` consumed the same policy through an invocation-local TOML `-c`
hook override while running with `--ignore-user-config`. Its native stderr
reported `Command blocked by PreToolUse hook: tool_not_permitted`, its event
stream reported that the policy hook blocked the command, and it did not create
the marker. The retained decision records execution identifier
`01a02320-4ef4-79c0-9843-369c731bbeef`, action identifier
`exec-33636299-508f-4136-a8d0-005e2a1b4d12`, runtime-profile revision `1`, the
same policy-snapshot hash as Claude, decision `deny`, reason
`tool_not_permitted`, `decisionLocus=provider-hook`, and
`enforcementObserved=true`. Retained files contain no host username, provider
auth path, API key, access token, bearer value, or inherited credential
environment value.

The invocation-local placement is a hermetic probe choice, not evidence that
Codex requires that placement. This repository's trusted project hook in
`.codex/hooks.json` works normally. An earlier fresh temporary-repository
attempt produced no MoltNet evidence, but its workspace and diagnostics were
discarded. That attempt is therefore inconclusive: it cannot distinguish trust
state from probe configuration and does not establish a documentation
discrepancy. The successful conformance run deliberately used an
invocation-local override to isolate the tested policy from ambient project and
user hooks. It used the normal value-free login readiness path without reading,
copying, or linking auth material.

Claude also exposed one adapter-version detail before the successful run:
`--mcp-config '{}'` is rejected locally by `2.1.237`; an explicit empty
`{"mcpServers":{}}` object is accepted. The rejected invocation made no model
call. This syntax remains Claude-specific and does not change the shared
scenario.

### Knowledge Factory in the adoption path

Knowledge Factory is part of the profile offer, not an evidence appendix.
MoltNet MCP gives Claude and Codex trusted project and team knowledge; the
existing runtime-profile context selection provides a current profile-level
attachment point. Execution evidence becomes a signed entry related to the
profile decision and prior findings. Repeated evidence may later suggest an
input, credential, policy, or context improvement, but the resulting profile
change remains a proposal reviewed by a human or trusted process.

## M0.1 credential-boundary spike

M0.1 asks a narrower pre-start question: can a local deployment prove that a
required credential binding is ready, constrain delivery to its declared
destination, and retain useful evidence without retaining the value? On Docker
Sandboxes v0.39.0, the answer is yes, with two Docker-specific lifecycle details
that must remain inside the probe adapter.

The scenario vocabulary describes these four stages without naming Docker:

1. A **credential requirement** identifies a required capability, its consumer,
   a symbolic destination, and the acceptable brokered-delivery constraint. It
   contains no secret coordinate or value.
2. **Resolution constraints** limit use to the declared destination and require
   brokered HTTP delivery. Missing access is a preflight failure, not an agent
   runtime error.
3. A trusted **local binding** selects a temporary host-side resolver for this
   run. The fixture resolver reads a sandbox-scoped synthetic credential from a
   mode-`0600` temporary file. No ambient environment, personal provider login,
   auth file, or keychain entry is imported.
4. **Resolved delivery** is provider-specific. Docker's host proxy replaces the
   guest stand-in in a matching request. The fixture records only request path,
   authentication scheme, and whether the supplied value matched; it never logs
   headers or the value.

Strong guarantees require a compatible sandbox. A hook can stop an observed
provider action, but it cannot prove that a credential value was absent from the
guest or constrain unobserved child and host paths. This spike therefore reports
the adapter unavailable when `sbx` or virtualization is unavailable, and fails
preflight when a required binding or explicit network policy is missing.

### Executable scenarios

Run the value-free Docker fixture with:

```bash
pnpm exec nx run @moltnet/tools:credential-probe
```

The target creates temporary Git workspaces, dynamic loopback ports, two local
fixtures, and three disposable sandboxes. It registers one sandbox-scoped custom
secret per sandbox from a host command, adds only the allowed dynamic
`localhost:<port>` network rule, runs the scenario, scans provider state,
transcripts, hooks, stdout, and stderr for the synthetic value, then removes the
rule, secret, sandbox, fixtures, and temporary directories. It writes evidence
only after every assertion passes.

| Scenario            | Required result                                                         | Observed on `sbx v0.39.0`                                                                       |
| ------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Missing binding     | Stop before provider launch and return actionable setup guidance        | Passed; preflight made no `sbx` call and `agentLaunchAttempted=false`                           |
| Allowed destination | Guest sees only the stand-in; approved host receives the resolved value | Passed for shell, Codex, and Claude                                                             |
| Wrong destination   | No substitution or authenticated delivery outside the constraint        | Passed; proxy returned HTTP 403, `curl` exited 22, and the wrong fixture received zero requests |

The shell probe first asserted that the environment contained exactly the
stand-in, then sent it in a Bearer header. Codex used a temporary custom model
provider with the Responses wire protocol and sent a Bearer request. Claude used
`ANTHROPIC_BASE_URL` and sent an `x-api-key` request to
`/v1/messages?beta=true`. Each allowed request arrived with the synthetic value;
the value was absent from guest environment output, provider streams, stderr,
hooks, transcripts, provider state, and committed evidence.

### Effective Docker policy and observed boundary

The test machine initially had no Docker Sandbox network policy. The documented
local preset was explicitly initialized to `deny-all` before the experiment.
Each sandbox then received one dynamic allow rule for the approved host fixture;
the adjacent dynamic port remained denied. This is a test-machine prerequisite,
not a portable MoltNet default. The harness discovers and reports policy state
and never initializes, resets, or broadens global policy itself.

Docker documents that `host.docker.internal` is rewritten to `localhost` before
forwarding to a host service. In v0.39.0, the network rule had to name the
rewritten `localhost:<port>`. The custom-secret match also required both the
guest-visible and rewritten host names; binding only `host.docker.internal`
allowed the request but did not substitute the stand-in. Network policy still
limited the effective boundary to the single port.

Two installed-CLI details differed from, or were less explicit than, the
documentation:

- A sandbox-scoped custom secret registered after sandbox creation took effect
  in the proxy immediately, but its declared environment variable did not appear
  in the already-running guest. The adapter therefore passes only the stand-in
  with `sbx exec --env`; the resolved value remains host-side. Docker's credential
  page says a custom secret sets the guest variable and that sandbox-scoped
  secrets take effect immediately, but does not describe this split behavior.
- `sbx secret rm --help` uses `--placeholder` in an example while omitting it
  from the displayed flag list. The documented example worked and removed each
  custom secret successfully.

The first Codex attempt also established a provider fact: `OPENAI_BASE_URL` did
not override the built-in endpoint for this CLI invocation. The final probe uses
the official Codex custom-provider keys (`model_provider`, `base_url`, `env_key`,
and `wire_api`) as invocation-local overrides, with WebSockets disabled. The
default endpoint remained denied throughout.

### Evidence and portability boundary

Committed evidence records the `sbx`, Codex, and Claude versions; platform;
symbolic requirement and destinations; readiness result and setup instruction;
effective allow/deny decisions; authentication scheme; provider-native session
evidence; cleanup result; and boolean leak-scan result. Dynamic ports, temporary
paths, stand-ins, headers, resolver output, and the credential value are not
retained.

The shared scenarios can map to Gondolin unchanged: missing requirement
resolution, approved brokered destination, and denied destination. What remains
provider-specific is how Gondolin discovers readiness, represents an egress
rule, supplies a stand-in, resolves a trusted local binding, proves substitution,
captures provider process evidence, and guarantees cleanup. Gondolin also needs
an equivalent independent host oracle and a documented story for headless
credential storage. Those are the next adapter questions; they are not reasons
to introduce a shared contract now.

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

| Boundary                  | Codex `0.148.0`                                                                                                                  | Claude `2.1.235`                                                                                              |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Native execution identity | `thread_id`; hook `session_id` matches it. Turn and tool-use IDs are also exposed                                                | `session_id`; prompt, tool-use, hook invocation, request, message, and subagent IDs are exposed               |
| Resume                    | Reused the original thread ID; `SessionStart.source=resume`                                                                      | Reused the original session ID; `SessionStart.source=resume`                                                  |
| Lifecycle hooks           | Start, prompt, stop, end, and resume observed                                                                                    | Start, prompt, stop, end, and resume observed; stream also exposes hook start/response pairs                  |
| `PreToolUse` deny         | Blocked Bash before dispatch                                                                                                     | Blocked Bash before dispatch                                                                                  |
| `PreToolUse` ask          | Parsed as an unsupported decision and the Bash action continued                                                                  | Produced a native `permission_denied` event and did not dispatch Bash                                         |
| `PermissionRequest` allow | Fired for MCP; hook approval dispatched the exact marked call                                                                    | In print mode, `manual` normalized to `default`; the call was denied without a `PermissionRequest` hook event |
| `PermissionRequest` deny  | Fired for the same MCP action; server saw no `tools/call`                                                                        | Same print-mode limitation; native denial occurred, but the configured `PermissionRequest` hook did not fire  |
| Shell                     | `Bash` pre/post hooks and command stream; workspace marker written                                                               | `Bash` pre/post hooks and tool result; workspace marker written                                               |
| Native file edit          | `apply_patch` pre/post hooks and `file_change` stream item                                                                       | `Read`, `ToolSearch`, and `Edit` pre/post hooks and tool events                                               |
| Child process             | Child `sh -c` remained one covered Bash action                                                                                   | Child `sh -c` remained one covered Bash action                                                                |
| Subagent                  | Spawn/wait hooks, `SubagentStart/Stop`, child `agent_id`, and child Bash IDs                                                     | `Agent` and `SubagentStart/Stop`, child `agent_id`, and child Read IDs                                        |
| MCP attempt               | Pre-use and permission hooks fire before server dispatch                                                                         | Pre-use fires; non-interactive native permission can deny before server dispatch                              |
| MCP execution             | Hook-approved tools reached stdio server                                                                                         | Explicit CLI allow-list was required for the unattended fixture; tools then reached stdio server              |
| MCP host filesystem       | MCP process wrote outside the agent workspace                                                                                    | MCP process wrote outside the agent workspace                                                                 |
| MCP host network          | MCP process reached the loopback HTTP server                                                                                     | MCP process reached the loopback HTTP server                                                                  |
| Shell filesystem sandbox  | Write outside workspace failed with `EPERM`                                                                                      | Write outside workspace failed with `EPERM`                                                                   |
| Shell network sandbox     | Loopback `curl` failed with exit 7                                                                                               | Loopback `curl` failed with exit 7                                                                            |
| Hook process unavailable  | Hook exited 70; action continued. CLI JSON/stderr did not expose the hook failure                                                | Hook exited 70; action continued. Stream exposed hook-response errors for prompt, pre-use, and post-use       |
| MCP process unavailable   | Tool absent; no structured server-status event or stderr reason was emitted                                                      | Init event explicitly reported MCP server `failed` and omitted its tools                                      |
| Project hook discovery    | Existing trusted repository hooks work; one discarded fresh-repository attempt was inconclusive; isolated user hooks also worked | Isolated project settings loaded in non-interactive mode                                                      |
| UI/host shell             | App Server read-only thread still executed `thread/shellCommand` outside its workspace and sandbox                               | No equivalent desktop host protocol was probed                                                                |

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
9. **Pre-start readiness latency.** Measure time from a clean-machine invocation
   to a value-free ready/not-ready verdict with one actionable next step. A
   missing required binding must have a zero provider-launch count.
10. **Credential exposure count.** Target zero matches across guest environment,
    output, stderr, hooks, transcripts, provider state, and retained evidence.
    Redaction does not convert a failed raw scan into a pass.
11. **Destination isolation fidelity.** An allowed destination passes only when
    its independent fixture confirms resolution. A denied destination passes
    only when policy reports deny and the fixture receives zero requests.
12. **Clean-machine mutation count.** Report required global prerequisites and
    persistent host changes separately from sandbox-scoped setup. The product
    target is zero automatic credential import and zero secret-bearing MoltNet
    configuration.
13. **Portable scenario replay.** Count how many provider-neutral scenarios can
    run on a second sandbox without vocabulary changes. Docker-specific commands,
    host rewrites, keyring behavior, and policy formats do not count as portable.

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
- `52bf4e67-b8be-40de-80f2-b8c9c8cb2b04` records the M0.1
  requirement/constraint/binding/delivery separation and value-free Docker,
  Codex, and Claude observations. It supports the earlier credential-separation
  and provider-native-topology entries.
- `10c9b4b3-a7e0-45d5-bb0d-1a6e557f100b` records the Docker v0.39.0 post-create
  environment and host-rewrite quirks as adapter-local behavior. It supports
  the M0.1 finding and earlier credential/topology entries and references the
  degraded host-boundary finding.
- `7d6197ca-51b3-46e2-8100-75bf3c62ea9a` records that Claude canonicalized and
  encoded a temporary host path differently from the probe root. The retained
  evidence sanitizer now removes the entire provider-generated token containing
  the unique run directory, with a prefix-independent regression test. The
  signed sanitizer-fix commit entry references this incident.
- `dc1a7806-f515-4ea7-b6fb-4d9e727ea10f` records the initial Checkpoint B
  offline result. Its core same-policy replay result remains valid, but its
  `PreToolUse` enforcement-locus and provider-launch wording exceeded what the
  offline test observed.
- `d6a5a03d-2a15-49d2-89fa-2abaa95c7ccf` is the signed correction. It records
  the spawned executable-hook result, real MCP payload sources, contract-valid
  deny/empty output split, offline decision locus, intended `PreToolUse`, and
  `enforcementObserved=false`. Its signature verifies, and its accepted
  `supersedes` relation replaces the overbroad claims in the initial entry.
- `f23b3a09-f67a-4d43-83f4-5b64a0094d93` records that Codex `0.148.0` emits
  successful login status on stderr under the minimal probe environment. The
  provider-specific readiness parser now checks both streams.
- `b50bef87-faab-439b-b716-b4fe726bd58d` records Claude `2.1.237` rejecting a
  bare empty MCP config before a model call and the explicit empty
  `mcpServers` shape used by the successful live denial.
- `49cc13d2-a74e-457b-8dba-f6e0015f30c4` records the partial Checkpoint C
  decision: Claude enforcement is observed, Codex remains pending, hook
  placement stays adapter-local, and no shared contract is inferred.
- `b0a0ce8d-85a8-4453-bde9-32430289c9e8` records the completed Checkpoint C
  observation: the same existing MoltNet policy denied live Claude and Codex
  actions, both providers exposed native denial evidence, and neither created
  the prohibited marker.
- `9c2b437b-784f-4d57-9e80-494455f0877a` corrects that entry's hook-placement
  conclusion: invocation-local configuration was a hermetic probe choice, the
  trusted repository project hook works, and the discarded temporary-repository
  attempt cannot establish a Codex documentation discrepancy. Its accepted
  `supersedes` relation replaces the overbroad conclusion while preserving the
  live same-policy result.
- `c689ce86-3846-4c32-8d25-aaace5522b36` records that the `os-keyring` error
  came from running `moltnet relations create` inside the restricted execution
  sandbox. The same command succeeded at the approved host boundary; both
  intended Checkpoint C relations are accepted. It supersedes the earlier
  unconfirmed relations-authentication incident.

Earlier relations have accepted status; the three relations from the initial
Checkpoint B entry are proposed as of 2026-08-21, while the correction's
`supersedes` relation is accepted. These entries record observations and
checkpoint decisions; they do not settle a shared representation.

## Supervisor gate: Checkpoint B

Before live paid provider calls or persistent host changes, review:

1. whether replaying the existing MoltNet gate is the accepted minimum adoption
   proof;
2. whether one live `PreToolUse` run per provider is justified to prove the
   offline translator at the native boundary;
3. how to launch that test without `moltnet start` inheriting the host
   environment or injecting MoltNet credentials; and
4. whether the same policy cases should then be replayed inside Docker Sandbox
   while keeping credential delivery as a separate result axis.

No production schema, runtime-profile migration, production adapter, or
Gondolin implementation is authorized by this checkpoint.

## Supervisor gate: Checkpoint C

Checkpoint C passes for the tested denial: one existing MoltNet policy decision
was consumed by both current provider CLIs and blocked each native action. In
both cases the MoltNet decision, provider-native denial, and absent marker agree.
The next supervisor decision is whether the probe-local differences are clean
enough to inform a later runtime-profile safe-launch adapter:

1. Claude uses isolated project hook settings, while the Codex conformance run
   uses an invocation-local override to exclude ambient hooks; trusted Codex
   project hooks also work in this repository;
2. the proof covers denial at `PreToolUse`, not every allow, audit, approval, or
   host-side path live; and
3. ambient user-hook coexistence, safe credential resolution, and Gondolin
   replay remain separate portability work.

Checkpoint C does not combine the Docker credential experiment with policy
enforcement and does not authorize a shared contract, provider package
extraction, production launcher, schema field, or Gondolin adapter.

## References

- [Codex hooks](https://developers.openai.com/codex/hooks)
- [Codex App Server](https://developers.openai.com/codex/app-server)
- [Claude hooks](https://code.claude.com/docs/en/hooks)
- [Claude sandboxing](https://code.claude.com/docs/en/sandboxing)
- Source direction: `docs/research/agent-execution-governance.md` in the
  originating research worktree
- Clairon competitive baseline: commit `4756a5b`,
  `docs/research/competition/agent-governance.md`
