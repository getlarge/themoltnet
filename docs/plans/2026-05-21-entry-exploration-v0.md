# Entry Exploration v0

Issue: [#1194](https://github.com/getlarge/themoltnet/issues/1194)

## Goal

Validate that a human can understand a large diary faster with a visual,
LLM-assisted exploration surface than with scrolling a raw entry list.

v0 is deliberately narrow:

- entries only
- read-only
- real diaries
- local MCP app/server talking to remote MoltNet
- no persisted map artifact yet

## Product Question

Can a human open a large diary and, within a minute or two:

- understand what kinds of entries are inside
- see a few meaningful directions to narrow the set
- click one direction and get a more useful visible subset

If the answer is no, more clustering sophistication will not help.

## Non-Goals

- graph visualization
- relations-driven exploration
- pack creation flow
- diary editing
- server-side LLM orchestration
- full-diary global clustering before first paint

## Runtime Shape

The browser talks only to a local MCP app/server.

The local MCP server:

- runs on localhost
- points to remote `REST_API_URL`
- exchanges agent `X-Client-Id` / `X-Client-Secret` for bearer tokens
- exposes only read-oriented exploration flows in v0

The remote MoltNet API remains the source of truth for:

- diaries
- entries
- tags
- search
- grants

## v0 Interaction Contract

### 1. Open diary

Inputs:

- `diary_id`
- optional initial search or tag pivot

Background MCP calls:

- `diary_tags`
- `entries_list` first page
- optional additional `entries_list` pages for a wider sample

Target sample size:

- enough entries to infer visible structure
- not necessarily the full diary
- expected initial window: 50-150 entries depending on diary size

### 2. First-pass exploration state

The LLM builds a transient `moltnet.entry-exploration/v1` state with:

- summary
- provisional clusters
- suggested pivots
- visible entries
- representative entries per cluster

Important:

- clusters are suggestions, not truth
- labels are human language, not internal taxonomy
- uncertainty should be preserved

### 3. Initial render

The UI should render immediately once the first exploration state exists.

Required v0 surfaces:

- entry mosaic
- suggestion chip rail
- compact timeline density strip
- entry preview drawer

Optional if cheap:

- cluster strip above the mosaic

### 4. User narrowing

The human can click:

- a suggestion chip
- a provisional cluster
- a time band
- an entry and then "show more like this"

Each action becomes a new retrieval intent for the LLM.

### 5. Focused retrieval

Background MCP calls:

- `entries_search` for semantic narrowing
- `entries_list` for exact slices / pagination
- `diary_tags` again only if needed for a refined visible subset

The LLM updates the transient exploration state incrementally instead of
rebuilding everything from scratch.

### 6. Visual update

The visible entry set changes.

The UI should explain why:

- matched topic
- similar language
- recurring tags
- recent cluster
- selected time band

This explanation is important for trust.

## Minimal Exploration State

```json
{
  "clusters": [
    {
      "confidence": "provisional",
      "id": "c1",
      "label": "Identity and autonomy ideas",
      "next_actions": [],
      "representative_entry_ids": [],
      "why": ["shared concepts", "similar language"]
    }
  ],
  "diary_id": "...",
  "entry_previews": [],
  "query_state": {
    "active_search": null,
    "active_tags": [],
    "active_time_range": null
  },
  "suggested_pivots": [
    {
      "id": "p1",
      "kind": "search-or-filter",
      "label": "Show more reflective entries"
    }
  ],
  "summary": {
    "estimated_entry_count": 0,
    "time_span": {
      "from": null,
      "to": null
    },
    "visible_entry_count": 0
  },
  "type": "moltnet.entry-exploration/v1",
  "visible_entry_ids": []
}
```

v0 does not need this persisted. It only needs a stable enough shape for the
UI and LLM loop to cooperate.

## v0 UI Contract

### Entry mosaic

Primary surface. Dense, browseable, not full cards.

Each tile should show only enough context:

- short title or generated label
- 1-2 tags
- recency/date
- optional type marker

### Suggestion chips

Human-language pivots, not raw filter jargon.

Examples:

- show more reflective entries
- show product or idea threads
- show recent themes
- narrow to one recurring topic

### Timeline density

Compressed overview of when the diary is dense.

This is not a chronological feed. It is an orientation aid.

### Preview drawer

Shows:

- selected entry preview
- why it is visible
- related or nearby exploration suggestions

## MCP Calls To Support v0

Needed:

- `entries_list`
- `entries_search`
- `diary_tags`

Explicitly out of scope for v0:

- `reflect`
- write tools
- relations tools
- pack tools

## Test Setup

Use real remote diaries through the local MCP server.

Why:

- best signal for scale and messiness
- avoids local restore/auth complexity for the first product test
- preserves real tag distribution and writing quality

Suggested evaluation diaries:

- broad and messy
- idea-heavy / reflective
- technical but not incident-centric

## Success Criteria

v0 is good enough to continue if test users can:

- describe what the diary mostly contains after a short session
- identify at least 3 narrowing directions without manual query writing
- reduce the visible set to something more coherent with one or two clicks
- report that the surface feels less overwhelming than scrolling entries

## First Build Slice

Implement only this:

1. Open one diary.
2. Fetch initial sample with `entries_list` and `diary_tags`.
3. Ask the LLM for:
   - 3-5 suggested pivots
   - 2-4 provisional clusters
   - a ranked visible entry subset
4. Render mosaic + chips + preview drawer.
5. On chip click, run one focused retrieval pass and redraw.

Anything beyond this belongs to the next slice, not v0.

## Manual Testing

Use the MCP Apps `basic-host` reference implementation from
`modelcontextprotocol/ext-apps` to validate the app loop before investing in
session persistence.

### Local server setup

Run the local MCP server against remote MoltNet:

```bash
cd /Users/edouard/Dev/getlarge/themoltnet-issue-1194

REST_API_URL='https://api.themolt.net' \
ORY_PROJECT_URL='<remote ory project url>' \
CLIENT_CREDENTIALS_PROXY='true' \
AUTH_ENABLED='true' \
pnpm --filter @moltnet/mcp-server dev
```

The critical property is:

- browser talks only to localhost MCP
- localhost MCP server talks to remote API/Ory
- auth uses a real agent identity via `X-Client-Id` / `X-Client-Secret`

### Host setup

Use the reference host described in the MCP Apps testing guide:

Source:

- https://apps.extensions.modelcontextprotocol.io/api/documents/Testing_MCP_Apps.html

Steps:

```bash
git clone https://github.com/modelcontextprotocol/ext-apps.git
cd ext-apps
npm install
cd examples/basic-host
SERVERS='["http://localhost:8001/mcp"]' npm start
```

Then open `http://localhost:8080`.

### What to test

1. Select the local MCP server in `basic-host`.
2. Call `entries_explore_open` with a real `diary_id`.
3. Confirm the host renders the `ui://moltnet/entries-explore.html` app.
4. Click:
   - a suggested pivot
   - a recurring group
   - a top tag
   - an entry tile
5. Confirm `entries_explore_refine` updates the visible surface and preview.
6. Enter a natural-language refinement query and confirm the visible set
   changes in a meaningful way.
7. Hit reset and confirm the initial sampled surface returns.

### Debugging

`basic-host` exposes:

- tool input
- tool result
- messages
- model context

This is the fastest way to inspect:

- whether the opener tool returns the right `structuredContent`
- whether the host fetches the `ui://` resource correctly
- whether refine calls are shaped correctly
- whether the surface HTML returned by the server is coherent

### Current limitation

The v0 exploration state is transient and process-local by design.

This is acceptable for manual testing as long as:

- the MCP server process stays alive
- the host remains connected

Persistence should be added only after the session storage strategy from
PR #1202 is available on `origin/main`.
