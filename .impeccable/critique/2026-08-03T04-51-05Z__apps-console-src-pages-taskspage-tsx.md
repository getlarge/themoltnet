---
target: task board
total_score: 26
max_score: 40
na_heuristics:
p0_count: 0
p1_count: 2
timestamp: 2026-08-03T04-51-05Z
slug: apps-console-src-pages-taskspage-tsx
---

## Design Health Score

| #         | Heuristic                        |     Score | Key issue                                                                                                                        |
| --------- | -------------------------------- | --------: | -------------------------------------------------------------------------------------------------------------------------------- |
| 1         | Visibility of system status      |         3 | Lifecycle and loading states are explicit, but refresh has no in-progress or last-updated feedback.                              |
| 2         | Match with operator mental model |         3 | The lifecycle order is natural; “funnel” suggests conversion analytics rather than task-state population.                        |
| 3         | User control and freedom         |         2 | Filters have no single clear/reset action, and mobile task selection can place the resulting pane far below the tapped card.     |
| 4         | Consistency and standards        |         3 | Design-system primitives are used consistently, though board/table behaves like tabs without tab or segmented-control semantics. |
| 5         | Error prevention                 |         3 | Destructive actions are guarded and task state is not inferred when evidence is missing.                                         |
| 6         | Recognition rather than recall   |         2 | Correlation ID is placeholder-only implementation language and active filters are not summarized as removable values.            |
| 7         | Flexibility and efficiency       |         3 | Board/table views and per-lane pagination serve different workflows, but keyboard and bulk board workflows are limited.          |
| 8         | Aesthetic and minimalist design  |         2 | Status repeats across filters, summary, lane headers, and cards; wrapped lanes destroy the intended control-plane rhythm.        |
| 9         | Error recovery                   |         3 | Error states name the missing evidence and expose retry actions.                                                                 |
| 10        | Help and documentation           |         2 | Contextual runtime help exists in the live pane, but filters and board navigation lack inline guidance.                          |
| **Total** |                                  | **26/40** | **Acceptable — solid evidence model, significant responsive/layout work needed.**                                                |

## Design Specificity Verdict

The content is MoltNet-specific, but the shell is a generic Kanban board. Task type, short ID, status, age, tags, and PR/issue references create useful operational evidence. The equal cards and five wrapping columns do not yet express the calm, inspectable “agent operations control plane” promised by the product direction.

The deterministic detector returned zero findings for `apps/console/src/pages/TasksPage.tsx`. That is consistent with the source using native controls and design-system tokens, but the scan does not detect the responsive geometry and nested-scroll problems found by the design review. Browser inspection and overlays were unavailable because this session had no in-app browser backend.

## Overall Impression

The state model and failure copy are unusually precise. The single biggest opportunity is to make the five lifecycle states behave as one stable horizontal instrument instead of a responsive card grid.

## What’s Working

- Cards expose real operational identifiers and metadata without forcing immediate drill-down.
- Loading and error states carefully distinguish known evidence from inferred state.
- Per-lane queries, totals, and pagination already provide the right data architecture for bounded lane viewports.

## Priority Issues

### [P1] Board geometry breaks cross-state scanning

`auto-fit, minmax(200px, 1fr)` wraps lifecycle lanes into multiple rows as the viewport or selected-task pane narrows. Replace it with a single horizontal track, stable minimum lane widths, and horizontal overflow. Give every lane the same viewport-derived height and independently scroll its task list beneath a persistent header.

Suggested command: `$impeccable adapt`.

### [P1] Mobile selection feedback is displaced

The current mobile layout stacks all five lanes and then renders the selected task pane after the board. A card tapped near the top can appear to do nothing. Preserve horizontal lanes on mobile with snap points, and present the selected task as an immediately visible mobile surface rather than after the full board.

Suggested command: `$impeccable adapt`.

### [P2] Summary and filters compete with the board

Status appears in the filter set, lifecycle summary, lane header, card badge, and active dot. Keep the lifecycle summary on one non-wrapping rail, clarify active filters, and give users a single clear/reset path.

Suggested command: `$impeccable distill`.

### [P2] Board semantics and focus behavior are incomplete

Lanes are visual containers without named region/heading relationships, selected cards communicate selection primarily through border color, and scroll areas have no keyboard entry point. Add region names, semantic lane headings, focusable overflow areas, and programmatic selected state.

Suggested command: `$impeccable audit`.

## Persona Red Flags

- **Alex (power operator):** Reflowing lanes change scan position when the detail pane opens; there is no clear-filter shortcut or board keyboard accelerator.
- **Sam (keyboard/screen-reader operator):** Lane structure is not announced as named regions, selected state is not programmatic, and the horizontal/vertical scroll surfaces are not keyboard-addressable.
- **Casey (mobile operator):** A vertical five-lane board becomes extremely long, and the selected task pane can render far below the action that opened it.

## Minor Observations

- Board/table should read as one labeled segmented view control.
- “Refresh” should expose refreshing or last-updated feedback.
- Empty lanes could acknowledge active filters instead of saying only “No tasks.”
- Long titles and tags need explicit overflow treatment.
- “Lifecycle summary” is clearer than “funnel” unless conversion semantics are intended.

## Questions to Consider

- Should mobile optimize for comparing adjacent lifecycle states, or for diving into one state at a time?
- When a task opens, should the board remain visible or should evidence take over the narrow viewport?
- Which single piece of state-specific evidence would make these cards unmistakably MoltNet rather than generic Kanban items?
