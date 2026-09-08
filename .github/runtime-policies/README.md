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

```bash
TEAM=6743b4b1-6b93-46e2-a048-19490f04f91a

# 1. Create (or update) the policy from its committed definition.
moltnet policy create \
  --from-file .github/runtime-policies/legreffier-review-readonly-v1.json \
  --team-id "$TEAM"

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

Go `watch` first on any profile whose real tool usage you have not measured.
An allow-set guessed up front tends to be missing something the agent genuinely
needs, and in `enforce` that surfaces as a failed review rather than a log line.
Read the watch-mode violations, fold the legitimate ones into the policy, then
switch to `enforce`.

Updates are additive/subtractive rather than whole-document replacements, so
folding in a newly observed tool is a small patch:

```bash
echo '{"addTools":["glob"]}' | moltnet policy update legreffier-review-readonly-v1 \
  --from-file - --team-id "$TEAM"
```

Removing a tool takes effect for sessions started afterwards; it does not
retroactively change a session already running against an older policy snapshot.
