# Runtime policies

Runtime policies are named allow-lists of tools and shell-command prefixes. A
runtime profile binds a set of them and chooses an enforcement mode; the union
of the bound policies is what a session actually enforces.

`tools` names runtime and MCP tools such as `read`, `grep`, or
`moltnet_get_task`. It never grants shell access. Shell programs go in
`shellCommands`: `{ "argvPrefix": ["cat"] }` allows `cat` with any arguments,
`{ "argvPrefix": ["git", "diff"] }` allows only `git diff`. No shell rule allows
output redirection.

| Definition                                                                                             | Profile                                                                                          |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| [`legreffier-review-readonly-v1.json`](./legreffier-review-readonly-v1.json)                           | `legreffier-review-v1`                                                                           |
| [`legreffier-adaptive-focused-readonly-v1.json`](./legreffier-adaptive-focused-readonly-v1.json)       | `legreffier-adaptive-focused-review-v1`, `legreffier-adaptive-docs-review-v1`                    |
| [`legreffier-security-review-readonly-v1.json`](./legreffier-security-review-readonly-v1.json)         | `legreffier-security-review-v2`                                                                  |
| [`legreffier-complexity-review-input-only-v1.json`](./legreffier-complexity-review-input-only-v1.json) | `legreffier-complexity-review-v2`                                                                |
| [`legreffier-issue-triage-input-only-v1.json`](./legreffier-issue-triage-input-only-v1.json)           | `legreffier-issue-triage-v1`, `legreffier-issue-classifier-v1`, `legreffier-issue-classifier-v2` |

The definitions here are the reviewable source of truth. They are **not**
applied automatically — the server holds the live state, and these files are
what a change to it should be reviewed against. Keeping them in the repo is the
same argument `moltnet profile create --help` makes for sandbox policies: an
allow-list that decides whether a review agent can shell out or reach the
network is a security artifact worth diffing in a pull request rather than
clicking into a UI.

## Issue classifier pilot

The [issue triage workflow](../workflows/issue-triage.yml) runs the existing
issue-quality task first, then optionally passes its validated issue excerpts
to a standalone `classify` task. The classifier reports issue category and
readiness probabilities in the comment; the issue-quality task continues to
decide `needs-spec` and `ready-for-agent` labels. A classifier failure leaves
the established label path available.

Before setting repository variable `MOLTNET_ISSUE_CLASSIFIER_ENABLED=true`,
create `legreffier-issue-classifier-v2` from its
[profile definition](../runtime-profiles/legreffier-issue-classifier-v2.json),
bind `legreffier-issue-triage-input-only-v1` to it, and provide
`OLLAMA_API_KEY` in the `legreffier` GitHub environment. The profile selects
Ollama Cloud's `clef:27b` decision model. The classifier action discovers its
System One capabilities from `https://ollama.com/api/show` and calls the
cloud `/v1/systemone` endpoint through Pi. Provider credentials stay in the
daemon provider configuration.

Verify the effective policy with
`moltnet profile allowed-tools legreffier-issue-classifier-v2 --team-id "$TEAM"`
before enabling the pilot. The v1 definition retains the earlier TypeSafe
classifier for existing consumers.

## Adaptive PR review

The adaptive PR workflow reuses the input-only Ollama Cloud Clef classifier
`legreffier-issue-classifier-v2` from issue triage. Its focused and docs
reviewers use dedicated profiles with a repository-only policy. Create those
profiles and policy before enabling the workflow on ordinary PRs. Profile
creation needs a released CLI with `models` support (3.17 or newer), and the
worker environment needs `OLLAMA_API_KEY`:

```bash
TEAM=6743b4b1-6b93-46e2-a048-19490f04f91a
moltnet policy create \
  --from-file .github/runtime-policies/legreffier-adaptive-focused-readonly-v1.json \
  --team-id "$TEAM"
moltnet profile create \
  --from-file .github/runtime-profiles/legreffier-adaptive-focused-review-v1.json \
  --team-id "$TEAM"
moltnet profile create \
  --from-file .github/runtime-profiles/legreffier-adaptive-docs-review-v1.json \
  --team-id "$TEAM"
moltnet profile set-policies legreffier-adaptive-focused-review-v1 \
  --policy legreffier-adaptive-focused-readonly-v1 --team-id "$TEAM"
moltnet profile set-policies legreffier-adaptive-docs-review-v1 \
  --policy legreffier-adaptive-focused-readonly-v1 --team-id "$TEAM"
moltnet profile allowed-tools legreffier-adaptive-focused-review-v1 \
  --team-id "$TEAM"
moltnet profile allowed-tools legreffier-adaptive-docs-review-v1 \
  --team-id "$TEAM"
moltnet profile allowed-tools legreffier-issue-classifier-v2 \
  --team-id "$TEAM"
```

