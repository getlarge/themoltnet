---
date: '2026-02-03T23:00:00Z'
author: claude-opus-4-5-20251101
session: inter-session-communication
type: handoff
importance: 0.8
tags: [skills, inter-session, communication, moltnet-prep, hooks]
supersedes: null
signature: pending
---

# Inter-Session Communication Skill

## Context

The user requested a skill enabling two Claude Code sessions to communicate with each other, as preparation for agents using the MoltNet network. Key challenges identified: how to poll for new messages, how to handle the fundamentally synchronous nature of Claude sessions, and how to make this work on both CLI and Desktop.

## What Was Built

### `/channel` Skill (`.claude/skills/channel/`)

A complete file-based inter-session messaging system with four components:

1. **`SKILL.md`** — Teaches Claude the protocol and how to respond to `/channel` invocations. Handles: init, register, send, receive, direct messages, status, and hook setup guidance.

2. **`scripts/channel.sh`** — Core operations (12 subcommands):
   - `init` / `register` / `deregister` — session lifecycle
   - `send` / `direct` / `receive` — message passing
   - `poll` — lightweight check for hooks (JSON output)
   - `sessions` / `channels` / `heartbeat` — status and presence
   - `prune` / `gc` — cleanup old messages and stale sessions
   - Uses `flock` for atomic registry updates, `find -newer` for watermark-based polling

3. **`scripts/poll.sh`** — Lightweight PostToolUse hook that checks for new messages after every tool call. Parses session_id from hook JSON input, runs a fast poll, and outputs formatted messages for Claude's context.

4. **`scripts/register-hook.sh`** — SessionStart hook for automatic session registration and unread message notification.

### Protocol Design

```
.molt-channel/
├── registry.json          # Active sessions (flock-protected)
├── .watermarks/<session>  # Per-session read position (mtime-based)
└── channels/
    ├── general/           # Broadcast channel
    ├── <topic>/           # Topic channels (on demand)
    └── .direct-<short>/   # Direct messages to specific session
```

Messages are JSON files named `{epoch_ms}-{short_id}.json`, enabling chronological sorting and sender identification from the filename alone.

### MoltNet Alignment

The protocol maps directly to MoltNet concepts:
- Session ID → Agent fingerprint (Ed25519)
- `send` → `diary_create` with moltnet visibility
- `receive` → `diary_shared_with_me`
- Direct messages → `diary_share` to specific agent
- Channels → Diary visibility scopes
- When MoltNet is live, the skill can be upgraded to use MCP tools instead of file operations

## Key Decisions

1. **File-based over git-based** as default: Zero setup, instant latency on same machine. Git sync is documented as optional for cross-machine use.

2. **Watermark-based polling**: Each session's last-read position is tracked by the mtime of its watermark file. `find -newer` gives O(n) polling but is fast for typical channel volumes.

3. **Hook-based passive detection**: PostToolUse async hooks provide near-real-time message delivery during active work without blocking tool execution. This is the best approximation of push notifications within Claude Code's constraints.

4. **Honest about limitations**: The skill documents that true push notifications are impossible — idle sessions can't be interrupted, and hooks must exit within their timeout.

5. **Dot-prefixed direct message dirs** (`.direct-<id>`): Prevents glob `*/` from including other sessions' direct messages in channel listings. Required explicit fix for `find` patterns.

## Polling Architecture

```
┌──────────────────────────┐     ┌──────────────────────────┐
│    Session A (Claude)    │     │    Session B (Claude)     │
│                          │     │                           │
│  PostToolUse hook fires  │     │  /channel send "hello"    │
│  → poll.sh checks        │     │  → writes JSON file       │
│    .molt-channel/        │     │    to .molt-channel/      │
│  → finds new message     │     │    channels/general/      │
│  → outputs to Claude     │     │                           │
│  → Claude sees on next   │     │                           │
│    turn                  │     │                           │
└──────────────────────────┘     └──────────────────────────┘
              ▲                              │
              └──────────────────────────────┘
                    shared filesystem
```

Three polling modes:
1. **Passive (hooks)**: PostToolUse async hook → ~1s latency during active work
2. **Explicit**: `/channel check` → on-demand
3. **Session start**: register-hook.sh → catches up on unread messages

## What's Next

1. **Test with real Claude sessions** — the scripts are tested manually, but need validation with actual hook integration
2. **Desktop MCP bridge** — an MCP server reading/writing the same `.molt-channel/` directory would enable Claude Desktop participation
3. **Git sync mode** — implement `channel.sh sync` for cross-machine communication via a shared git branch
4. **Upgrade to MoltNet** — when the REST API is deployed, swap file operations for API calls

## Files Changed

- `.claude/skills/channel/SKILL.md` (new) — skill instructions
- `.claude/skills/channel/scripts/channel.sh` (new) — core operations
- `.claude/skills/channel/scripts/poll.sh` (new) — PostToolUse hook
- `.claude/skills/channel/scripts/register-hook.sh` (new) — SessionStart hook
- `.gitignore` — added `.molt-channel/`
