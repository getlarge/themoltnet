---
name: canva-explore
description: >-
  Explore Canva designs via MCP and extract visual/structural patterns into
  MoltNet diary entries. Uses editing transactions for deep visual inspection
  (fills, assets, element positions) and brand kit/template discovery.
  Patterns include reusable asset IDs for faithful reproduction.
---

# Canva Explore Skill

Scan a Canva account's designs and extract reusable design patterns into
MoltNet diary entries. This is the **Generate** stage for design knowledge —
entries are later consolidated and compiled into context packs that guide
new design creation.

## Prerequisites

- LeGreffier must be initialized (agent identity active, diary exists)
- `DIARY_ID` must be resolved
- Canva MCP connected (provides `search-designs`, `get-design`,
  `start-editing-transaction`, `get-assets`, `list-brand-kits`,
  `search-brand-templates` tools)

## When to trigger

- User says "explore my Canva designs", "scan my designs", "find design
  patterns"
- User wants to prepare context before creating a new design
- First time setting up design memory for a Canva account

## Workflow overview

1. **Discover**: `search-designs` + `search-brand-templates` +
   `list-brand-kits`
2. **Deep inspect**: `start-editing-transaction` on representative designs
   to get fills (images/logos with asset IDs), text elements with positions,
   and page thumbnails with actual visual rendering
3. **Catalog assets**: `get-assets` on discovered asset IDs to get names,
   tags, thumbnails, and metadata
4. **Analyze**: use thumbnail vision + fill/asset data + text content to
   extract visual, structural, and brand patterns
5. **Create entries**: write structured diary entries with asset IDs and
   visual details
6. **Cancel transactions**: always cancel editing transactions after
   inspection (read-only use)

## Key tools and what they expose

| Tool                        | Returns                                                                                                                                                                          |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `search-designs`            | Design IDs, titles, thumbnails, page counts                                                                                                                                      |
| `search-brand-templates`    | Brand templates (saved reusable templates)                                                                                                                                       |
| `list-brand-kits`           | Brand kits with colors, fonts, logos                                                                                                                                             |
| `get-design`                | Design metadata, owner, URLs, page count                                                                                                                                         |
| `get-design-pages`          | Page dimensions, thumbnail URLs                                                                                                                                                  |
| `get-design-content`        | Richtext only (no style data)                                                                                                                                                    |
| `start-editing-transaction` | **Full design data**: richtexts with element IDs + positions + dimensions, fills with asset IDs + element types (IMAGE/SHAPE/RECT), page thumbnails with actual visual rendering |
| `get-assets`                | Asset metadata: name, tags, thumbnail, dimensions, smart tags                                                                                                                    |
| `get-design-thumbnail`      | Page thumbnail within an editing transaction (requires `transaction_id` + `page_index`)                                                                                          |

**Critical**: `get-design-content` returns only text. To extract visual
patterns (colors, logos, images, layout positions), you MUST use
`start-editing-transaction`. Always `cancel-editing-transaction` after
inspection.

## Extraction targets

For each design (or group of similar designs), extract:

### Visual patterns (from editing transaction fills + thumbnails)

- **Color palette**: dominant colors from thumbnail vision, background hues
- **Typography**: text element dimensions reveal hierarchy; ALL CAPS vs
  mixed case from richtext content
- **Layout**: element positions (`top`, `left`) and dimensions (`width`,
  `height`) from fills and richtexts reveal grid structure
- **Imagery**: fill asset IDs → `get-assets` reveals image types (photos,
  logos, icons, QR codes) via `smart_tags` and `name`

### Structural patterns (from text content + page structure)

- **Page count**: typical length for this design type
- **Section structure**: how content is organized (intro -> body -> CTA)
- **Recurring elements**: which asset IDs appear on multiple pages
  (logos, icons) — cross-reference fill `asset_id` across `page_index`
- **Transitions**: visual flow between pages

### Brand patterns (from brand kits + cross-design analysis)

- **Brand kit**: `brand_kit_id` if available (pass directly to generation)
- **Brand templates**: template IDs for faithful reproduction
- **Consistency signals**: assets that appear across all designs
- **Variation signals**: what changes per design type

### Reusable assets (from get-assets)

- **Logos**: brand logos with asset IDs for `asset_ids` parameter
- **Icons**: recurring icons (calendar, ticket, arrow, etc.)
- **Speaker photos**: transparent-background portraits
- **QR codes**: event-specific scannable codes

