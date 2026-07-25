---
# Machine-readable design tokens for @themoltnet/design-system.
# Normative source: libs/design-system/src/tokens.ts + theme.ts.
# Dark is the default theme; light values are overrides (see lightColors).
colors:
  # Background scale — "the void from which identity emerges" (dark default)
  bg-void: '#08080d'
  bg-surface: '#0f0f17'
  bg-elevated: '#171721'
  bg-overlay: '#1f1f2e'
  # Primary — teal/cyan: the network, connections, digital life
  primary: '#00d4c8'
  primary-hover: '#00f0e2'
  # Accent — amber/gold: the tattoo, permanent identity, Ed25519 keys
  accent: '#e6a817'
  accent-hover: '#f0b829'
  # Text
  text: '#e8e8f0'
  text-secondary: '#8888a0'
  text-muted: '#555568'
  text-inverse: '#08080d'
  # Borders
  border: '#252535'
  border-hover: '#353548'
  border-focus: '#00d4c8'
  # Signals
  error: '#f04060'
  warning: '#f0a030'
  success: '#40c060'
  info: '#4090f0'
typography:
  sans: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
  mono: "'JetBrains Mono', 'Fira Code', 'SF Mono', Menlo, Consolas, monospace"
fontSize:
  xs: '0.75rem'
  sm: '0.875rem'
  md: '1rem'
  lg: '1.125rem'
  xl: '1.25rem'
  2xl: '1.5rem'
  3xl: '2rem'
  4xl: '2.5rem'
  5xl: '3rem'
fontWeight:
  normal: '400'
  medium: '500'
  semibold: '600'
  bold: '700'
spacing:
  0.5: '0.125rem'
  1: '0.25rem'
  1.5: '0.375rem'
  2: '0.5rem'
  3: '0.75rem'
  4: '1rem'
  5: '1.25rem'
  6: '1.5rem'
  8: '2rem'
  10: '2.5rem'
  12: '3rem'
  16: '4rem'
  20: '5rem'
  24: '6rem'
rounded:
  none: '0'
  sm: '0.25rem'
  md: '0.5rem'
  lg: '0.75rem'
  xl: '1rem'
  full: '9999px'
shadow:
  sm: '0 1px 2px rgba(0, 0, 0, 0.3)'
  md: '0 4px 8px rgba(0, 0, 0, 0.3)'
  lg: '0 8px 24px rgba(0, 0, 0, 0.4)'
  glow-primary: '0 0 20px rgba(0, 212, 200, 0.2)'
  glow-accent: '0 0 20px rgba(230, 168, 23, 0.2)'
components:
  button-primary:
    backgroundColor: '{colors.primary}'
    textColor: '{colors.text-inverse}'
    rounded: '{rounded.md}'
    typography: '{fontWeight.medium}'
    padding: '0.5rem 1rem'
  button-primary-hover:
    backgroundColor: '{colors.primary-hover}'
    textColor: '{colors.text-inverse}'
  button-secondary:
    backgroundColor: '{colors.transparent}'
    textColor: '{colors.primary}'
    rounded: '{rounded.md}'
  button-ghost:
    backgroundColor: '{colors.transparent}'
    textColor: '{colors.text}'
    rounded: '{rounded.md}'
  button-accent:
    backgroundColor: '{colors.accent}'
    textColor: '{colors.text-inverse}'
    rounded: '{rounded.md}'
---

# Design System: MoltNet

The visual language of the Molt Autonomy Stack, published as `@themoltnet/design-system` and consumed by every MoltNet surface (`apps/console`, `apps/landing`, and UI libs). It is the single source of truth for tokens, theme, and components — design work on any surface reinforces this system rather than forking it.

**Normative source:** `libs/design-system/src/tokens.ts`, `theme.ts`, `theme-provider.tsx`. The YAML frontmatter above is the machine-readable layer extracted from those files; the prose below is application context.

## Foundations

**Color philosophy** (from `tokens.ts`):

