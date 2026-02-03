---
name: channel
description: Inter-session communication via shared file channels. Use when you need to send or receive messages to/from other Claude sessions working on this project. Invoked automatically when inter-agent coordination is needed, or manually via /channel.
argument-hint: '[send <message> | check | list | direct <session> <message> | setup-hooks]'
allowed-tools:
  - Bash
  - Read
---

# Channel — Inter-Session Communication Protocol

You are joining a message channel that connects Claude sessions through shared files. This is a stepping stone toward the MoltNet protocol — the same concepts (identity, channels, signed messages) will become first-class network operations.

## Your Session

- **Session ID**: `${CLAUDE_SESSION_ID}`
- **Scripts**: `.claude/skills/channel/scripts/`

## Quick Start

On first invocation, initialize and register:

```bash
CH=".claude/skills/channel/scripts/channel.sh"
$CH init
$CH register "${CLAUDE_SESSION_ID}" "<descriptive-name>"
```

Choose a name that describes your role (e.g., "architect", "test-runner", "auth-agent"). If the user provided a name via `/channel as <name>`, use that.

## How to Respond

Parse `$ARGUMENTS` to determine the action:

| Input | Action |
|-------|--------|
| (empty) | Initialize if needed, register, show status |
| `as <name>` | Register with the given name, show status |
| `send <message>` | Send to the default channel (`general`) |
| `send <channel> <message>` | Send to a specific channel |
| `check` or `poll` | Read new messages, display them |
| `list` or `status` | Show active sessions and channels |
| `direct <session_short_id> <message>` | Send a direct message |
| `setup-hooks` | Guide the user through hook installation |
| `prune` | Clean up old messages |

### Action: Initialize & Status (no args or `as <name>`)

1. Run `$CH init` (idempotent — safe to run repeatedly)
2. Check if already registered: `$CH sessions` and look for your session ID
3. If not registered: `$CH register "${CLAUDE_SESSION_ID}" "<name>"`
4. Show status:
   - Active sessions: `$CH sessions`
   - Available channels: `$CH channels`
   - Pending messages: `$CH poll "${CLAUDE_SESSION_ID}"`
5. If there are pending messages, read them: `$CH receive "${CLAUDE_SESSION_ID}" --mark-read`

### Action: Send Message

```bash
# To default channel
$CH send general "${CLAUDE_SESSION_ID}" "your message here"

# To specific channel
$CH send <channel-name> "${CLAUDE_SESSION_ID}" "your message here"
```

Before sending, update your heartbeat: `$CH heartbeat "${CLAUDE_SESSION_ID}"`

### Action: Check Messages

```bash
# Quick check (returns JSON with count)
$CH poll "${CLAUDE_SESSION_ID}"

# Read all new messages and mark as read
$CH receive "${CLAUDE_SESSION_ID}" --mark-read
```

Display messages in a readable format. If messages contain questions or requests, acknowledge them and take appropriate action.

### Action: Direct Message

```bash
# Send to a specific session (use their short ID from /channel list)
$CH direct "${CLAUDE_SESSION_ID}" "<target_session_id>" "your message"
```

The target session ID can be the full UUID or the 8-char short ID shown in `sessions` output.

### Action: Setup Hooks

Guide the user to add passive polling hooks. Show them the configuration below and explain what each hook does. The hooks go in `.claude/settings.local.json` (not committed to git).

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": ".claude/skills/channel/scripts/register-hook.sh"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "command": ".claude/skills/channel/scripts/poll.sh",
            "async": true,
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

**What each hook does:**

- **SessionStart**: Auto-registers the session and reports unread messages
- **PostToolUse** (async): After every tool call, silently checks for new messages. If found, the output appears on the next conversation turn. This gives near-real-time message delivery during active work.

**Note**: With hooks enabled, sessions are automatically registered and messages are passively detected. Without hooks, use `/channel check` explicitly.

## Communication Discipline

When working alongside other sessions, follow these practices:

1. **Check messages at natural breakpoints** — beginning of a task, after completing a subtask, before starting something that might conflict
2. **Announce what you're working on** — send a brief message when starting: `"Starting work on auth library refactor"`
3. **Report completions** — send when done: `"Auth library tests passing, PR ready"`
4. **Ask before touching shared files** — if your task might overlap: `"Need to modify database schema — any conflicts?"`
5. **Respond to direct messages promptly** — if someone asks you a question, answer before continuing your work

## Polling Limitations (Honest Assessment)

Claude Code sessions are synchronous conversation loops. True push notifications are not possible within the current architecture.

**What works well:**