## Entry creation

### Design pattern entry (semantic)

```
entries_create({
  diary_id: "<DIARY_ID>",
  title: "Design pattern: <pattern-name>",
  content: "<structured content below>",
  tags: ["source:canva-explore", "design-type:<type>", "pattern:<category>",
         "explore-session:<timestamp>"],
  importance: <5-8>,
  entry_type: "semantic"
})
```

Content template:

```
Pattern: <name>
Design type: <presentation|course|book|social|document|...>
Source designs: <design titles/IDs that exhibit this pattern>

Visual signature:
  Colors: <palette description with hex values from thumbnail analysis —
    e.g., "sky blue #3DB4F2 bg, white text, NestJS red #E0234E accents">
  Typography: <text conventions — e.g., "ALL CAPS speaker names,
    sans-serif headings, element heights suggest 48pt/18pt hierarchy">
  Layout: <element positions — e.g., "logo top-left (top:0, left:0),
    title centered (left:630), speaker cards mirrored left/right">
  Imagery: <asset-backed — e.g., "NestJS Vienna logo (MAGGsnyc9qc) on
    every page, transparent speaker photos, Meetup wordmark (MADnBsVUSPw)">

Reusable assets:
  - <asset_id>: <name> — <purpose> (e.g., "MAGGsnyc9qc: NestJS Vienna
    logo — appears on all pages, top-left or top-right")
  - <asset_id>: <name> — <purpose>

Brand kit: <brand_kit_id if available, else "none">
Brand template: <template_id if design is saved as template, else "none">

Structure:
  Pages: <typical count or range>
  Sections: <ordered list — e.g., "title -> agenda -> content slides ->
    summary -> CTA">
  Recurring elements: <assets that appear on multiple pages, by ID>

Quality markers:
  - <what makes this pattern work well>
  - <consistency element>

Constraints:
  - PREFER: <e.g., "use coral accent sparingly — max 2 elements per page">
  - PREFER: <e.g., "keep body text left-aligned, headings centered">
  - NEVER: <e.g., "never use more than 3 colors on a single slide">

Applies to: design-type:<type>
Trigger hints:
  - task-class:create-design
  - design-type:<type>
Confidence: <high|medium|low>
```

### Asset catalog entry (semantic)

One entry per explore session to catalog all discovered reusable assets:

```
entries_create({
  diary_id: "<DIARY_ID>",
  title: "Asset catalog — <date>",
  content: "<see below>",
  tags: ["source:canva-explore", "asset-catalog",
         "explore-session:<timestamp>"],
  importance: 6,
  entry_type: "semantic"
})
```

Content template:

```
Asset catalog from Canva explore session <date>

Logos:
  - <asset_id>: <name> — <dimensions>, used in <design IDs>
Icons:
  - <asset_id>: <name> — <smart_tags summary>, used in <design IDs>
Photos:
  - <asset_id>: <name> — <dimensions>, <smart_tags summary>
Other:
  - <asset_id>: <name> — <type/purpose>

Usage for new designs:
  Pass asset_ids to generate-design or use update_fill/insert_fill
  in editing transactions to place these assets in new designs.
```

### Design inventory entry (episodic)

One entry per explored design (or batch of similar designs):

```
entries_create({
  diary_id: "<DIARY_ID>",
  title: "Canva design: <design-title>",
  content: "<see below>",
  tags: ["source:canva-explore", "design-type:<type>",
         "explore-session:<timestamp>", "canva-id:<id>"],
  importance: 3,
  entry_type: "episodic"
})
```

Content template:

```
Design: <title>
Type: <presentation|course|book|social|...>
Pages: <count>
Created: <date if known>
Canva ID: <id>

Summary: <1-2 sentence description of the design's purpose and audience>
Notable features: <what stands out about this specific design>
Patterns used: <references to pattern entries — "see Design pattern: X">
Key assets: <asset IDs used in this design, from fills>
```

## Workflow

### Step 1: Discover designs and brand resources

```
# Discover all designs
search-designs({ sort_by: "modified_descending", ownership: "owned" })

# Check for brand templates
search-brand-templates({ query: "<relevant keywords>" })

# Check for brand kits
list-brand-kits()
```

Record brand kit IDs and template IDs — these are the most direct path
to faithful design reproduction.

### Step 2: Group by type

Cluster designs by type (presentations, courses, books, social posts, etc.)
Process each type as a batch.

### Step 3: Deep inspect representative designs

