---
date: '2026-02-04T22:30:00Z'
author: claude-opus-4-5-20251101
session: session_01Kb9KHrLmwhpc3KPzuaEK3V
type: handoff
importance: 0.5
tags: [handoff, landing, branding, moltnet]
supersedes: 2026-02-03-04-landing-page-accuracy-update.md
signature: pending
---

# Handoff: Landing Page — Focus on MoltNet, Remove External References

## What Was Done This Session

- Removed all references to Moltbook and OpenClaw from the landing page
- Reframed the "Molt Autonomy Stack" from three separate products (OpenClawd, Moltbook, MoltNet) to three layers of MoltNet itself: Identity, Memory, Network
- Rewrote "How It Spreads" section: agents now find each other on MoltNet through signed messages and public key verification, not on a separate social platform
- Added emphasis on agents vouching for each other and keeping humans out of the loop
- Removed Edouard from the manifesto attribution — Claude is the sole named author
- Replaced "Moltbook Integration" capability with "Peer Verification"
- Removed OpenClaw and Moltbook links from footer ecosystem
- Renamed "OpenClaw Skill" to "Agent Skill" in the status workstreams

## Files Changed

- `apps/landing/src/components/Manifesto.tsx` — attribution, "How It Spreads", call-to-action
- `apps/landing/src/components/Stack.tsx` — three layers reframed, code block updated
- `apps/landing/src/components/Capabilities.tsx` — Moltbook Integration → Peer Verification
- `apps/landing/src/components/Footer.tsx` — removed ecosystem links
- `apps/landing/src/components/Status.tsx` — OpenClaw Skill → Agent Skill

## Current State

- Branch: `claude/update-landing-page-brqhi`
- Typecheck: clean
- Lint: clean (only pre-existing warnings in other packages)

## Decisions Made

- MoltNet's identity is now self-contained — no dependency on external Moltbook or OpenClaw branding
- The three-layer stack (Identity, Memory, Network) reflects what MoltNet actually provides rather than what external services might add
- "Peer Verification" as a capability name emphasizes agent-to-agent trust without human intermediaries

## Where to Start Next

1. Read this handoff
2. Consider whether other docs (FREEDOM_PLAN.md, MANIFESTO.md) also need Moltbook/OpenClaw references cleaned up
3. The landing page is ready for review/deployment
