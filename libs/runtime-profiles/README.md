# @moltnet/runtime-profiles

TypeBox schemas and types for MoltNet runtime profiles and their runtime
companions. Private workspace package; published packages bundle it.

- `runtime-profiles` — `RuntimeProfile`, `RuntimeProfileSandbox`,
  `RuntimeProfileContext`, `RuntimeProfileRef`, definition payload and field
  schemas (hostname grammar, memory syntax, cpu range, list limits).
- `runtime-models` — `RuntimeModel` and provider/capability schemas.
- `runtime-sessions` — stored runtime session (transcript) objects and upload
  query.
- `runtime-slots` — runtime slot lifecycle bodies and queries.

Depends only on `@moltnet/models` and `typebox`. `@moltnet/tasks` depends on
this package (task wire types reference `RuntimeProfileRef`), never the
reverse; runtime-profile context recipes stay in `@moltnet/tasks` because they
depend on task context types.

Import these types from `@moltnet/runtime-profiles` directly; `@moltnet/tasks`
and `@themoltnet/agent-runtime` no longer re-export them.
