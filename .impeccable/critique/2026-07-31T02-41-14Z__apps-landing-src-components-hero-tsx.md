---
target: authority-led landing campaign
total_score: 15
max_score: 20
na_heuristics: 1,5,7,9,10
p0_count: 0
p1_count: 4
timestamp: 2026-07-31T02-41-14Z
slug: apps-landing-src-components-hero-tsx
---

Method: dual-agent review of the authority-led landing hero and problem section.

## Design Health Score

| #         | Heuristic                           |     Score | Key issue                                                                                               |
| --------- | ----------------------------------- | --------: | ------------------------------------------------------------------------------------------------------- |
| 1         | Visibility of system status         |       n/a | Persuasion surface; no changing task state.                                                             |
| 2         | Match between system and real world |       3/4 | Borrowed authority and the commit comparison make the model concrete; runtime policy remains technical. |
| 3         | User control and freedom            |       3/4 | Three exits exist, but their equal weight weakens the primary decision.                                 |
| 4         | Consistency and standards           |       4/4 | Semantic amber/teal token use and card grammar are coherent.                                            |
| 5         | Error prevention                    |       n/a | No irreversible form or data action.                                                                    |
| 6         | Recognition rather than recall      |       3/4 | The authority chain and before/after comparisons are memorable, though later vocabulary compounds.      |
| 7         | Flexibility and efficiency          |       n/a | Not meaningful for this landing-page surface.                                                           |
| 8         | Aesthetic and minimalist design     |       2/4 | The hero is disciplined; the problem section becomes a dense multi-narrative explainer.                 |
| 9         | Error recovery                      |       n/a | No recovery flow on this surface.                                                                       |
| 10        | Help and documentation              |       n/a | Documentation is an intended downstream destination.                                                    |
| **Total** |                                     | **15/20** | **Strong visual system; narrative and responsive focus need work.**                                     |

## Design Specificity Verdict

The campaign feels authored for MoltNet, not category-interchangeable. The authority chain and evidence-oriented commit comparison translate a specific product thesis into a memorable visual story. The specificity drops when the authority story, living memory, and evaluation performance appear as equal narratives in one section.

The deterministic scan reported no violations in `apps/landing/src/components/Hero.tsx` or `apps/landing/src/components/Problem.tsx`. Manual technical review found implementation and responsive risks that the scan does not cover.

## Overall Impression

The new promise is materially stronger than a generic agent-infrastructure pitch. It establishes tension, offers a bounded-authority model, and gives visitors real evidence. The next pass should remove competing claims and ensure the credible story survives narrow screens and assistive technology.

## What's Working

- The hero thesis, “Agents should not inherit your authority,” is precise and distinct.
- The key → credential → policy → evidence chain converts a technical system into a retainable causal model.
- The before/after commit comparison lets visitors inspect accountability instead of taking a claim on faith.

## Priority Issues

### [P1] Nested CTA controls and non-wrapping CTA row

**Location:** `apps/landing/src/components/Hero.tsx`

Anchors wrap design-system `Button` controls, creating invalid interactive nesting and potentially conflicting keyboard and assistive-technology semantics. The same three large controls do not wrap, so they may overflow on narrow screens. Use one interactive element per CTA and make the row wrap or stack at small widths. Demote Console and GitHub relative to the team-pilot decision.

**Suggested command:** `$impeccable adapt`

### [P1] Narrow-screen grid overflow

**Location:** `apps/landing/src/components/Problem.tsx`

Four grids use 300px or 340px minimum tracks while the container leaves roughly 272px at a 320px viewport. This can force horizontal overflow and split paired evidence into an awkward sequence. Use responsive minimums or a narrow-screen single-column layout that preserves each without/with comparison.

**Suggested command:** `$impeccable adapt`

### [P1] Three competing product narratives

**Location:** `apps/landing/src/components/Problem.tsx`

Authority, living memory, and evaluation outcomes each ask a cold visitor to reframe the product. Keep the authority failures and one strongest proof artifact in this campaign arc; move or clearly subordinate the memory and evaluation material.

**Suggested command:** `$impeccable distill`

### [P1] Evidence metrics lack an audit path

**Location:** `apps/landing/src/components/Problem.tsx`

Exact result percentages are persuasive but have no adjacent definition, methodology, sample, or provenance link. Security-minded visitors can read this as marketing rather than evidence. Add a concise factual qualifier and an inspectable source, or remove the percentages from the campaign surface.

**Suggested command:** `$impeccable clarify`

### [P2] First viewport overload

**Location:** `apps/landing/src/components/Hero.tsx`

The badge, thesis, 49-word explanation, chain, animation, three CTAs, and capability inventory compete before a visitor has chosen a reading path. Keep the thesis, short chain, and one primary action above the fold; move the origin animation and inventory lower.

**Suggested command:** `$impeccable distill`

### [P2] Runtime policy is not explained at first use

**Location:** `apps/landing/src/components/Hero.tsx`, `apps/landing/src/components/Problem.tsx`

The concept is central but does not tell a first-timer whether it means task permissions, command allowlists, or sandboxing. Add a short modifier at first mention, such as “the tools and commands a task may run.”

**Suggested command:** `$impeccable clarify`

## Persona Red Flags

- **First-timer:** Encounters accountable authority, task credential, runtime policy, attributable evidence, LeGreffier, and evals before seeing a plain-language team-task example.
- **Technical evaluator:** Sees the chain but not the enforcement point, revocation model, or verification route early enough to connect the authorization claim to implementation.
- **Security-minded platform owner:** Sees exact percentages without methodology, then a Console link that leaves the campaign context before a direct threat-model or policy-boundary route.

## Minor Observations

- The whole hero uses amber ambience even though amber carries identity/cryptographic meaning; reserve it for key and evidence moments.
- Repeated red titles, error badges, and struck-through text risk making the authority cards look like a generic pain-point grid.
- `LogoAnimated` honors reduced motion, but its always-running SVG effects should be profiled on representative mobile hardware.
- The authority chain is readable but should be semantic ordered content rather than a generic labelled `div`.

## Questions to Consider

- What is the one proof a platform owner must believe before starting a pilot: bounded authority or auditable outcomes?
- If the first screen had room for only one noun besides “agent,” should it be credential, policy, or evidence?
- Could one inspectable task record show actor, scope, executed policy, and signed result better than multiple explanatory comparisons?
