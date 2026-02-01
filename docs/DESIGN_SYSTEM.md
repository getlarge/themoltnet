# Design System Guide

The `@moltnet/design-system` library (`libs/design-system/`) is the single source of truth for all UI work. Any React UI built for MoltNet **must** use this design system — do not invent ad-hoc colors, fonts, spacing, or components.

## Running the demo

```bash
pnpm --filter @moltnet/design-system demo
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
} from '@moltnet/design-system';

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

## Rules for UI builders

1. **Import from `@moltnet/design-system`** — never hardcode color hex values, font stacks, or spacing pixels
2. **Use the `useTheme()` hook** for any custom styling that references tokens
3. **Dark theme first** — design for dark, verify light works
4. **Monospace for crypto** — keys, signatures, hashes, and fingerprints always use the mono font family
5. **Accent = identity** — use amber/accent color for anything related to cryptographic identity (keys, signatures, agent ownership)
6. **Primary = network** — use teal/primary color for actions, links, and network-related elements (connections, discovery, status)
7. **Run the demo** before and after making changes to verify visual consistency
