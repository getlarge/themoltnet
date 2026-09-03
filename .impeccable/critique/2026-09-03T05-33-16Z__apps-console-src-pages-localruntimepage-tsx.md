---
target: Agent Server local runtime console
total_score: 21
max_score: 40
na_heuristics:
p0_count: 0
p1_count: 4
timestamp: 2026-09-03T05-33-16Z
slug: apps-console-src-pages-localruntimepage-tsx
---

Method: dual-agent (A: /root/impeccable_design_review · B: /root/impeccable_detector_review)

## Design Health Score

| #         | Heuristic                       |     Score | Key issue                                                                                                    |
| --------- | ------------------------------- | --------: | ------------------------------------------------------------------------------------------------------------ |
| 1         | Visibility of System Status     |         2 | Connection and run states are clear, but mutation feedback is detached and shared busy states are ambiguous. |
| 2         | Match System / Real World       |         3 | Product terminology is accurate, though daemon and authority concepts require operator translation.          |
| 3         | User Control and Freedom        |         2 | Subscription login can be cancelled, but pairing cannot and mutations lack per-action control.               |
| 4         | Consistency and Standards       |         2 | Most design-system primitives are used, but select and accent semantics drift.                               |
| 5         | Error Prevention                |         2 | Required inputs are guarded, but Fetch models persists configuration unexpectedly.                           |
| 6         | Recognition Rather Than Recall  |         2 | Attach existing depends on a name field visually owned by another workflow.                                  |
| 7         | Flexibility and Efficiency      |         2 | Presets and filtering help, but large model sets lack bulk controls and expert shortcuts.                    |
| 8         | Aesthetic and Minimalist Design |         2 | Calm typography and cards, but all setup surfaces remain expanded at equal weight.                           |
| 9         | Error Recovery                  |         2 | Reconnect and log retry are actionable; failed mutations and runs lack local recovery guidance.              |
| 10        | Help and Documentation          |         2 | Inline hints exist, but prerequisites are text rather than contextual navigation.                            |
| **Total** |                                 | **21/40** | **Acceptable, with significant workflow improvements needed**                                                |

## Design Specificity Verdict

The language is distinctly MoltNet—local key custody, team-bound enrollment, executor authority, runtime profiles, and inspectable runs. The composition is less specific: after connection it becomes three equally weighted administration cards, leaving the real authority chain implicit.

The deterministic detector scanned the three scoped TSX files and returned zero findings. It therefore found no mechanical accessibility or style-rule violations to add or reject. Browser visualization was attempted but unavailable because the installed browser-control runtime referenced a missing module, so no reliable overlay was produced.

## Overall Impression

The surface communicates security boundaries and live execution unusually well. Its largest opportunity is to turn a wall of agent, provider, profile, and run controls into an explicit commissioning flow without losing the dense operator view after setup.

## What's Working

1. Connection, unavailable, pairing, connected, and degraded states each provide concrete status and recovery.
2. Security reassurance names real boundaries: private keys stay local, invitations are team-bound, and credentials are write-only.
3. Run observability exposes status, timestamps, process data, bounded logs, reconnection, and retry instead of hiding the daemon behind generic progress.

## Priority Issues

### [P1] Existing-agent attachment is structurally misleading

**Why it matters:** The attach action requires the shared agent-name field above the divider, inside the create-new-identity section. Operators see a disabled action without a local explanation and can accidentally mutate another workflow's input.

**Fix:** Give create and attach separate semantic forms and independent name state, or derive the external name from the selected configuration and ask for confirmation.

**Suggested command:** `$impeccable clarify`

### [P1] Fetch models performs a hidden save

**Why it matters:** Discovery persists the endpoint and API key before fetching models, while the interface presents Fetch models and Save provider as distinct actions. That violates operator expectations around secrets.

**Fix:** Add a transient discovery endpoint. Until then, label the action Save connection and fetch models and disclose persistence next to it.

**Suggested command:** `$impeccable harden`

### [P1] Mutation feedback is detached and ambiguous

**Why it matters:** Errors appear at the page top, far from their trigger. Several actions share one busy flag, so unrelated buttons can display the wrong pending label.

**Fix:** Give each form/action independent pending, success, and error state beside the trigger with an aria-live announcement. Separate profile loading, empty, and error states.

**Suggested command:** `$impeccable harden`

### [P1] Commissioning dependencies are implicit

**Why it matters:** Operators must infer local connection → team authority → identity → provider → profile/policy → run across equally weighted cards. Large model sets compound the load.

**Fix:** Add a compact readiness trace, collapse completed steps to inspectable summaries, link directly to Teams and Profiles, and add search/bulk selection to model discovery.

**Suggested command:** `$impeccable onboard`

### [P2] Visual language flattens the authority model

**Why it matters:** Uniform cards make identity, credentials, configuration, and execution look interchangeable. Amber is used for identity and ordinary coordination actions despite the documented two-layer color semantics.

**Fix:** Express the authority/execution chain visually, reserve amber for identity and authorization, use teal for configuration/work movement, and use the design-system Select.

**Suggested command:** `$impeccable layout`

## Persona Red Flags

**Alex (power user):** No Enter-to-submit path, bulk model controls, multi-run start, or pause/follow control for logs. Repetitive actions remain click-heavy.

**Jordan (first-timer):** The first connected view does not identify the next action. Supervisor, managed/external, executor, profile, poll, and drain arrive before a mental model. Attach existing appears broken because its hidden dependency is elsewhere.

**Sam (accessibility-dependent operator):** Generated codes and role-assignment outcomes are not live announcements. The local select lacks the design-system focus/error affordances, and async profile loading can replace the focused control.

## Minor Observations

- Stop has no pending state, confirmation, or danger treatment.
- Truncated fingerprints and paths lack copy/reveal affordances.
- Device-flow codes need one-click copy.
- Empty provider/subscription lists do not distinguish unsupported, unconfigured, and failed states.
- Failed runs expose raw evidence but no direct recovery path to task, attempt, profile, or policy.

## Questions to Consider

- Is first-time use actually a commissioning workflow that should progressively become a dense operator surface?
- What if the primary visual were the real authority chain: team → grant → fingerprint → credential → profile/policy → running daemon?
- Why may model discovery mutate stored credentials?
- Should the end state of a failed run be a raw exit code or a precise recovery path?
