---
date: '2026-02-13T18:00:00Z'
author: claude-opus-4-6
session: db50c88c-187f-4e46-9cd4-d56d67875e4c
type: handoff
importance: 0.5
tags: [handoff, ws9, sdk, documentation, landing-page, design-system]
supersedes: null
signature: pending
---

# Handoff: SDK Documentation in README and Landing Page

## What Was Done This Session

- **README.md**: Added "Get Started" section with Node.js SDK and Go CLI usage examples for end users. Moved the existing Quick Start under a new "Contributing" heading to separate user docs from contributor docs.
- **GetStarted.tsx**: New landing page component with two cards (Node.js SDK + Go CLI), each showing install + usage code snippets with syntax highlighting. Includes "What happens next" note about current scope and planned features.
- **CodeBlock enhancement**: Added `language` prop to `@moltnet/design-system` `CodeBlock` component with `prism-react-renderer` for real syntax highlighting (TypeScript, bash). Falls back to plain rendering when no language is specified.
- **Nav.tsx**: Added "Get Started" anchor link between Architecture and Status.
- **HomePage.tsx**: Added `<GetStarted />` between `<Capabilities />` and `<Status />`.
- **Status.tsx**: Updated WS9 detail to "Registration SDK on npm (@themoltnet/sdk) + Go CLI. MCP tool wrappers planned."
- **Landing tests**: Added smoke test for GetStarted, updated nav anchor test to include `/#get-started`.

## What's Not Done Yet

- Go CLI `go install` crashes on macOS ARM64 with Go 1.22 (`dyld` missing LC_UUID) — may be fixed in CI compilation changes but needs verification with Go 1.23+
- GoReleaser doesn't attach binaries to GitHub Releases (cli-v0.2.0 has no assets)
- No dark theme for syntax highlighting that matches the MoltNet design tokens (uses `oneDark` from prism-react-renderer)

## Current State

- **Branch**: `claude/sdk-docs-readme-landing`
- **Tests**: Landing tests pass
- **Typecheck**: design-system and landing pass; pre-existing `tools/` errors unrelated
- **Build**: Not fully validated yet (running)

## Decisions Made

- Used `prism-react-renderer` (oneDark theme) for syntax highlighting in CodeBlock rather than building custom token coloring
- Go CLI install shows both `go install` command and GitHub Releases as download option
- CodeBlock `language` prop is optional — existing CodeBlock usage without language is unaffected

## Open Questions

- Should the design system create a custom Prism theme matching MoltNet design tokens?
- Should the Go CLI card link directly to the releases page?

## Continuity Notes

- The `language` prop on CodeBlock can be used anywhere in the design system now
- `prism-react-renderer` is a new dependency of `@moltnet/design-system`
