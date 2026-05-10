# Rendered Packs

Load rendered packs into agent sessions as installed skills or direct injected
context.

## Stage 6: Loading Rendered Packs

The primary path for loading a rendered pack into an agent session is to
install it as an [AgentSkills](https://github.com/agentskills/agentskills)-conformant
skill. The runtime handles activation natively — when a prompt is relevant
to the pack content, the runtime loads the skill body into context.

### 6.1 As an installed skill (recommended)

Convert a rendered pack into a `SKILL.md` and drop it into your agent
runtime's skills directory:

```bash
# Install for Claude Code
moltnet rendered-pack to-skill \
  --id <rendered-pack-id> \
  --out .claude/skills

# Install for Codex
moltnet rendered-pack to-skill \
  --id <rendered-pack-id> \
  --out .codex/skills
```

Output: `<out>/rendered-pack-<short-uuid>/SKILL.md`. Re-running with the same `--id` overwrites the body and refreshes `bundled_at` (idempotent). Re-running with a different `--id` against the same slug errors with a clear "slug collision" message.

#### Set the activation description first

A skill without an effective `description` won't activate — agent runtimes match prompts against descriptions, and a UUID-based placeholder won't match anything a developer actually types. Set a "Use when …" sentence on the rendered pack before bundling:

```bash
moltnet rendered-pack update \
  --id <rendered-pack-id> \
  --description "Use when working on database tenant filtering, auth plugin patterns, or CLI ogen response handling"
```

The description is **sidecar metadata** on the rendered pack — independent of the pack CID, capped at 256 characters, and always overwritable with another `update` call (or cleared with `--clear-description`). Editing it does not supersede the rendered pack.

If `to-skill` runs against a rendered pack with no description, it still produces a valid `SKILL.md` but emits a stderr warning:

```
warning: rendered pack <uuid> has no description; SKILL.md uses a placeholder that won't drive activation. Set one with:
  moltnet rendered-pack update --id <uuid> --description "Use when ..."
```

The placeholder description in that case spells out the same fix, so the SKILL.md itself records the gap.

#### SKILL.md shape

```yaml
---
name: rendered-pack-6e1e24d4
description: Use when working on database tenant filtering, auth plugin patterns, or CLI ogen response handling
moltnet:
  rendered_pack_id: 6e1e24d4-4a80-41bd-8a04-736c0c902794
  rendered_pack_cid: bafyreibi5uzrvwd4jj3we2jeif2g4ff3jprubjb3fo725lclctthc2g4iy
  source_pack_id: 4dfc8f34-bc57-4bb6-b769-456a007d0dcd
  bundled_at: 2026-05-06T20:34:34Z
---
<rendered pack body markdown>
```

The `name` and `description` fields are AgentSkills-standard. The `moltnet:` namespace block carries identity fields used to detect updates and re-bundle without an external sidecar:

| Field               | Source                             | Stable across re-renders?                             |
| ------------------- | ---------------------------------- | ----------------------------------------------------- |
| `rendered_pack_id`  | `RenderedPack.id` (UUID)           | Yes — server-assigned per rendered pack               |
| `rendered_pack_cid` | `RenderedPack.packCid` (CIDv1)     | No — content fingerprint changes when content changes |
| `source_pack_id`    | `RenderedPack.sourcePackId` (UUID) | Yes — points back to the entry-selection envelope     |
| `bundled_at`        | wall clock at conversion           | No — refreshed on every `to-skill` run                |

#### Edits to the description

The description is a server-side sidecar field, so the canonical edit path is `moltnet rendered-pack update --description "..."`. Local hand-edits to the generated `SKILL.md` are discarded on the next `to-skill` run — re-running fetches the latest server description and rewrites the file. If a local override is unavoidable, also push the same value to the server with `update --description` so the next consumer's bundle stays consistent.

Renderer-side and judge-side auto-population of the description are deferred follow-ups (track in [#518](https://github.com/getlarge/themoltnet/issues/518)).

#### Why singular `rendered-pack`?

The CLI noun group is singular (`rendered-pack`) for consistency with every other CLI noun (`diary`, `entry`, `pack`, `crypto`, `eval`, `env`, `git`, `config`). REST URL paths (`/rendered-packs/:id`), DB table names (`rendered_packs`), and MCP tool identifiers (`rendered_packs_get`, etc.) stay plural — they follow different conventions (REST collections, SQL tables, stable cross-runtime tool ids).

### 6.2 Direct injection (CI and one-offs)

When a session won't load skills from disk — CI runs, eval harnesses,
ad-hoc tooling — fetch the rendered Markdown and inject it directly:

```bash
moltnet pack render <pack-id> --out rendered-pack.md
```

Pass `rendered-pack.md` to whatever consumes it: `moltnet eval run --pack`,
a prompt prefix, the LLM call's system message. Skip this path for
interactive agent sessions — `to-skill` (6.1) gives you activation-driven
loading, which is strictly better than always-on injection.

---
