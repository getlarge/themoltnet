---
name: canva-explore
description: 'Explore Canva designs via MCP and extract visual/structural patterns into MoltNet diary entries. Requires Canva MCP (search-designs, get-design, get-design-pages). Patterns are stored for later compilation into design context packs.'
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
  `get-design-pages` tools)

## When to trigger

- User says "explore my Canva designs", "scan my designs", "find design
  patterns"
- User wants to prepare context before creating a new design
- First time setting up design memory for a Canva account

## Workflow overview

1. **Discover**: `search-designs` with keywords or list all
2. **Inspect**: `get-design` + `get-design-pages` for each design
3. **Analyze thumbnails**: Use vision on page thumbnails to extract visual
   patterns
4. **Create entries**: Write structured diary entries per pattern

## Extraction targets

For each design (or group of similar designs), extract:

### Visual patterns
- **Color palette**: dominant colors, background/foreground contrast
- **Typography**: heading/body font styles, sizes, hierarchy
- **Layout**: grid structure, whitespace usage, alignment patterns
- **Imagery**: photo style, illustration style, icon usage

### Structural patterns
- **Page count**: typical length for this design type
- **Section structure**: how content is organized (intro → body → CTA)
- **Recurring elements**: headers, footers, slide numbers, brand marks
- **Transitions**: visual flow between pages

### Brand patterns
- **Consistency signals**: what stays the same across designs
- **Variation signals**: what changes per design type
- **Quality markers**: what makes the best designs stand out

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
  Colors: <palette description — e.g., "dark navy #1B2838 bg, white text,
    coral #FF6B6B accents">
  Typography: <font styles — e.g., "bold sans-serif headings 48pt,
    light body 18pt with 1.6 line height">
  Layout: <structure — e.g., "centered single-column, 60% content width,
    generous top margin">
  Imagery: <style — e.g., "minimal line icons, no photos, abstract
    geometric shapes as dividers">

Structure:
  Pages: <typical count or range>
  Sections: <ordered list — e.g., "title → agenda → content slides →
    summary → CTA">
  Recurring elements: <e.g., "page numbers bottom-right, logo top-left,
    section divider slides with gradient bg">

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
```

## Workflow

### Step 1: Discover designs

```
search-designs({ query: "<keyword or empty for all>" })
```

### Step 2: Group by type

Cluster designs by type (presentations, courses, books, social posts, etc.)
Process each type as a batch.

### Step 3: Extract patterns per type

For each design type:
1. Pick 2-3 representative designs
2. Analyze thumbnails via vision
3. Identify recurring visual/structural patterns
4. Create one `semantic` pattern entry per distinct pattern
5. Create one `episodic` inventory entry per design

### Step 4: Cross-type patterns

After all types are processed:
1. Identify patterns that span design types (brand-level patterns)
2. Create brand-level pattern entries with broader `Applies to`
3. Tag with `pattern:brand`

### Step 5: Summary

Create a summary entry:

```
entries_create({
  diary_id: "<DIARY_ID>",
  title: "Canva explore summary — <date>",
  content: "Explored <N> designs across <M> types.
    Created <X> pattern entries and <Y> inventory entries.
    Key patterns: <list>.
    Design types covered: <list>.
    Suggested next: consolidate entries, then test with canva-suggest.",
  tags: ["source:canva-explore", "explore-session:<timestamp>",
         "scan-category:summary"],
  importance: 5,
  entry_type: "reflection"
})
```

## Tag conventions

| Tag | Purpose |
|---|---|
| `source:canva-explore` | All entries from this skill |
| `design-type:<type>` | The Canva design type |
| `pattern:<category>` | Pattern category (color, typography, layout, structure, brand) |
| `explore-session:<timestamp>` | Groups entries from one explore run |
| `canva-id:<id>` | Links back to Canva design ID |

## Recovery after context compression

1. Read this skill file
2. Check `entries_search({ tags: ["source:canva-explore"] })` to see what
   exists
3. Resume from last completed step
