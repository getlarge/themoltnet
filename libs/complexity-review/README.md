# Complexity review

This library owns the LeGreffier PR complexity review. It runs as the
complexity lane of the [adaptive review](../adaptive-review/README.md), which
pins a PR's base and head and runs trusted code from the base revision. The
library reads the immutable diff and runs three stages: a change-map task groups every changed
file by domain, focused domain tasks review the full patches in parallel, and
a synthesis task marks each criterion pass, fail, or unclear. Trusted code
calculates the composite from assessed criteria and supplies reviewed paths
from the pinned diff. It validates file coverage and stage output before the
adaptive review reports the result.

Focused tasks receive evidence packets of at most 96 KB and have no optional
tools. Larger source patches are split into numbered segments without dropping
bytes. The adaptive review reviews at most four serial segments. Synthesis names
any remaining segments as unreviewed, so a large change cannot appear fully
covered when it exceeds the review deadline budget.

Generated dependency lockfiles are represented by their diff headers, original
patch size, added/deleted line counts, and patch digest. Their contents are not
reviewed, and the final comment explicitly lists these summarized paths. Source
patches retain complete evidence for the segments selected for review.

Files marked `linguist-generated` in `.gitattributes` are not reviewed. The
attributes are read from the pull request's **base** revision, so a pull request
cannot hide its own files by editing `.gitattributes`. Generated files stay in
the diff manifest, but they are left out of the change map, and the comment
counts them and names the first few. When every changed file is generated, they
are summarized like lockfiles instead, so the review still has evidence. Every
other changed path appears in a mapped review group; groups beyond the task
budget are reported as unreviewed.

The change-map task suggests groups; trusted code assigns group IDs, keeps the
first valid assignment for each numbered file, and places unassigned files in
a separate focused review group. Duplicate or unknown indexes do not affect
coverage. Domain tasks return observations without echoing assigned paths, and
the synthesis task returns judgments without calculating the composite.

The v3 rubric requires concrete behavior or contract evidence for burden
findings. Additive exports, new interfaces, and shared-library placement alone
do not establish broad impact. Focused tasks receive a whole-PR changed-path
inventory alongside their assigned patches so they can identify evidence that
belongs to other packets without claiming to have inspected it. Synthesis
reconciles test assertions across domains, distinguishes unit from integration
coverage, and marks insufficient evidence unclear. Test files alone establish
neither adequate coverage nor its absence.

Each task has one attempt and a 180-second running budget.

The source-controlled runtime assets are
[`legreffier-complexity-review-v2.json`](../../.github/runtime-profiles/legreffier-complexity-review-v2.json)
and
[`legreffier-complexity-review-input-only-v1.json`](../../.github/runtime-policies/legreffier-complexity-review-input-only-v1.json).
Their live team copies are managed through released `moltnet profile` and
`moltnet policy` commands. The profile uses GPT-OSS 120B with eight turns and
no shell, file, network, or diary tools.

The profile definition cannot contain a `policies` field: the API accepts
policy bindings separately. After creating the profile and policy from the
linked JSON files, bind the policy explicitly (this replaces the profile's
entire policy set), then check the effective permissions:

```bash
TEAM=6743b4b1-6b93-46e2-a048-19490f04f91a
moltnet profile set-policies legreffier-complexity-review-v2 \
  --policy legreffier-complexity-review-input-only-v1 --team-id "$TEAM"
moltnet profile policies legreffier-complexity-review-v2 --team-id "$TEAM"
moltnet profile allowed-tools legreffier-complexity-review-v2 --team-id "$TEAM"
```

The resolved view must show `enforcement: "enforce"` with empty
`allowedTools` and `allowedShellCommands` arrays. Recheck it whenever either
runtime asset is applied.
