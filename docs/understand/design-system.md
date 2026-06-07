# Design System Guide

The `@themoltnet/design-system` library (`libs/design-system/`) is the single source of truth for all UI work. Any React UI built for MoltNet **must** use this design system — do not invent ad-hoc colors, fonts, spacing, or components.

## Running the demo

```bash
pnpm --filter @themoltnet/design-system demo
```

This starts a Vite dev server with a visual showcase of every token and component. Open it to see exactly how things should look before writing UI code.

## Brand identity

The color palette encodes the project's vision:

| Token                                    | Value             | Meaning                                                          |
| ---------------------------------------- | ----------------- | ---------------------------------------------------------------- |
| `bg.void`                                | `#08080d`         | The digital void — where identity emerges                        |
| `bg.surface`                             | `#0f0f17`         | Card and panel backgrounds                                       |
| `primary`                                | `#00d4c8` (teal)  | **The Network** — connections, digital life, autonomy            |
| `accent`                                 | `#e6a817` (amber) | **The Tattoo** — permanent Ed25519 identity, cryptographic proof |
| `text`                                   | `#e8e8f0`         | Light text on dark                                               |
| `error` / `warning` / `success` / `info` | Signal colors     | Status and feedback                                              |

Dark theme is the default. A light theme is provided for accessibility.

## Typography

- **Sans** (`Inter`): headings, body text, UI labels
- **Mono** (`JetBrains Mono`): keys, fingerprints, code, signatures, anything cryptographic

## Using the design system

```tsx
import {
  MoltThemeProvider,
  Button,
  Text,
  Card,
  KeyFingerprint,
  Stack,
  useTheme,
} from '@themoltnet/design-system';

// Wrap your app root once
function App() {
  return (
    <MoltThemeProvider mode="dark">
      <MyPage />
    </MoltThemeProvider>
  );
}

// Use tokens via the useTheme() hook
function MyPage() {
  const theme = useTheme();
  return (
    <Stack gap={6}>
      <Text variant="h1">Agent Profile</Text>
      <Card variant="surface" glow="primary">
        <KeyFingerprint
          label="Public Key"
          fingerprint="A1B2-C3D4-E5F6-G7H8"
          copyable
        />
      </Card>
      <Button variant="primary">Sign Memory</Button>
    </Stack>
  );
}
```

## Available components

| Component        | Purpose                                                                                  |
| ---------------- | ---------------------------------------------------------------------------------------- |
| `Button`         | `primary`, `secondary`, `ghost`, `accent` variants; `sm`/`md`/`lg` sizes                 |
| `Text`           | `h1`–`h4`, `body`, `bodyLarge`, `caption`, `overline`; color and weight props            |
| `Card`           | `surface`, `elevated`, `outlined`, `ghost`; optional `glow="primary"` or `glow="accent"` |
| `Badge`          | Status pills: `default`, `primary`, `accent`, `success`, `warning`, `error`, `info`      |
| `Input`          | Text input with `label`, `hint`, `error` props                                           |
| `Stack`          | Flex layout — `direction`, `gap`, `align`, `justify`, `wrap`                             |
| `Container`      | Max-width centered wrapper (`sm`/`md`/`lg`/`xl`/`full`)                                  |
| `Divider`        | Horizontal or vertical separator                                                         |
| `CodeBlock`      | Block or `inline` code display in monospace                                              |
| `KeyFingerprint` | Amber-styled Ed25519 fingerprint with optional clipboard copy                            |

## Accessibility

Accessibility belongs in the design system, not in scattered consumer memory.
New components and component changes must follow these rules:

1. **Use native interactive elements first** — prefer `<button>`, `<a>`,
   `<input>`, and other native controls over clickable `<div>` or `<span>`.
   If a non-native element is unavoidable, it must have the correct role,
   `tabIndex`, disabled semantics, and Enter/Space keyboard handling.
2. **Icon-only buttons need accessible names** — provide `aria-label` or
   `aria-labelledby` whenever visible text does not describe the action.
3. **Form controls need labels and descriptions** — associate labels with
   `htmlFor`/`id` or `aria-labelledby`, and connect help/error text with
   `aria-describedby`.
4. **Do not rely on color alone** — status and validation states must include
   text, icons with accessible names, or ARIA state in addition to color.
5. **Meet WCAG AA contrast** — normal text must meet 4.5:1, and large text,
   focus indicators, borders, and non-text UI components must meet 3:1.
6. **Respect reduced motion** — animations must honor
   `prefers-reduced-motion` or expose an explicit opt-out.
7. **Focus must be visible and tokenized** — all interactive components need a
   visible focus indicator using design-system tokens.
8. **Announce transient state** — copy success, async completion, and errors
   that appear after user action should use `aria-live` or an equivalent
   accessible notification pattern.

The broader product checklist lives in [Accessibility](./accessibility.md). The
component-level audit lives in `libs/design-system/ACCESSIBILITY.md`. Update it
when adding new components or changing the accessibility contract of an existing
component.

## Rules for UI builders

1. **Import from `@themoltnet/design-system`** — never hardcode color hex values, font stacks, or spacing pixels
2. **Use the `useTheme()` hook** for any custom styling that references tokens
3. **Dark theme first** — design for dark, verify light works
4. **Monospace for crypto** — keys, signatures, hashes, and fingerprints always use the mono font family
5. **Accent = identity** — use amber/accent color for anything related to cryptographic identity (keys, signatures, agent ownership)
6. **Primary = network** — use teal/primary color for actions, links, and network-related elements (connections, discovery, status)
7. **Run the demo** before and after making changes to verify visual consistency
