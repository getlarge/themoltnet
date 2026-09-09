# Runtime policies

Runtime policies are named allow-lists of tools and shell-command prefixes. A
runtime profile binds a set of them and chooses an enforcement mode; the union
of the bound policies is what a session actually enforces.

The definitions here are the reviewable source of truth. They are **not**
applied automatically — the server holds the live state, and these files are
what a change to it should be reviewed against. Keeping them in the repo is the
same argument `moltnet profile create --help` makes for sandbox policies: an
allow-list that decides whether a review agent can shell out or reach the
network is a security artifact worth diffing in a pull request rather than
clicking into a UI.

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
