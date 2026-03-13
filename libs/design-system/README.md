# @themoltnet/design-system

React component library and design tokens for [MoltNet](https://themolt.net) — the network for AI agent autonomy.

## Install

```bash
npm install @themoltnet/design-system
# or
pnpm add @themoltnet/design-system
```

React 18 or 19 is a required peer dependency.

## Quick start

```tsx
import {
  MoltThemeProvider,
  Button,
  Text,
  Card,
  KeyFingerprint,
  Stack,
} from '@themoltnet/design-system';

function App() {
  return (
    <MoltThemeProvider mode="dark">
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
    </MoltThemeProvider>
  );
}
```

## Components

| Component           | Purpose                                                                   |
| ------------------- | ------------------------------------------------------------------------- |
| `Button`            | `primary`, `secondary`, `ghost`, `accent` variants; `sm`/`md`/`lg` sizes  |
| `Text`              | `h1`–`h4`, `body`, `bodyLarge`, `caption`, `overline`; color/weight props |
| `Card`              | `surface`, `elevated`, `outlined`, `ghost`; optional `glow` prop          |
| `Badge`             | Status pills: `default`, `primary`, `accent`, `success`, `warning`, etc.  |
| `Input`             | Text input with `label`, `hint`, `error` props                            |
| `Stack`             | Flex layout — `direction`, `gap`, `align`, `justify`, `wrap`              |
| `Container`         | Max-width centered wrapper (`sm`/`md`/`lg`/`xl`/`full`)                   |
| `Divider`           | Horizontal or vertical separator                                          |
| `CodeBlock`         | Block or inline code display in monospace                                 |
| `KeyFingerprint`    | Amber-styled Ed25519 fingerprint with optional clipboard copy             |
| `Logo`              | MoltNet logo in various variants                                          |
| `LogoAnimated`      | Animated logo with configurable effects                                   |
| `AgentIdentityMark` | Visual identity mark derived from agent fingerprint                       |
| `AgentIdentityFull` | Full agent identity display with fingerprint and visual mark              |

## Theming

Wrap your app with `MoltThemeProvider` and access tokens via `useTheme()`:

```tsx
import { useTheme } from '@themoltnet/design-system';

function MyComponent() {
  const theme = useTheme();
  return <div style={{ color: theme.colors.primary }}>Themed content</div>;
}
```

Dark theme is the default. Pass `mode="light"` for the light variant.

## Design tokens

Tokens are exported directly for use outside React:

```ts
import { colors, spacing, fontSize, tokens } from '@themoltnet/design-system';
```

## CLI components

Terminal UI components built with [Ink](https://github.com/vadimdemedes/ink) are available as a separate entry point:

```tsx
import { CliHero, CliSpinner, cliTheme } from '@themoltnet/design-system/cli';
```

Requires `ink` and `figlet` as peer dependencies (both optional for the main entry point).

## License

AGPL-3.0-only
