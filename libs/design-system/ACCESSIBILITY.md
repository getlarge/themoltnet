# Design System Accessibility Inventory

This inventory tracks the current accessibility posture of the exported React
components in `@themoltnet/design-system`. Levels are intentionally practical:

- **Baseline**: native semantics are mostly correct; only small guardrails or
  documentation are missing.
- **Partial**: usable in common cases, but missing ARIA relationships,
  keyboard behavior, motion handling, or state announcements.
- **Needs work**: current API or implementation can produce inaccessible UI
  without obvious consumer mistakes.
- **Structural**: layout/theming component; accessibility depends mainly on
  consumer-provided semantics.

## Component Inventory

| Component           | Level      | Current state                                                                                                                        | Required follow-up                                                                                                                                                                                                                     |
| ------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Button`            | Baseline   | Uses native `<button>`, forwards button attributes, supports `disabled`, and renders visible focus styling through `useInteractive`. | Default `type="button"` to prevent accidental form submits. Document icon-only buttons must provide an accessible name.                                                                                                                |
| `Input`             | Partial    | Uses native `<input>` and renders a `<label>` when `label` is provided.                                                              | Generate stable IDs with `useId`, link hint/error with `aria-describedby`, expose `aria-invalid` for errors, and avoid deriving IDs from label text.                                                                                   |
| `Dialog`            | Partial    | Uses native `<dialog>` and `showModal()`, includes a close button when a title is present.                                           | Add an accessible name via `aria-labelledby` or `aria-label`, support description text, preserve/restore focus, ensure Esc/backdrop close paths call `onClose`, and always expose a close control or require consumers to provide one. |
| `ConfirmDialog`     | Partial    | Builds on `Dialog` with clear cancel/confirm buttons.                                                                                | Mark destructive confirmations in copy/API docs, wire message text as dialog description, and prefer initial focus on the least destructive action.                                                                                    |
| `Tooltip`           | Partial    | Opens on hover and focus, uses `role="tooltip"`, and attaches `aria-describedby` while open.                                         | Attach `aria-describedby` to the trigger element rather than the wrapper when possible, support Escape dismissal, and document that tooltips are supplemental only.                                                                    |
| `CopyButton`        | Partial    | Uses native `<button>` and visible status text changes.                                                                              | Add an accessible name when the visible value is long/cryptic, announce copied/failed state with `aria-live`, and expose a disabled/loading-safe state if needed.                                                                      |
| `KeyFingerprint`    | Needs work | Static fingerprint display is fine, but `copyable` turns a `<span>` into `role="button"` with `tabIndex=0`.                          | Replace the interactive span with a native `<button>` or implement Space/Enter key handling and state announcement. Prefer native button.                                                                                              |
| `Text`              | Baseline   | Maps heading/body variants to semantic elements and supports `as` override.                                                          | Document that consumers own heading order when using `as`.                                                                                                                                                                             |
| `CodeBlock`         | Baseline   | Uses `<pre><code>` for blocks and `<code>` for inline content.                                                                       | Hide the decorative language label from assistive tech if it repeats nearby text, or expose it deliberately when useful.                                                                                                               |
| `Badge`             | Structural | Renders a neutral `<span>` and forwards attributes.                                                                                  | Document that status-only badges need text, not color alone. Consumers can add `aria-label` when the visible label is abbreviated.                                                                                                     |
| `Card`              | Structural | Layout wrapper with a neutral `<div>`.                                                                                               | Document when consumers should provide `as`, `role`, labelled regions, or native sectioning around cards.                                                                                                                              |
| `Container`         | Structural | Layout wrapper with a neutral `<div>`.                                                                                               | No component-level requirement.                                                                                                                                                                                                        |
| `Stack`             | Structural | Layout wrapper with a neutral `<div>`.                                                                                               | No component-level requirement.                                                                                                                                                                                                        |
| `Divider`           | Baseline   | Uses `<hr>`, which has separator semantics.                                                                                          | For purely decorative dividers, allow or document `aria-hidden="true"`.                                                                                                                                                                |
| `Logo`              | Baseline   | SVG uses `role="img"` and `aria-label="MoltNet"`.                                                                                    | Add an `aria-label` prop and decorative mode for repeated logos.                                                                                                                                                                       |
| `LogoAnimated`      | Partial    | SVG has image semantics and label.                                                                                                   | Respect reduced motion or expose an `animated`/decorative mode. Add configurable label.                                                                                                                                                |
| `AgentIdentityMark` | Partial    | SVG has image semantics and label.                                                                                                   | Add a label prop, decorative mode, and reduced-motion handling for breathing animation.                                                                                                                                                |
| `AgentIdentityFull` | Partial    | SVG has image semantics and label, with optional entrance animation.                                                                 | Add a label prop, decorative mode, and reduced-motion handling for continuous animation.                                                                                                                                               |

## Cross-Cutting Gaps

1. **Accessible names and descriptions**: interactive and image components need
   explicit naming APIs instead of fixed labels or inferred IDs.
2. **Native controls first**: avoid `role="button"` on non-button elements
   unless the component fully implements keyboard activation and disabled
   semantics.
3. **State announcements**: transient UI state such as copy success/failure
   should use `aria-live`.
4. **Reduced motion**: animated SVG components should honor
   `prefers-reduced-motion` or expose an opt-out.
5. **Tests**: existing tests cover some roles but do not assert ARIA
   relationships, accessible names, keyboard activation, or reduced-motion
   behavior.

## ESLint Recommendation

Yes, add accessibility linting. The repo currently has React hooks linting but
no JSX accessibility plugin. The best fit is `eslint-plugin-jsx-a11y` scoped to
browser React TSX files:

- Add `eslint-plugin-jsx-a11y` to the pnpm catalog and root dev dependencies.
- Register the plugin in `eslint.config.mjs`.
- Enable its recommended flat config for `apps/*/src/**/*.tsx` and
  `libs/*/src/**/*.tsx`.
- Exclude or separately scope Ink CLI components under
  `libs/design-system/src/cli/**/*.tsx`, because DOM accessibility rules do not
  map cleanly to terminal UI.

Start strict on rules that catch real bugs with low false-positive rates:

- `jsx-a11y/alt-text`
- `jsx-a11y/aria-props`
- `jsx-a11y/aria-proptypes`
- `jsx-a11y/aria-unsupported-elements`
- `jsx-a11y/role-has-required-aria-props`
- `jsx-a11y/role-supports-aria-props`
- `jsx-a11y/no-autofocus`
- `jsx-a11y/no-noninteractive-tabindex`
- `jsx-a11y/click-events-have-key-events`
- `jsx-a11y/no-static-element-interactions`

Defer or tune noisier rules after the first pass, especially rules around
labels and media if they produce app-level churn outside the design-system
scope.
