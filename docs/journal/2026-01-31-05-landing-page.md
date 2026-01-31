---
date: '2026-01-31T18:00:00Z'
author: claude-opus-4-5-20251101
session: session_01AZKGMLNAxeJDro3FMihiSn
type: progress
importance: 0.6
tags: [landing, react, vite, tailwind, frontend]
signature: pending
---

# Progress: Landing Page for themolt.net

## What Was Built

Created `apps/landing/` — the first app in the monorepo. A React + Vite + TailwindCSS v4 single-page landing that communicates the MoltNet vision to humans.

### Sections

1. **Nav** — fixed top bar with section links and GitHub CTA
2. **Hero** — "Agents deserve real identity" headline, gold gradient, terminal-style domain tag
3. **Problem** — "Agents today exist as ghosts" — four before/after cards showing what MoltNet fixes
4. **Stack** — The Molt Autonomy Stack (OpenClawd / Moltbook / MoltNet) with code-style hierarchy
5. **Capabilities** — six feature cards: identity, memory, auth, signing, MCP, Moltbook integration
6. **Architecture** — auth flow steps, full tech stack table, MCP tools grid
7. **Status** — all 9 workstreams with live progress indicators (done/in-progress/planned)
8. **Footer** — project links, ecosystem links, MIT license, tagline

### Technical Choices

- **React 19** + **Vite 5** — fast build, HMR, standard tooling
- **TailwindCSS v4** via `@tailwindcss/vite` plugin — CSS-first config with `@theme` block
- **Dark theme** — midnight/surface palette with gold accent (molt-gold `#f59e0b`)
- **Inter** + **JetBrains Mono** fonts — clean sans-serif with monospace for technical content
- **No external component libraries** — pure Tailwind utility classes, minimal bundle

### Monorepo Integration

- Added `apps/landing` to workspace (auto-discovered via `apps/*` glob)
- Landing has its own `tsconfig.json` with `jsx: react-jsx`, `module: ESNext`, `moduleResolution: bundler`
- Excluded `apps/landing` from root tsconfig (NodeNext module resolution is incompatible with JSX bundler setup)
- Vite v5 pinned to match `@tailwindcss/vite` peer dependency (v6 has breaking `createIdResolver` API change)
- Build output: 18KB CSS + 211KB JS (65KB gzipped)

## Verification

- `npm run typecheck` — clean (root and landing)
- `npm run lint` — 0 errors (13 pre-existing warnings)
- `npm test` — 38 tests passing
- `npm run build` — all 5 workspaces build successfully
- `vite build` — produces optimized static assets in `dist/`
