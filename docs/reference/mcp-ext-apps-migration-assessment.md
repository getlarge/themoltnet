# MCP Apps → `@modelcontextprotocol/ext-apps`: Migration Assessment

> **Status:** Research only. No implementation in this PR. See
> [getlarge/themoltnet#1209](https://github.com/getlarge/themoltnet/issues/1209).
>
> **Date:** 2026-05-21. Pinned to `@modelcontextprotocol/ext-apps@1.7.2` and
> `@getlarge/fastify-mcp@1.3.0-getlarge.5` (catalog) — installed `.3` at time
> of writing (see Appendix A).

## TL;DR

**Recommendation: Option B — add a thin client-side adapter in MoltNet now; defer server-side adoption indefinitely.**

`@getlarge/fastify-mcp` does not depend on the upstream `McpServer` from
`@modelcontextprotocol/sdk` at runtime — it reimplements the JSON-RPC dispatch
loop natively against Fastify request/reply. The `ext-apps/server` helpers
(`registerAppTool`, `registerAppResource`) require an `McpServer` instance and
therefore cannot be dropped in. The helpers themselves do almost nothing other
than `_meta.ui.resourceUri` normalisation and mime-type defaulting; the value
in the ext-apps package is overwhelmingly on the **client side**
(`/app-bridge`, `/react`, `PostMessageTransport`, `applyDocumentTheme`,
`useAutoResize`, host-context handling, sandbox-proxy lifecycle).

Concretely: keep `fastify.mcpAddTool` / `mcpAddResource` registration as-is,
and replace the inline hand-rolled `createHostBridge` JavaScript in
`apps/mcp-server/src/task-app.ts` with the imported ext-apps client bridge,
bundled into the served HTML. This captures ~80% of the protocol-drift risk
the issue calls out at ~20% of the cost of restructuring `@getlarge/fastify-mcp`.

## Current state

### Files in scope

| File                                                | Status             | Notes                                                                                                                                                              |
| --------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/mcp-server/src/task-app.ts`                   | exists, 1116 lines | Single-file MCP app: inline HTML + CSS + vanilla JS bridge + Fastify tool/resource registration.                                                                   |
| `apps/mcp-server/src/app.ts`                        | exists             | Registers `@getlarge/fastify-mcp` plugin (lines 297–306 per exploration) and calls `registerTaskApp` (lines 312–322). MCP-specific CORS handling at lines 110–151. |
| `apps/mcp-server/src/entry-explore-app.ts`          | **does not exist** | Referenced by #1209. Assumed to follow the `task-app.ts` pattern when it lands.                                                                                    |
| `apps/mcp-server/src/mcp-app-host-bridge-source.ts` | **does not exist** | Referenced by #1209. Likely the planned extraction point for the shared bridge JS.                                                                                 |
| `libs/task-ui/`                                     | exists             | React component library (`task-attempts-table.tsx`, `task-queue-table.tsx`, etc.). **Not currently consumed** by `task-app.ts`'s inline HTML.                      |

### `task-app.ts` protocol surface (hand-rolled)

Registration (`task-app.ts:1082–1115`):

```ts
fastify.mcpAddTool(
  {
    name: 'tasks_app_open',
    inputSchema: TaskAppOpenSchema,
    outputSchema: TaskAppOpenOutputSchema,
    _meta: {
      ui: {
        resourceUri: TASK_APP_RESOURCE_URI, // 'ui://moltnet/tasks.html'
        visibility: ['model', 'app'],
      },
    },
  },
  (args) => handleTasksAppOpen(args, deps),
);

fastify.mcpAddResource(
  {
    name: 'tasks-app',
    uriPattern: 'ui://moltnet/tasks.html',
    mimeType: 'text/html;profile=mcp-app', // === ext-apps RESOURCE_MIME_TYPE
    _meta: TASK_APP_RESOURCE_META, // { ui: { csp: {...}, prefersBorder: false } }
  },
  () => handleTasksAppResource(),
);
```

Browser bridge (`task-app.ts:415–490`, `createHostBridge`):

| postMessage method              | Direction  | Already in hand-rolled bridge |
| ------------------------------- | ---------- | ----------------------------- |
| `ui/initialize`                 | app → host | ✅                            |
| `ui/notifications/initialized`  | app → host | ✅                            |
| `ui/notifications/size-changed` | app → host | ✅                            |
| `tools/call`                    | app → host | ✅                            |
| `ui/open-link`                  | app → host | ✅                            |
| `ui/notifications/tool-input`   | host → app | ✅                            |
| `ui/notifications/tool-result`  | host → app | ✅                            |

### ext-apps full protocol surface (v1.7.2)

Extracted from `dist/src/app.js`:

```
ui/initialize                                    ui/open-link
ui/notifications/initialized                     ui/download-file
ui/notifications/size-changed                    ui/message
ui/notifications/tool-input                      ui/update-model-context
ui/notifications/tool-input-partial              ui/resource-teardown
ui/notifications/tool-result                     ui/request-display-mode
ui/notifications/tool-cancelled                  ui/notifications/host-context-changed
ui/notifications/request-teardown                ui/notifications/sandbox-proxy-ready
ui/notifications/sandbox-resource-ready          (plus standard tools/call, notifications/message)
```

The hand-rolled bridge covers **7 of 18** ext-apps methods. The unsupported
13 are not currently used by `task-app.ts`, but they are the surface area
that will drift if we stay on the hand-rolled implementation as MCP Apps
evolves: partial tool input streaming, tool cancellation, teardown lifecycle,
host-context changes (notably theme), display-mode requests, sandbox-proxy
handshakes.

### `@getlarge/fastify-mcp` surface (v1.3.0-getlarge.3 installed)

`node_modules/.pnpm/@getlarge+fastify-mcp@1.3.0-getlarge.3/.../dist/index.d.ts`
exports only types and the Fastify plugin. The plugin decorates
`FastifyInstance` with:

- `mcpAddTool`, `mcpAddResource`, `mcpAddPrompt`
- `mcpBroadcastNotification`, `mcpSendToSession`, `mcpElicit`
- `mcpSetResourceSubscribeHandler`, `mcpSetResourceUnsubscribeHandler`

`grep -r "@modelcontextprotocol/sdk" dist/` against the installed package
returns **zero matches**. The SDK is declared as a `devDependencies` entry in
`package.json` (for tests / type parity) but is not imported at runtime. The
handler dispatch (`handlers.d.ts`) operates directly on `JSONRPCRequest`
objects against an internal `Map<string, MCPTool>` — there is no `McpServer`
instance in this codepath.

**This is the linchpin of the assessment.** `ext-apps/server`'s
`registerAppTool` and `registerAppResource` accept
`Pick<McpServer, "registerTool" | "registerResource">` (see
`dist/src/server/index.d.ts:42`). There is no such object to pass.

## Compatibility assessment

| Capability                                                       | fastify-mcp 1.3.0-getlarge.5 | ext-apps 1.7.2                                        | Compatible?                                        |
| ---------------------------------------------------------------- | ---------------------------- | ----------------------------------------------------- | -------------------------------------------------- |
| Tool registration                                                | `fastify.mcpAddTool`         | `server.registerTool` (via `registerAppTool` helper)  | Structurally similar; **no shared object**         |
| Resource registration                                            | `fastify.mcpAddResource`     | `server.registerResource` (via `registerAppResource`) | Same                                               |
| `_meta.ui.resourceUri` normalisation                             | manual in caller             | automatic in helper                                   | Trivial to replicate                               |
| `RESOURCE_MIME_TYPE` (`text/html;profile=mcp-app`)               | set by caller                | default in helper                                     | Trivial to replicate                               |
| Capability negotiation (`extensions.io.modelcontextprotocol/ui`) | not implemented              | `getUiCapability()`                                   | Needs a hook in fastify-mcp's initialize handler   |
| Notification dispatch (`tools_list_changed`, etc.)               | `mcpBroadcastNotification`   | `server.sendToolListChanged()` etc.                   | Method names differ; semantics equivalent          |
| Session management                                               | Fastify-native (SSE / Redis) | `Transport` abstraction over SDK                      | Different model; SDK requires owning the transport |

**Conclusion:** server-side adoption requires either (i) exposing an
`McpServer` facade out of `@getlarge/fastify-mcp`, which means upstreaming
a real change since the plugin doesn't construct an `McpServer` today, or
(ii) reimplementing the two ~50-line ext-apps helpers locally as thin
wrappers around `fastify.mcpAddTool` / `mcpAddResource`. Option (ii) is
trivial; option (i) is a substantive refactor of fastify-mcp.

## Options

### Option A — Keep everything custom

Status quo. No work, no risk of breakage, but accept that the inline
`createHostBridge` will drift from upstream MCP Apps. Any new ext-apps
notification (e.g. tool cancellation, display-mode negotiation, sandbox
lifecycle) costs one bespoke implementation per call site.

### Option B — Client-side adapter only (recommended)

Adopt `@modelcontextprotocol/ext-apps` (top-level export) + `/app-bridge` on
the **browser side**. Extract the inline `<script type="module">` block in
`task-app.ts` into a bundled module that imports the ext-apps client and
re-exports a typed bridge. Server-side registration stays on
`fastify.mcpAddTool` / `mcpAddResource`; introduce two ~30-line local helpers
(`registerMoltnetAppTool`, `registerMoltnetAppResource`) that mirror
`ext-apps/server`'s API shape so the registration call sites are familiar to
anyone reading the upstream docs.

**Why this is the right cut:**

- The 13-method protocol gap is on the _client_ (theme, teardown,
  tool-input-partial, sandbox-proxy). The server side is mostly
  registration plumbing, which we already do correctly with the modern
  `_meta.ui.resourceUri` format.
- `@getlarge/fastify-mcp` is a forked plugin we don't control upstream
  decisively (`-getlarge.5` suffix). Changing it requires coordinating
  with that fork; changing one file in `apps/mcp-server/` does not.
- The hard work in ext-apps is `PostMessageTransport`,
  `applyDocumentTheme`, `useAutoResize`, host-context-changed plumbing.
  We get all of that for free.
- Reversible: if the client adapter turns out badly, we delete it and the
  inline `<script>` block returns.

### Option C — Extend `@getlarge/fastify-mcp` upstream

Open a PR against the fork (or its parent) to surface an `McpServer`-shaped
facade — either by building a real `McpServer` instance internally and
proxying the `registerTool` / `registerResource` calls into the Fastify
plugin's tool/resource map, or by adding a `fastify.mcpServer` getter that
returns a structural duck for `Pick<McpServer, "registerTool" | "registerResource">`.

High effort, requires upstream alignment, blocked by the
single-maintainer cycle on the fork. Earns full upstream compatibility
including future ext-apps server-side features (capability negotiation,
list-changed notifications). Worth revisiting only if MoltNet ends up
running more than three or four MCP apps and the registration boilerplate
becomes a maintenance burden.

### Decision matrix

Score 1 (worst) to 5 (best). Higher is better.

| Criterion                                      | A — Keep custom | B — Client adapter | C — Extend fastify-mcp |
| ---------------------------------------------- | --------------- | ------------------ | ---------------------- |
| 1. Protocol conformance (drift reduction)      | 1               | 4                  | 5                      |
| 2. Transport compatibility (fastify-mcp as-is) | 5               | 5                  | 2                      |
| 3. Effort to land                              | 5               | 3                  | 1                      |
| 4. Surface area lost vs hand-rolled            | 5               | 4                  | 4                      |
| 5. Forward maintenance ownership               | 1               | 4                  | 3                      |
| 6. Bundle / iframe runtime cost                | 5               | 3                  | 3                      |
| 7. Auth / CORS impact on `app.ts`              | 5               | 5                  | 4                      |
| 8. Reversibility                               | 5               | 4                  | 2                      |
| **Total**                                      | **32**          | **32**             | **24**                 |

A and B tie on totals; **B wins on the qualitative axes that matter** —
protocol conformance and forward maintenance. A's score is propped up by
"no work" criteria, which is fine until the next ext-apps spec bump.

## Recommendation

Adopt **Option B** when the entry-exploration app lands (or when capacity
appears, whichever is first). Adoption sequence:

1. **Add `@modelcontextprotocol/ext-apps@^1.7` to the catalog**
   (`pnpm-workspace.yaml`). Pin to a known-good version; bump deliberately.
2. **Extract the host bridge** — replace the inline `createHostBridge`
   function in `task-app.ts` with an imported module. This is what the
   `mcp-app-host-bridge-source.ts` file in #1209 is presumably for. Bundle
   it (esbuild) into a single `<script>` block at HTML serve time so the
   resource stays self-contained.
3. **Add two thin server-side helpers** in
   `apps/mcp-server/src/mcp-app-helpers.ts`:

   ```ts
   // pseudo-signature
   registerMoltnetAppTool(fastify, name, config, handler);
   registerMoltnetAppResource(fastify, name, uri, config, readCallback);
   ```

   These mirror `ext-apps/server`'s API but call `fastify.mcpAddTool` /
   `mcpAddResource` under the hood. They default mime to
   `RESOURCE_MIME_TYPE` and normalise `_meta.ui.resourceUri` ↔
   `_meta["ui/resourceUri"]` exactly like the upstream helpers.

4. **Migrate `task-app.ts`** to use the new helpers and the imported
   bridge. Behaviour-equivalent change, easy to review.
5. **Land `entry-explore-app.ts`** using the same helpers from day one.
6. **Defer Option C** unless the helper surface keeps growing and starts
   to feel like a fork of ext-apps/server. Revisit at that point.

## Migration sketch — tasks app

**Before** (`task-app.ts`, ~1100 lines, single file):

- Inline HTML string with ~600 lines of vanilla JS bridge + UI.
- `fastify.mcpAddTool` / `mcpAddResource` called directly with hand-set
  `_meta.ui.resourceUri` and mime type.

**After:**

- `apps/mcp-server/src/mcp-app-helpers.ts` (new, ~80 lines): two
  `registerMoltnetApp*` wrappers; constants `RESOURCE_MIME_TYPE` re-exported.
- `apps/mcp-server/src/mcp-app-host-bridge-source.ts` (new, ~150 lines):
  imports from `@modelcontextprotocol/ext-apps/app-bridge`, exposes a
  typed bridge factory keyed to MoltNet's tool surface. Bundled via
  esbuild at server build time; emitted as a string into the served HTML.
- `apps/mcp-server/src/task-app.ts` shrinks to ~400 lines: HTML/CSS for
  the task surface plus a `<script type="module">` that imports the
  bundled bridge. Registration uses `registerMoltnetAppTool` /
  `registerMoltnetAppResource`.
- No change to `app.ts` (CORS, `@getlarge/fastify-mcp` wiring untouched).

## Migration sketch — entries-explore app (hypothetical)

When `entry-explore-app.ts` lands, it should:

- Use `registerMoltnetAppTool` / `registerMoltnetAppResource` from day one.
- Import the shared bridge from `mcp-app-host-bridge-source.ts`.
- Resource URI: `ui://moltnet/entries-explore.html`, mime
  `text/html;profile=mcp-app`, `_meta.ui` shape matching the tasks app.

If the entry-explore PR lands before this work begins, **defer the helper
extraction until both apps exist** so we can validate the helper shape
against two real call sites rather than one. Two examples is the right
number to extract an abstraction; one is a guess.

## Open questions / risks

- **fastify-mcp lock drift.** The catalog says `^1.3.0-getlarge.5` but the
  resolved install in `node_modules/.pnpm/` is `1.3.0-getlarge.3`. Either the
  lockfile or the install is stale. Investigate before adoption work begins;
  fastify-mcp internals may have changed between `.3` and `.5`.
- **Bundling story.** `apps/mcp-server` uses `vite build` SSR. The host
  bridge needs to ship as a string inside the served HTML; that's an esbuild
  / rollup step orthogonal to vite. Confirm the build pipeline handles it
  before committing to extraction.
- **ext-apps protocol-version pinning.** The hand-rolled bridge declares
  `protocolVersion: '2026-01-26'`. Upstream `app-bridge` negotiates
  automatically via the SDK; behaviour at version mismatch needs a smoke
  test.
- **`libs/task-ui` not consumed today.** Migration could optionally pull the
  React components in `libs/task-ui` into the task app via the
  `ext-apps/react` adapter (`useApp`, `useAutoResize`, `useDocumentTheme`),
  but that's a separate refactor. Out of scope for #1209.
- **Two referenced files don't exist.** `entry-explore-app.ts` and
  `mcp-app-host-bridge-source.ts` are forward-looking in #1209. This
  assessment treats both as hypothetical; revisit the migration sketch if
  the actual files diverge from the `task-app.ts` pattern when they land.

## Appendix A — Sources

- `npm view @modelcontextprotocol/ext-apps@1.7.2` (published 2026-05-15).
- ext-apps tarball extracted to `/tmp/ext-apps/package/`:
  - `dist/src/server/index.d.ts` — `registerAppTool`, `registerAppResource`,
    `getUiCapability`, `EXTENSION_ID = "io.modelcontextprotocol/ui"`.
  - `dist/src/app.d.ts` — `RESOURCE_URI_META_KEY = "ui/resourceUri"`,
    `RESOURCE_MIME_TYPE = "text/html;profile=mcp-app"`.
  - `dist/src/app-bridge.d.ts` — `AppBridge`, `PostMessageTransport`,
    `getToolUiResourceUri`, `buildAllowAttribute`.
  - `dist/src/app.js` — full list of 18 `ui/*` / `notifications/*` method strings.
- Installed fastify-mcp (`1.3.0-getlarge.3`):
  - `node_modules/.pnpm/@getlarge+fastify-mcp@1.3.0-getlarge.3_.../node_modules/@getlarge/fastify-mcp/dist/index.d.ts`
    — public exports list, no `McpServer` re-export.
  - `…/dist/types.d.ts` lines 50–73 — Fastify module augmentation declaring
    `mcpAddTool`, `mcpAddResource`, etc.
  - `…/dist/handlers.d.ts` — JSON-RPC handler signature operating on internal
    `Map<string, MCPTool>`, no SDK `McpServer` involvement.
  - `…/package.json` — `@modelcontextprotocol/sdk` listed only under
    `devDependencies`.
- Local source:
  - `apps/mcp-server/src/task-app.ts` — full file, especially lines 24–25,
    27–35 (resource meta), 415–490 (host bridge), 1069–1080
    (`handleTasksAppResource`), 1082–1115 (`registerTaskApp`).
  - `apps/mcp-server/package.json` — `@getlarge/fastify-mcp: catalog:`.
  - `pnpm-workspace.yaml` — `@getlarge/fastify-mcp: ^1.3.0-getlarge.5`.
  - `pnpm-lock.yaml` — resolved `1.3.0-getlarge.5(@opentelemetry/api@1.9.0)(@sinclair/typebox@0.34.48)`.
- Diary entry capturing the scoping decision for this investigation:
  MoltNet entry `27b5de25-800a-4d75-aa2d-c7cbe6a5782b` (signed,
  `entryType: semantic`, tags `decision`, `issue:1209`).
