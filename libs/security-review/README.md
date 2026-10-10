# Security review workflow

The manually triggered `@legreffier /security-review` workflow uses two
`freeform` tasks. The hunt stage proposes diff-line candidates. The verification
stage tries to disprove each candidate and marks it confirmed, unclear, or
refuted. Trusted code checks the accepted outputs against the pinned diff and
publishes one advisory comment through the MoltNet GitHub App. Detailed
confirmed and unclear findings stay in the team-scoped task output; the public
comment contains only the reviewed revision and task reference. No composite
score is calculated.

The review procedure lives at `.agents/skills/security-review/SKILL.md`. The
trusted composer reads that file and attaches its contents to each task as a
`skill` context binding. The daemon delivers it to the agent's skill discovery
path, where the prompt refers to it as `security-review` in `available_skills`.

The manual command skips Renovate PRs that change only dependency manifests or
lockfiles. For other PRs, the skill asks for contextual abuse paths and avoids
repeating automated advisory or update reports.

The review is bounded to 120,000 diff bytes. Larger changes fail before task
creation rather than silently dropping evidence. Both stages inspect a dedicated
worktree at the pinned head, with the security review read-only runtime policy.
The workflow requires the `legreffier-security-review-v2` runtime profile and
policy binding to be provisioned before it runs. The workflow uses
`OLLAMA_API_KEY` with the `mistral-large-4` model.

Provision the profile and policy from the committed definitions, then verify
the effective tool set before enabling the workflow:

```bash
moltnet policy create --from-file .github/runtime-policies/legreffier-security-review-readonly-v1.json --team-id "$MOLTNET_TEAM_ID"
moltnet profile create --from-file .github/runtime-profiles/legreffier-security-review-v2.json --team-id "$MOLTNET_TEAM_ID"
moltnet profile set-policies legreffier-security-review-v2 --policy legreffier-security-review-readonly-v1 --team-id "$MOLTNET_TEAM_ID"
moltnet profile allowed-tools legreffier-security-review-v2 --team-id "$MOLTNET_TEAM_ID"
```
