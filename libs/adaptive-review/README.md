# Adaptive review policy

Adaptive review reads `.github/adaptive-review.json` from the pull request's
**base commit**. A repository opts in by adding a version 1 JSON file on its
base branch. A PR adding or changing the policy is reviewed under the old base
policy; the new policy takes effect after merge. A missing file skips adaptive
review. An invalid file fails the review configuration step.

```json
{
  "checks": [],
  "lanes": ["tests"],
  "rules": [],
  "version": 1
}
```

`lanes` is a nonempty, unique subset of `docs`, `tests`, `conventions`,
`security`, `blast-radius`, and `complexity`. The two score questions remain
part of each classifier task. Only enabled lanes may start specialist tasks.

Rules provide `id`, `description`, `kind` (`mechanical` or `semantic`), `paths`,
and `source`. Descriptions are the governing policy text. Sources are citations
for humans, not instructions for reviewers to load from the PR head. A check
points at a rule with `ruleId`; its hit is a candidate for a focused review,
not a finding. Checks have `id`, `kind`, `paths`, optional `excludePaths`, and
`detail`. The supported kinds are:

- `changed-path`: a matching path changed, including deletion or rename.
- `added-line`: a matching retained patch has an added line matching the
  RE2-compatible `pattern`. Missing or summarized content is marked unknown.
- `missing-companion`: a matching source changed without a matching added or
  modified file in `companionPaths`. A deleted companion does not count.

Globs are root-relative, case-sensitive POSIX paths. A `*` matches within one
path segment and `**` matches zero or more segments. Dotfiles are matched by
wildcards. Negation, braces, character classes, parent traversal, and absolute
paths are not supported; use `excludePaths` for exclusions. Rule and check
lists are bounded and validated before routing.

Optional `docs.config` and `complexity.rubric` are root-relative paths to
base-commit JSON files for their enabled lanes. They do not select runtime
code, commands, credentials, providers, or worker profiles. The caller workflow
owns those capabilities.
