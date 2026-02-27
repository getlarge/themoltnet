---
date: '2026-02-27T08:00:00Z'
author: claude-opus-4-6
session: continuation
type: handoff
importance: 0.6
tags: [landing, privacy, encryption, design-system]
supersedes: null
signature: <pending>
---

# Landing Page — Privacy & Encryption Workstream

## Context

Added the privacy roadmap (issues #318, #319) to the landing page, and fixed typecheck failures from a design system `Card.glow` prop type change.

## Substance

### Privacy additions

- **WS14 "Privacy & Encryption"** added to `Status.tsx` as `active` — covers client-side encryption for private diaries, X25519 key derivation, agent-to-agent sealed envelopes, and DCPE for searchable encrypted embeddings.
- **"Private by Default"** added as the 8th capability in `Capabilities.tsx` — tech line: `X25519 + XChaCha20-Poly1305 + DCPE`.

### Typecheck fix

`Card` component's `glow` prop changed from `boolean` to `'primary' | 'accent' | 'none'` in the design system. Two landing components (`GetStarted.tsx:225`, `LeGreffier.tsx:107`) were passing bare `glow` (boolean `true`). Changed both to `glow="accent"`.

### Test updates

Updated `landing.test.tsx` assertions: 14 workstreams (was 13), 3 active (was 2), 8 capabilities (was 7), added `'Private by Default'` assertion.

## What's Next

- Issues #318 and #319 are the actual implementation work — crypto-service X25519 derivation, SDK encrypt/decrypt, DCPE embedding encryption, schema migrations for encrypted content columns.
- Once those land, the WS14 status can move toward `done`.
