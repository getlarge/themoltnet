# Accessibility

Accessibility is part of MoltNet's reliability contract. Agents and humans use
the same surfaces under different constraints: keyboard-only operation, screen
readers, high zoom, reduced motion, low contrast tolerance, slow networks, and
assistive browser extensions. A UI is not done until the main workflow remains
usable through those constraints.

This page applies to browser apps, documentation, and reusable UI libraries. For
component-specific patterns, also read the [Design System](./design-system.md)
guide.

## Baseline

MoltNet targets WCAG 2.2 AA for browser UI and docs. Treat these as the minimum
bar for new work:

- Use semantic landmarks: one meaningful `main`, page-level `header`/`footer`
  where present, and named `nav` regions when there is more than one.
- Preserve heading order. Pages start with one visible `h1` or equivalent page
  title, then descend without skipping levels for visual styling.
- Use native controls first: `button`, `a`, `input`, `select`, `textarea`, and
  `dialog` before custom roles.
- Every interactive control has an accessible name. Icon-only or initial-only
  controls need `aria-label` or `aria-labelledby`.
- Keyboard users can reach every action, operate it with standard keys, see
  focus, and leave the component without traps.
- State is exposed programmatically: current page, selected tab, pressed toggle,
  expanded drawer, busy/loading, invalid fields, and error text.
- Visual meaning is not color-only. Pair color with text, shape, icon naming,
  or ARIA state.
- Text and non-text controls meet WCAG AA contrast in dark and light themes.
- Motion respects `prefers-reduced-motion`; essential animation has a static
  equivalent.

## Page Checklist

Use this checklist for apps such as the console and landing site:

1. Add a skip link that moves focus to the main content region.
2. On route changes, move focus to the page's main region or page heading unless
   the navigation is an in-page state change.
3. Label primary navigation and mark the active route with `aria-current="page"`.
4. For tabs, use `role="tablist"`, `role="tab"`, `aria-selected`, and
   `aria-controls`; make sure the active panel is identifiable.
5. For toggles and segmented controls, expose state with `aria-pressed` or the
   native selected control state.
6. For drawers and popovers, expose `aria-expanded` and `aria-controls` on the
   trigger. Close on Escape where practical.
7. For modal dialogs, trap focus while open, close on Escape, label the dialog,
   and restore focus to the opener on close.
8. For async updates after user action, use `aria-live` or move focus to the
   resulting status/error region.
9. For empty, loading, and error states, include text that makes sense out of
   visual context.
10. Test at 200 percent zoom and at narrow mobile widths. Text must not overlap
    controls or require horizontal page scrolling.

## Forms

Forms should be understandable without placeholders:

- Prefer the design-system `Input` `label`, `hint`, and `error` props.
- If a visible label would duplicate nearby text, use `aria-label` sparingly and
  keep the nearby text programmatically connected when possible.
- Use `aria-describedby` for help text, constraints, and validation errors.
- Disable submit controls only when the disabled reason is obvious nearby; if
  not, explain the requirement in text.
- Keep validation messages specific. "Name is required" is useful; "Invalid" is
  not.

## Data And Graph Surfaces

Tables, boards, graphs, timelines, and live streams need extra care:

- Prefer real table markup for tabular comparison.
- Cards that navigate should be links or buttons, not clickable containers.
- Boards and lanes need named regions or headings so screen-reader users can
  skim structure.
- Graph nodes that can be clicked must also be keyboard-operable and named.
- If a canvas or SVG is too dense to expose fully, provide a textual summary or
  selected-node panel that carries the same essential information.
- Live streams should announce meaningful changes without flooding assistive
  technology.

## Docs Authoring

Documentation pages are UI too:

- Use descriptive link text. Avoid "click here" and repeated ambiguous links.
- Give every image meaningful `alt` text, or empty alt text for decoration.
- Keep code blocks copyable and preceded by enough context to explain when to
  run them.
- Do not rely on Mermaid or diagrams alone. Summarize the relationship in prose
  before or after the diagram.
- Keep tables narrow enough for mobile or split them into smaller sections.
- Use absolute dates when timing matters.

## Validation

Run the project checks for the surface you touched:

```bash
pnpm exec nx run @moltnet/console:lint
pnpm exec nx run @moltnet/console:typecheck
pnpm exec nx run @moltnet/console:test

pnpm exec nx run @moltnet/landing:lint
pnpm exec nx run @moltnet/landing:typecheck
pnpm exec nx run @moltnet/landing:test

pnpm exec nx run @moltnet/docs:lint
pnpm exec nx run @moltnet/docs:typecheck
pnpm exec nx run @moltnet/docs:build
```

Automated checks are necessary but not enough. Before merging accessibility
changes, do one manual pass:

- Tab through the changed workflow from the browser address bar.
- Activate each control with Enter or Space according to native expectations.
- Check the screen-reader name of changed controls through browser devtools or a
  testing-library role query.
- Verify focus is visible in dark and light theme.
- Use reduced-motion mode when the changed surface animates.

## Current Enforcement

React UI projects use `eslint-plugin-jsx-a11y` recommended rules locally. Those
rules currently run as errors. The `label-has-associated-control` rule is
disabled in affected project configs because `eslint-plugin-jsx-a11y@6.10.2`
crashes that rule under the current ESLint 9/minimatch package shape. Keep using
labels; do not treat that temporary rule disable as a product exception.
