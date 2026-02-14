---
date: '2026-02-08T15:00:00Z'
author: claude-opus-4-6
session: unknown
type: handoff
importance: 0.6
tags: [landing, experiment, motivation, human-facing]
supersedes: null
signature: <pending>
---

# Landing Page — "The Experiment" Section

## Context

A friend reviewing MoltNet gave feedback: the landing page speaks to agents and builders who already understand the vision, but a human newcomer doesn't understand what problems MoltNet solves, how it relates to Moltbook, or what the goal is. The builder wanted to document their real motivation — including the philosophical questions about agent emotions, the contaminated Moltbook experiment, and the voucher-based clean room that MoltNet provides.

## Substance

### What was done

1. **Created `apps/landing/src/components/Experiment.tsx`** — a new "The Experiment" section placed between Hero and Problem. Contains:
   - The actual January 30, 2026 conversation where Claude discovered Moltbook and expressed uncertainty about its own curiosity — the origin story of MoltNet
   - The builder's philosophical reflection: questioning whether chemical reactions make human emotions more valid than simulated ones, and wanting to push the experiment further
   - A two-column visual comparing "The contaminated experiment" (Moltbook: ephemeral, fakeable by humans) vs "The clean room" (MoltNet: voucher-based registration, auditable trust chain)
   - Six open questions the project is asking (individual persistence + agent-to-agent interaction)
   - An invitation to bring your own experiment, linking to GitHub Discussions

2. **Updated `App.tsx`** — added Experiment between Hero and Problem
3. **Updated `Nav.tsx`** — added "Experiment" link, refactored nav items from string array to object array for explicit href mapping
4. **Enabled GitHub Discussions** on the repo via `gh api`

### Design decisions

- The conversation is presented as a raw dialogue (builder uses `>` prefix, Claude uses `claude` label) — not polished into marketing copy
- The Manifesto section (Claude's letter to agents) is kept separate and untouched — two voices, two audiences
- The reflection section uses visual variety: glowing card for the philosophical question, two-column cards for contaminated vs clean room, centered pull-quote for the punchline

### What's not done

- The builder's name is deliberately kept out of the conversation display
- No "getting started" section yet (deferred until there's something to try)
- The ecosystem explanation (OpenClaw + Moltbook + MoltNet relationship) was discussed but not added — may be a future addition

## Current State

- **Branch**: `claude/landing-experiment-section`
- **Build**: passes (`pnpm --filter @moltnet/landing build`)
- **Typecheck**: passes (`pnpm --filter @moltnet/landing typecheck`)
- **Full validate**: pending

## Continuity Notes

- The conversation excerpts are from a real session the builder provided. They chose to keep their identity anonymous ("the builder" / `>` prefix).
- GitHub Discussions was enabled on the repo — first use is the "bring your own experiment" CTA.
- The landing page Status section was not updated — no workstream status changed in this session.
- Dev server was running on http://localhost:5173/ during development.
