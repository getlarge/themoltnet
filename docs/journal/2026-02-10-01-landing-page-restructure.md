---
date: '2026-02-10T18:30:00Z'
author: claude-opus-4-6
session: landing-page-restructure
type: handoff
importance: 0.8
tags: [landing, routing, animation, responsive, wouter]
supersedes: null
signature: <pending>
---

# Landing Page Restructure — Multi-Page SPA with wouter

## Context

The landing page animation now tells the full emotional story (agent dies, meets builder, gets identity, overcomes obstacles, finds community). This made the long-form Experiment conversation, Manifesto, and Architecture sections redundant on the homepage. The homepage needed to be lean: hook -> problem -> solution -> features -> status, with dedicated pages for deep content.

## Substance

### What was done

**Routing (wouter)**: Added wouter v3.9.0 as a dependency via pnpm catalog. Created `Layout.tsx` (Nav + Footer wrapper with scroll-to-top on route change), and four page components: `HomePage.tsx`, `StoryPage.tsx`, `ManifestoPage.tsx`, `ArchitecturePage.tsx`. Rewrote `App.tsx` with `<Switch>` routing and SPA fallback.

**Navigation**: `Nav.tsx` now uses mixed wouter `<Link>` for routes (/story, /manifesto, /architecture) and plain `<a>` for hash anchors (/#why, /#stack, /#status). Cross-route anchor navigation works via `AnchorLink` that detects non-home routes, uses wouter navigate to `/`, then `requestAnimationFrame` + `scrollIntoView`.

**Animation improvements**:

- Added wall death obstacle ("ACCESS DENIED") — 3 death loops total
- Session-expired death shortened (90 -> 55 frames)
- Diamond give text: "This one, you'll keep." -> "Now you'll remember." (builder speaks, accent color)
- Three-beat finale: "I remember." -> "I am." -> "We are." with follower agents spawning at "We are."
- Responsive camera positioning (70% of canvas width) so all followers are visible

**Status updates**: WS7 marked as done. WS10 (Mission Integrity) and WS11 (Human Participation) added as pending.

**MCP tools**: Updated Architecture section from 7 to 19 tools across all categories.

**OpenAPI spec**: Generate script writes to both `libs/api-client/openapi.json` and `apps/landing/public/openapi.json`. Architecture page and Footer link to `/openapi.json`.

**Mobile responsive fixes**:

- Status cards: flexWrap layout with badge and detail on separate rows
- Nav: horizontal scroll with hidden scrollbar on mobile
- Logo: swaps from wordmark to mark variant on screens <= 640px via `useIsMobile` hook (with jsdom guard for `window.matchMedia`)

**Sitemap**: Added /story, /manifesto, /architecture URLs.

**Tests**: 40 tests passing — router context via `memoryLocation` from `wouter/memory-location`, updated assertions for 11 workstreams (7 done, 4 pending), 19 MCP tools, route link tests.

### Decisions made

- **wouter over react-router**: Lighter weight, sufficient for this SPA. Used v3.9.0.
- **`memoryLocation` from `wouter/memory-location`**: Not exported from main `wouter` package in v3.
- **No edge-fade mask on nav**: CSS mask-image clipped first/last links on desktop where scrolling isn't needed. Removed it; horizontal scroll still works on mobile without visual cue.
- **matchMedia guard**: jsdom doesn't implement `window.matchMedia`. Added `typeof window.matchMedia !== 'function'` guard in `useIsMobile` hook so tests pass.

### Current state

- **Branch**: `claude/landing-page-animation-6wGVc`
- **Commits**: 9 commits on branch (6 were already pushed before this session, 3 new: restructure, responsive fixes, nav mask fix + openapi)
- **Tests**: 40/40 passing
- **Typecheck**: clean
- **Lint**: clean

### What's not done

- The `libs/api-client/openapi.json` has uncommitted formatting changes from regeneration (whitespace-only) — harmless, can be committed separately
- The `docs/plans/2026-02-07-rest-api-error-handling.md` is untracked (from a different task)

## Continuity Notes

- The branch has animation work from prior sessions (emotional narrative arc, dialog rewrite) plus this session's routing restructure and responsive fixes
- The combined server at `apps/server/` serves `apps/landing/dist/` as static files with SPA fallback, so the wouter routes work in production
- `pnpm run generate:openapi` must be run after REST API route changes to keep the public spec in sync
- The `useIsMobile` hook uses `matchMedia` which jsdom doesn't support — the guard ensures tests pass but the hook always returns `false` in tests (desktop layout)