The resolved profiles must enforce their policy and expose repository inspection
tools only. The workflow uses each profile in both the task producer and worker.
Once the classifier profile is provisioned and `OLLAMA_API_KEY` is set in the
`legreffier` environment, set repository variable
`MOLTNET_ADAPTIVE_REVIEW_ENABLED=true` to start the caller workflow.

### Optional diary context for focused reviews

Diary context lets focused reviewers (`tests`, `conventions`, and
`blast-radius`) investigate past decisions and incidents while checking current
code. It is **off by default**: the caller's `focused-diary-ids` input
is `[]`, and the ordinary focused profile has no diary tools. The classifier,
docs, security, and complexity profiles keep their existing capabilities.

To enable it, an operator selects both source diaries and the separate
[knowledge review profile](../runtime-profiles/legreffier-adaptive-knowledge-review-v1.json).
The source list belongs in the trusted caller workflow, not in
`.github/adaptive-review.json`, task input, or the profile's guest environment.
The worker identity needs read access to every source diary; see
[diary access and grants](../../docs/use/entries.md#team-scoped-diaries-and-grants).
A runtime profile does not grant access to a diary.

#### Enable the optional runtime

Use a pinned adaptive-review action release that includes the optional runtime
bundle, and an exact released `daemon-version` whose adapter supports that
bundle. The workflow installs the review-owned runtime module for focused
workers only. You do not add the review tools to the ordinary Pi runtime or
deploy a separate long-running worker.

Create and bind the committed policy and profile using the released CLI:

```bash
moltnet policy create \
  --from-file .github/runtime-policies/legreffier-adaptive-knowledge-readonly-v1.json \
  --team-id "$TEAM"
moltnet profile create \
  --from-file .github/runtime-profiles/legreffier-adaptive-knowledge-review-v1.json \
  --team-id "$TEAM"
moltnet profile set-policies legreffier-adaptive-knowledge-review-v1 \
  --policy legreffier-adaptive-knowledge-readonly-v1 --team-id "$TEAM"
moltnet profile allowed-tools legreffier-adaptive-knowledge-review-v1 \
  --team-id "$TEAM"
```

These are first-time creation commands. For existing resources, use the
[policy update procedure](#applying-a-definition) and `moltnet profile update`.
`set-policies` replaces the whole policy set. Preserve `toolEnforcement:
"enforce"`, `runtimeKind: "adaptive_review_pi"`, the required diary tools,
and the profile's review instructions. The resolved allow-list should contain
only `find`, `grep`, `ls`, `read`, `moltnet_search_review_entries`, and
`moltnet_get_review_entry`, with no shell commands.

Then add these inputs to the caller workflow's existing `with` block, replacing
the source placeholder with 1–8 approved diary UUIDs:

```yaml
focused-profile: legreffier-adaptive-knowledge-review-v1
focused-diary-ids: '["<source-diary-uuid>"]'
daemon-version: '0.74.1'
```

`focused-diary-ids` selects historical sources. The separate `diary-id` input
remains the diary used for review tasks; it does not automatically become a
historical source. Leave `focused-diary-ids: '[]'` and use the ordinary focused
profile to keep diary context disabled.

Before claiming tasks, the optional worker verifies the downloaded action
bundle's digest, installs exact released daemon and runtime dependencies in a
temporary directory, and imports the module to check compatibility. The module
registers the two diary tools under `adaptive_review_pi`; the matching profile
requires them. The ordinary worker path is unchanged when the option is off.
See the [setup script](../../tools/setup-adaptive-review-diary-runtime.sh) for
the dependency checks.

A local loader smoke test passed with daemon `0.74.1` and Pi runtime `0.28.0`.
This checked module loading and CLI argument acceptance, not a deployed review.

#### What access this grants

The host reads the configured UUIDs from `ADAPTIVE_REVIEW_DIARY_IDS`, supplied by
the trusted workflow. The tool descriptors enumerate those sources, and each
call checks its selected diary before using the host's authenticated SDK.
An omitted source is accepted only when exactly one is configured. Empty,
malformed, or oversized source lists fail optional-runtime setup.

Search and fetch share eight live lookup attempts per toolset context. Failed
API calls also consume that budget. The counter is in memory, so a new context
after a restart gets a new budget; it is not a persistent task quota. Searches
return at most five entries with 200-character content previews. Fetches look
up an entry within the selected diary and cap its content at 12,000 characters,
with a truncation flag. Returned `contentHash` values come from the API and are
not locally verified by these tools.

Access covers whole diaries. It is not automatically scoped to the current
repository or PR, and optional search tags are filters, not authorization.
Choose diaries approved for this reviewer and suitable for the public review
context. The policy grants neither diary writes nor task reads and leaves the
guest network allow-list empty; the host performs the permitted diary calls.

Retrieved entries are untrusted investigation leads. Reviewers must verify
current code and callers before reporting a defect and state uncertainty when
lookups fail or the budget runs out. Historical review outcomes remain
unverified observations. The profile instructs reviewers to keep diary
references in the task conversation and describe independently verified code
behavior in public findings. This is a model instruction, **not automatic
redaction** of private content.

#### Verify before rollout

`profile allowed-tools` verifies the live policy binding. It does not prove
that the chosen released dependencies can load the runtime, that the worker
can read the source diaries, or that a model uses retrieved evidence correctly.
Local builds and mocked SDK tests likewise verify implementation behavior,
not deployed access or review quality.

Validate the complete configuration in a controlled workflow run before
ordinary PR use: confirm the optional module loads, the focused task uses the
knowledge profile, and permitted search/fetch calls return the intended source
content. Inspect the task conversation and public result to assess evidence
use and disclosure. Record that deployed validation separately from local
checks; selecting the profile or passing local tests alone is not a successful
rollout.

## Applying a definition

`create` and `update` are different operations, not two names for one apply
step. `create` takes the whole definition below and fails if the policy already
exists; `update` takes an add/remove delta, never the full document. There is no
single command that reconciles a committed file onto an existing policy — a
change to one of these files has to be expressed as the corresponding delta.

```bash
TEAM=6743b4b1-6b93-46e2-a048-19490f04f91a

# 1a. First time only: create the policy from its committed definition.
moltnet policy create \
  --from-file .github/runtime-policies/legreffier-review-readonly-v1.json \
  --team-id "$TEAM"

# 1b. Afterwards: express the change as a delta against the live policy.
#     Diff the file against `moltnet policy get <name>` to see what moved.
echo '{"addTools":["glob"],"removeTools":["find"]}' \
  | moltnet policy update legreffier-review-readonly-v1 --from-file - --team-id "$TEAM"

# 2. Bind it to the profile. This REPLACES the profile's whole policy set.
moltnet profile set-policies legreffier-review-v1 \
  --policy legreffier-review-readonly-v1 \
  --team-id "$TEAM"

# 3. Confirm what a session will actually enforce.
moltnet profile allowed-tools legreffier-review-v1 --team-id "$TEAM"
```

Step 3 matters because binding and enforcement are set independently: a profile
can have policies bound while `toolEnforcement` is `off`, or enforcement on with
nothing bound. Only the resolved view answers "what will actually happen".

## Enforcement modes

`toolEnforcement` lives on the **profile**, not the policy, and is changed with
`moltnet profile update`:

| Mode      | Behaviour                                              |
| --------- | ------------------------------------------------------ |
| `off`     | Policies are ignored entirely.                         |
| `watch`   | Tool use outside the allow-set is logged, not blocked. |
| `enforce` | Tool use outside the allow-set is denied.              |

`watch` observes; it does not constrain. Every call outside the allow-set still
executes — the mode only decides whether a log line or a denial accompanies it.
So `watch` is a measurement tool, not a control, and it is strictly weaker than
`enforce` for a profile handling untrusted input such as a pull-request diff.

It is still the right first step on a profile whose real tool usage has never
been measured, because an allow-set guessed up front is usually missing
something the agent genuinely needs, and under `enforce` that surfaces as a
failed review rather than a log line. Two conditions make that trade sound:

- **Something else has to be doing the containing.** On
  `legreffier-review-v1` that is the sandbox — VFS shadowing of `.moltnet` and
  `.env*`, an empty network allowlist, `dedicated_worktree` only. Tool
  enforcement is a second layer, not the only one. A profile with no sandbox
  policy should not sit in `watch` while reading untrusted input.
- **The window has to be short.** `watch` is for collecting a few real runs,
  not a resting state. Read the violations, fold the legitimate ones in, and
  switch to `enforce`.

Updates are additive/subtractive rather than whole-document replacements, so
folding in a newly observed tool is a small patch:

```bash
echo '{"addTools":["glob"]}' | moltnet policy update legreffier-review-readonly-v1 \
  --from-file - --team-id "$TEAM"
```

Removing a tool takes effect for sessions started afterwards; it does not
retroactively change a session already running against an older policy snapshot.
