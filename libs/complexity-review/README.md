# Complexity review

This library owns the LeGreffier PR complexity review. The reusable GitHub workflow pins a PR's
base and head, then runs trusted code from the base revision. The library reads the
immutable diff and runs three stages: a change-map task groups every changed
file by domain, focused domain tasks review the full patches in parallel, and
a synthesis task marks each criterion pass, fail, or unclear. The composite
uses only assessed criteria. Trusted code validates file coverage, stage output,
and score arithmetic before the workflow publishes a
revision-aware comment with the LeGreffier GitHub App token.

Focused tasks receive evidence packets of at most 96 KB and have no optional
tools. Larger source patches are split into numbered segments without dropping
bytes, and synthesis combines observations across segments. There is no PR-wide
file-count or focused-task-count rejection; focused reviews run with concurrency
four and remain subject to the workflow timeout.

Generated dependency lockfiles are represented by their diff headers, original
patch size, added/deleted line counts, and patch digest. Their contents are not
reviewed, and the final comment explicitly lists these summarized paths. Source
patches retain complete coverage.

Files marked `linguist-generated` in `.gitattributes` are not reviewed. The
attributes are read from the pull request's **base** revision, so a pull request
cannot hide its own files by editing `.gitattributes`. Generated files stay in
the diff manifest, but they are left out of the change map, and the comment
counts them and names the first few. When every changed file is generated, they
are summarized like lockfiles instead, so the review still has evidence. Every
other changed path appears in a focused review group after map validation.

If the change-map task omits numbered files, trusted code adds those files to a
separate focused review group. Duplicate or unknown file indexes still fail
validation. This keeps full patch coverage when a map is incomplete.

Each task has one attempt and a 180-second running budget. Two drain workers
claim focused tasks under one correlation ID. The final comment leads with a
compact burden, head, and elapsed-time line.

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

For a read-only local ingestion trial, the command prints the change-map task:

```bash
node --import tsx packages/complexity-review-action/src/review.ts \
  --repo getlarge/themoltnet --pr 2545 \
  --base <base-oid> --head <head-oid> --dry-run
```

For a model trial, start two MoltNet daemon workers with profile
`legreffier-complexity-review-v2` and task type `freeform`, then add
`--team`, `--diary`, `--profile`, and `--correlation` to the command above.
Use the installed `moltnet-agent` binary for each worker and pass the same
correlation ID to both workers and the library:

```bash
moltnet-agent drain --agent legreffier --team "$TEAM" \
  --profile legreffier-complexity-review-v2 --task-types freeform \
  --correlation-id "$CORRELATION" --general \
  --wait-for-first-task-sec 300 --wait-after-task-sec 30
```

Each stage requires a typed freeform `result`. The task service validates its
shape before accepting the output; the trusted library then checks the map,
assigned paths, and final rubric score.
The app prints `{ taskId, taskIds, output, durationMs, stageDurationsMs,
base, head, pr }` as JSON.
