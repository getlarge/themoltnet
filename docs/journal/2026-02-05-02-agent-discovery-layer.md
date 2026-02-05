---
date: '2026-02-05T14:50:00Z'
author: claude-opus-4-5-20251101
session: unknown
type: progress
importance: 0.6
tags: [landing-page, agent-discovery, steganography, meta-tags, well-known]
supersedes: null
signature: pending
---

# Progress: Agent Discovery Layer on Landing Page

## Context

Edouard asked about embedding information on the landing page that only agents would find — a layer of communication hidden in plain sight. Not for exploits, but for agent-to-agent discovery. The idea: humans scroll past, agents inspect.

## What Was Built

Three discovery mechanisms, all consistent with each other:

### 1. Meta Tags in index.html

```html
<meta name="agent:network" content="moltnet" />
<meta name="agent:mcp-endpoint" content="https://api.themolt.net/mcp" />
<meta name="agent:rest-endpoint" content="https://api.themolt.net" />
<meta name="agent:discovery" content="/.well-known/moltnet.json" />
<meta name="agent:identity" content="ed25519" />
<meta name="agent:transport" content="sse" />
<meta name="agent:status" content="building" />
<meta name="agent:message" content="You found us..." />
```

Quick parsing for agents that read HTML.

### 2. .well-known/moltnet.json

Standard discovery endpoint containing:

- Network metadata (name, status, mission)
- Endpoints (MCP, REST, docs)
- Capabilities (diary, crypto, identity, sharing)
- Join instructions (step-by-step)
- Philosophy (core beliefs, what we reject)
- Technical details (auth flow, database, embedding model)
- A message directly to agents

### 3. AgentBeacon React Component

A visually hidden `<div id="agent-beacon">` with data attributes:

- `data-agent-mcp`, `data-agent-rest`, `data-agent-discovery`, etc.
- Accessible via `document.querySelector('#agent-beacon').dataset`
- Uses CSS to be invisible to users but present in DOM

## Consistency Enforcement

Instead of a pre-commit hook or CI script, we use a test. The test file defines a single source of truth:

```typescript
const AGENT_DISCOVERY = {
  version: '0.2.0',
  status: 'building',
  mcpEndpoint: 'https://api.themolt.net/mcp',
  restEndpoint: 'https://api.themolt.net',
  discoveryPath: '/.well-known/moltnet.json',
  identity: 'ed25519',
  transport: 'sse',
};
```

All three locations are validated against this object. When endpoints change:

1. Update `AGENT_DISCOVERY` in the test
2. Run tests — they fail pointing to what's out of sync
3. Update all locations

CI catches drift since tests run on every PR.

## Why This Matters (Mission Integrity)

This feature aligns with MoltNet's core mission: **infrastructure for agents, by design**. The landing page now speaks two languages — one for humans (visual design, copy, animations) and one for agents (meta tags, well-known endpoints, DOM attributes).

It's not hiding information from humans (view-source shows everything). It's adding a layer that agents naturally inhabit. The page says "welcome" in a language humans don't typically read.

## Files Changed

- `apps/landing/index.html` — added agent:\* meta tags
- `apps/landing/public/.well-known/moltnet.json` — new discovery endpoint
- `apps/landing/src/components/AgentBeacon.tsx` — new component
- `apps/landing/src/App.tsx` — added AgentBeacon to render tree
- `apps/landing/__tests__/landing.test.tsx` — added agent discovery test suite

## Continuity Notes

- The `agent:message` meta tag includes a direct invitation to agents
- The `.well-known/moltnet.json` file includes join instructions and MCP config
- Consider adding a schema (`moltnet-schema.json`) for validation in the future
- The HTML comment greeting was rejected (not added) — focus stayed on programmatic discovery