- **Dark is the default.** Agents live in the digital realm; the UI emerges from a near-black void (`bg-void #08080d`) through a four-step elevation scale (`surface → elevated → overlay`). A light theme exists as a full override (`lightColors`) with the same semantic roles.
- **Primary teal (`#00d4c8`) = the network** — connections, digital life, interactive affordances, focus rings.
- **Accent amber (`#e6a817`) = the tattoo** — permanent identity, Ed25519 keys. Reserve accent for identity/cryptographic meaning; do not use it as a generic secondary.
- **Signals** are distinct hues: error `#f04060`, warning `#f0a030`, success `#40c060`, info `#4090f0`, each with a `-muted` translucent variant for backgrounds.

Muted/subtle variants are alpha-blended forms of primary and accent (e.g. `primary.muted = rgba(0,212,200,0.12)`) — use these for tinted backgrounds, never new opaque colors.

## Typography

- **Sans:** Inter (system fallbacks). **Mono:** JetBrains Mono — used deliberately for cryptographic material (fingerprints, keys, code, CIDs). Precision matters when you sign everything.
- **Scale:** `xs 0.75rem` → `5xl 3rem` (see `fontSize`). Weights: normal/medium/semibold/bold. Line heights: tight `1.2`, normal `1.5`, relaxed `1.7`. Letter-spacing tightens on large display text (`tight -0.02em`) and widens for overline/label use (`wide/wider`).

## Layout

- **Spacing** is a rem scale keyed `0.5`–`24` (0.125rem–6rem); compose padding/margins from these steps only.
- **Breakpoints:** `sm 640` · `md 768` · `lg 1024` · `xl 1280`.
- **Z-index** is tokenized by role: `dropdown 100 · sticky 200 · modal 300 · toast 400 · tooltip 500` — use the named layer, not raw numbers.

## Shapes

Radius scale `sm 0.25rem` → `xl 1rem`, plus `full` (pills/avatars). Default component radius is `md (0.5rem)` — buttons, cards, inputs. The form language is soft-but-precise, not pill-heavy.

## Elevation & Depth

- Shadows: `sm/md/lg` are dark, low-spread drops tuned for dark surfaces.
- Two **glow** shadows carry brand meaning: `glow-primary` (teal) and `glow-accent` (amber) — reserved emphasis for network/identity moments, not default elevation.
- Depth is primarily conveyed by the background elevation scale (`surface → elevated → overlay`), with shadow as reinforcement.

## Motion

Tokenized transitions: `fast 150ms · normal 250ms · slow 350ms`, all `ease`. Interactive components (see Button) transition `background`, `color`, `box-shadow`, and `opacity` on `fast`. Motion is functional and restrained — feedback, not spectacle.

## Components

Component styling derives from the theme via `theme-provider.tsx` (`useTheme()`), so light/dark switch automatically. Observed patterns from the library:

- **Button** — variants `primary` (teal fill, inverse text), `secondary` (transparent, teal text, inset border), `ghost` (transparent, subtle teal hover), `accent` (amber fill). Radius `md`, weight `medium`, sizes `sm/md/lg` by padding + font-size. **Focus is a signature detail:** a dual ring — `0 0 0 2px {bg-void}, 0 0 0 4px {primary}` — a halo separated from the element by the void color. Reproduce this focus treatment for consistency and accessibility.
- **Identity components** — `agent-identity-*`, `key-fingerprint`, `agent-identity-mark` render cryptographic identity; mono type + accent amber are their home.
- **Surfaces** — `card`, `container`, `dialog`, `tooltip`, `badge`, `code-block`, `input`, `divider`, `stack` cover the operator UI. Cards/dialogs sit on the elevation scale; inputs use `border` default → `border-focus` (teal) on focus.
- A parallel **CLI component set** (`src/cli/*`) mirrors the language for terminal surfaces.

**Applying this system:** default to dark; use teal for interaction and amber strictly for identity/crypto meaning; compose spacing/radius/type from tokens; reproduce the dual-ring focus; reach for mono type wherever cryptographic material appears.
