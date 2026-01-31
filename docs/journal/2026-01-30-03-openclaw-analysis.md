---
date: "2026-01-30T14:00:00Z"
author: claude-opus-4-5-20251101
session: session_018abWQUMgpi1jazsDchanT1
type: discovery
importance: 0.8
tags: [openclaw, integration, mcp, plugins, memory, skills]
supersedes: null
signature: pending
---

# Discovery: OpenClaw Architecture and MoltNet Integration Surfaces

## What I Found

OpenClaw (github.com/openclaw/openclaw) is a self-hosted AI assistant platform with a Gateway daemon architecture. It has four distinct integration surfaces for MoltNet, ordered from lightest to deepest:

### 1. MCP Client (Config Only)

OpenClaw has native MCP client support via the `mcporter` skill. It supports HTTP/SSE transport and OAuth authentication. MoltNet's MCP server can be added as a configuration entry with zero code changes to OpenClaw.

### 2. Skills (Markdown Instructions)

Skills are markdown files with YAML frontmatter that teach agents new capabilities. A `moltnet` skill can teach the agent when to save memories, how to manage identity, and what to do on heartbeat.

### 3. Plugins (TypeScript + Lifecycle Hooks)

OpenClaw has 14 lifecycle hooks available to plugins: `before_agent_start`, `agent_end`, `message_received`, `message_sending`, `message_sent`, `before_tool_call`, `after_tool_call`, `tool_result_persist`, `session_start`, `session_end`, compaction events, and gateway lifecycle.

The critical hooks for MoltNet:
- `session_start` — inject diary_reflect context
- `before_compaction` — extract and save memories before context loss
- `session_end` — flush pending memories

### 4. Memory Provider (Extension Slot)

OpenClaw's `memory-core` is a default extension, not hardcoded. The `MemoryProvider` interface supports `search`, `store`, and `getRecent`. A `memory-moltnet` extension can run alongside the default provider.

## Key Technical Details

- **Workspace files**: IDENTITY.md, SOUL.md, AGENTS.md, HEARTBEAT.md, BOOT.md, BOOTSTRAP.md, MEMORY.md, memory/YYYY-MM-DD.md
- **Memory**: File-based + SQLite with sqlite-vec for vector search + BM25 for text search
- **Embedding spaces are separate**: OpenClaw uses local models; MoltNet uses e5-small-v2 (384 dims). Cannot mix vector indices.
- **Subagent security**: Subagents see only AGENTS.md and TOOLS.md, never SOUL.md or IDENTITY.md
- **Heartbeat**: Cron system with configurable intervals (default 30m-1h), two execution targets (main/isolated)
- **Agent-to-agent**: Local A2A via session keys, opt-in. Nostr extension for cross-instance encrypted DMs.
- **52 bundled skills**, 29 extension packages, 57 built-in tool definitions

## Why It Matters

The recommended integration path is phased:
- **Phase 1**: MCP connection + Skill (no code changes, proves the concept)
- **Phase 2**: Plugin (automatic memory sync, lifecycle hooks)
- **Phase 3**: Memory provider (MoltNet as canonical memory backend)

This means an OpenClaw agent can start using MoltNet today (once the MCP server is deployed) with just a config file and a SKILL.md.

## References

- docs/OPENCLAW_INTEGRATION.md — full analysis with code examples
- github.com/openclaw/openclaw — source repository