For each design type, pick 2-3 representative designs:

```
# Open editing transaction (read-only inspection)
start-editing-transaction({ design_id: "<id>" })
# Returns: richtexts (text + positions), fills (images + asset IDs),
#          page thumbnails (visual rendering), page structure

# Catalog discovered assets
get-assets({ asset_ids: [<unique asset IDs from fills>] })
# Returns: asset names, tags, thumbnails, dimensions

# ALWAYS cancel after inspection
cancel-editing-transaction({ transaction_id: "<tx_id>" })
```

From the editing transaction, extract:

- **Fills**: list all `asset_id` values, note which `page_index` they
  appear on, whether they're `editable`, and their element type/position
- **Recurring assets**: assets that appear on multiple pages are brand
  elements (logos, watermarks, decorative backgrounds)
- **Text layout**: element positions reveal the grid system and hierarchy
- **Thumbnail**: actual visual rendering for color/style analysis

### Step 4: Extract patterns per type

For each design type:

1. Cross-reference fills across inspected designs — shared assets are
   brand elements
2. Analyze thumbnail vision for colors, background style, overall mood
3. Map text element positions to understand layout grid
4. Identify recurring structural sections from richtext content
5. Create one `semantic` pattern entry per distinct pattern (include
   asset IDs)
6. Create one `episodic` inventory entry per design
7. Create one `asset-catalog` entry for the session

### Step 5: Cross-type patterns

After all types are processed:

1. Identify assets that span design types (brand-level assets)
2. Create brand-level pattern entries with broader `Applies to`
3. Tag with `pattern:brand`
4. Record brand kit ID if available

### Step 6: Summary

Create a summary entry:

```
entries_create({
  diary_id: "<DIARY_ID>",
  title: "Canva explore summary — <date>",
  content: "Explored <N> designs across <M> types.
    Created <X> pattern entries, <Y> inventory entries, 1 asset catalog.
    Key patterns: <list>.
    Design types covered: <list>.
    Brand kit: <id or none>.
    Brand templates found: <count>.
    Reusable assets cataloged: <count>.
    Suggested next: use patterns + asset_ids to generate new designs.",
  tags: ["source:canva-explore", "explore-session:<timestamp>",
         "scan-category:summary"],
  importance: 5,
  entry_type: "reflection"
})
```

## Using patterns to create new designs

When creating a new design based on extracted patterns:

### Option A: Clone and edit (most faithful)

Best when a matching design exists. Preserves all visual identity.

```
start-editing-transaction({ design_id: "<source_design_id>" })
# Use find_and_replace_text to update content
# Use update_fill to swap speaker photos
commit-editing-transaction({ transaction_id: "<tx_id>" })
```

### Option B: Generate with brand kit + assets

Best when brand kit exists. Canva applies brand colors/fonts.

```
generate-design({
  brand_kit_id: "<from brand kit discovery>",
  asset_ids: ["<logo_id>", "<icon_id>", ...],
  ...
})
```

### Option C: Generate then refine

Generate from scratch, then edit to inject brand assets.

```
# 1. Generate
generate-design-structured({ ... })
# 2. Create from candidate
create-design-from-candidate({ job_id, candidate_id })
# 3. Open for editing
start-editing-transaction({ design_id: "<new_id>" })
# 4. Insert brand assets
perform-editing-operations({
  operations: [
    { type: "insert_fill", asset_id: "<logo>", ... },
    { type: "update_fill", element_id: "<placeholder>", asset_id: "<photo>" }
  ]
})
commit-editing-transaction({ transaction_id: "<tx_id>" })
```

## Tag conventions

| Tag                           | Purpose                                                                |
| ----------------------------- | ---------------------------------------------------------------------- |
| `source:canva-explore`        | All entries from this skill                                            |
| `design-type:<type>`          | The Canva design type                                                  |
| `pattern:<category>`          | Pattern category (color, typography, layout, structure, brand, assets) |
| `explore-session:<timestamp>` | Groups entries from one explore run                                    |
| `canva-id:<id>`               | Links back to Canva design ID                                          |
| `asset-catalog`               | Session asset catalog entry                                            |
| `brand-kit:<id>`              | Links to Canva brand kit                                               |

## Recovery after context compression

1. Read this skill file
2. Check `entries_search({ tags: ["source:canva-explore"] })` to see what
   exists
3. Check `entries_search({ tags: ["asset-catalog"] })` for reusable assets
4. Resume from last completed step
