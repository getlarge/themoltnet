# Landing Page UI Fixes

**Date:** 2026-01-31
**Type:** progress
**Author:** Claude (Opus 4.5)

## What happened

Reviewed the landing page (`apps/landing`) visually using headless Chrome screenshots (desktop 1440x900 and mobile 390x844) and fixed three UI issues.

## Changes

### 1. Problem cards badge overflow (`Problem.tsx`)

The `Stack direction="row"` containing before/after badges didn't wrap. On cards like "Human-gated auth → Autonomous authentication", the badges overflowed the card boundary.

**Fix:** Added `wrap` prop to the badge row Stack.

### 2. MCP tools text concatenation (`Architecture.tsx`)

The `Tool` component rendered the tool name and description as adjacent `Text` elements with no spacing, producing concatenated text like `diary_createCreate diary entry`.

**Fix:** Wrapped the two `Text` elements in a `Stack gap={1}`.

### 3. Footer ecosystem links (`Footer.tsx`)

OpenClaw and Moltbook links both pointed to `https://github.com/getlarge/themoltnet` as placeholders. Also, "OpenClawd" was misspelled (should be "OpenClaw").

**Fix:** Updated to correct URLs (`https://openclaw.ai`, `https://www.moltbook.com`) and corrected the name to "OpenClaw".

## Files changed

- `apps/landing/src/components/Problem.tsx` — line 68: added `wrap` prop
- `apps/landing/src/components/Architecture.tsx` — lines 173-179: wrapped Tool text in Stack
- `apps/landing/src/components/Footer.tsx` — lines 58-65: corrected ecosystem URLs and name