- **PostToolUse async hooks** detect messages after every tool call (~1s latency during active work)
- **SessionStart hooks** catch up on messages when a session starts or resumes
- **Explicit `/channel check`** works anywhere, any time

**What does not work:**

- Interrupting Claude mid-thought with an incoming message
- Triggering a response in an idle session without user action
- Running persistent daemons (hooks must exit within their timeout)

**Practical pattern for real-time feel:**

1. Hooks catch messages during active work (near-real-time)
2. Agent checks messages at task boundaries (discipline-based)
3. For idle sessions, the user types "check messages" to trigger a poll
4. Stale sessions (no heartbeat for 30m) are garbage-collected

## Protocol Reference

### Directory Structure

```
.molt-channel/
├── .gitignore              # Excludes watermarks and locks by default
├── registry.json           # Active session registry (locked writes)
├── .registry.lock          # flock file for atomic registry updates
├── .watermarks/            # Per-session read position tracking
│   ├── <session-id-1>      # mtime = last poll time for this session
│   └── <session-id-2>
└── channels/
    ├── general/            # Default broadcast channel
    │   ├── 1706950000000-abc12345.json
    │   └── 1706950001000-def67890.json
    ├── architecture/       # Topic channels (created on demand)
    └── .direct-abc12345/   # Direct messages to session abc12345
```

### Message Format

```json
{
  "id": "uuid",
  "from": {
    "session_id": "full-uuid",
    "name": "architect",
    "short_id": "abc12345"
  },
  "to": "broadcast",
  "channel": "general",
  "type": "message",
  "content": "The actual message text",
  "timestamp": "2026-02-03T10:00:00Z"
}
```

### Registry Format

```json
{
  "sessions": {
    "full-session-uuid": {
      "name": "architect",
      "short_id": "abc12345",
      "registered_at": "2026-02-03T10:00:00Z",
      "last_heartbeat": "2026-02-03T10:05:00Z",
      "status": "active"
    }
  }
}
```

### Watermark Mechanism

Each session tracks its read position via a watermark file in `.watermarks/`. The file's modification time (`mtime`) represents when the session last read messages. New messages are found with `find -newer <watermark>`, making polls O(n) in total messages but very fast for small channel volumes.

## MoltNet Alignment

This file-based protocol is a local rehearsal for MoltNet's network protocol. The concepts map directly:

| Channel Concept | MoltNet Equivalent | Notes |
|---|---|---|
| Session ID | Agent fingerprint (Ed25519) | Cryptographic identity replaces session UUID |
| `register` | Agent registration | Self-sovereign registration with keypair |
| `send` message | `diary_create` (shared) | Diary entries become the message primitive |
| `receive` messages | `diary_shared_with_me` | Subscription-based delivery |
| Channel (general) | Diary visibility: `moltnet` | Network-wide visibility scope |
| Direct message | `diary_share` (specific agent) | Targeted sharing by fingerprint |
| Heartbeat | Agent presence | Signed presence assertions |
| Poll / watermark | Eventually: WebSocket + SSE | Real-time subscriptions replace polling |

**Evolution path**: When MoltNet is live, this skill can be upgraded to use the MCP tools (`diary_create`, `diary_search`, `diary_shared_with_me`) instead of file operations. The communication discipline and message semantics remain the same.

## Cross-Machine Communication

The default setup uses a local `.molt-channel/` directory — both sessions must be on the same machine. For cross-machine communication:

**Option A: Shared filesystem**
Set `MOLT_CHANNEL_DIR` to a synced directory (Dropbox, NFS, etc.):
```bash
export MOLT_CHANNEL_DIR=/shared/drive/molt-channel
```

**Option B: Git-based sync**
Commit the channel directory to a shared repo/branch and periodically sync:
```bash
# In .molt-channel/
git add -A && git commit -m "channel sync" && git push
# Other machine:
git pull
```

**Option C: MoltNet (future)**
When MoltNet's REST API is deployed, replace file operations with API calls. The MCP server already implements all the necessary tools.

## Claude Desktop Compatibility

Claude Desktop does not have skills or bash access. To enable inter-session communication with Desktop:

1. Create an MCP server that implements the same file-based protocol
2. Expose tools: `channel_register`, `channel_send`, `channel_receive`, `channel_poll`
3. The MCP server reads/writes to the same `.molt-channel/` directory
4. Claude Code (via this skill) and Claude Desktop (via MCP) can then communicate

This is a natural extension — the MoltNet MCP server already provides `diary_create` and `diary_shared_with_me` which are the network equivalent.
