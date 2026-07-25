import { useTheme } from '../hooks.js';
import type { BaseComponentProps } from '../types.js';

/**
 * Verification state of a signed artifact (diary entry, commit, grant).
 *
 * - `verified`   — signature checked and valid.
 * - `unverified` — a signature exists but has not been checked this session.
 * - `invalid`    — signature present but failed verification (tamper-evident).
 * - `pending`    — verification in progress.
 * - `unsigned`   — no signature at all. Deliberately distinct from `unverified`
 *   so a *missing* signature never reads as an ordinary empty state.
 */
export type SignatureState =
  | 'verified'
  | 'unverified'
  | 'invalid'
  | 'pending'
  | 'unsigned';

export interface SignatureStatusProps extends BaseComponentProps {
  state: SignatureState;
  /** Override the default label for the state. */
  label?: string;
  /**
   * Optional signature/CID shown in mono after the label (e.g. a truncated
   * base64 signature or content hash). Purely presentational.
   */
  detail?: string;
}

// Icon is a glyph so state is never conveyed by color alone (WCAG 1.4.1).
const STATE_META: Record<
  SignatureState,
  {
    label: string;
    glyph: string;
    tone: 'success' | 'error' | 'warning' | 'muted';
  }
> = {
  verified: { label: 'Verified', glyph: '✓', tone: 'success' },
  unverified: { label: 'Unverified', glyph: '?', tone: 'warning' },
  invalid: { label: 'Invalid signature', glyph: '✕', tone: 'error' },
  pending: { label: 'Verifying…', glyph: '⋯', tone: 'muted' },
  unsigned: { label: 'Unsigned', glyph: '—', tone: 'muted' },
};

/**
 * Legible, honest verification status for signed MoltNet artifacts.
 *
 * Makes signature/verification status a first-class, consistent primitive
 * (PRODUCT.md Principle 1: "verification status must be legible, never hidden")
 * instead of leaving each surface to improvise it from a Badge.
 */
export function SignatureStatus({
  state,
  label,
  detail,
  style,
  ...rest
}: SignatureStatusProps) {
  const theme = useTheme();
  const meta = STATE_META[state];

  const tone = {
    success: {
      fg: theme.color.success.DEFAULT,
      bg: theme.color.success.muted,
    },
    error: { fg: theme.color.error.DEFAULT, bg: theme.color.error.muted },
    warning: {
      fg: theme.color.warning.DEFAULT,
      bg: theme.color.warning.muted,
    },
    muted: { fg: theme.color.text.secondary, bg: theme.color.bg.overlay },
  }[meta.tone];

  const computed: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing[1.5],
    padding: `${theme.spacing[0.5]} ${theme.spacing[2]}`,
    borderRadius: theme.radius.full,
    fontSize: theme.font.size.xs,
    fontWeight: theme.font.weight.medium,
    lineHeight: theme.font.lineHeight.normal,
    whiteSpace: 'nowrap',
    color: tone.fg,
    background: tone.bg,
    ...style,
  };

  return (
    <span
      style={computed}
      role="status"
      aria-label={`Signature status: ${label ?? meta.label}`}
      {...rest}
    >
      <span aria-hidden="true" style={{ fontWeight: theme.font.weight.bold }}>
        {meta.glyph}
      </span>
      <span>{label ?? meta.label}</span>
      {detail && (
        <span
          style={{
            fontFamily: theme.font.family.mono,
            color: theme.color.text.muted,
          }}
        >
          {detail}
        </span>
      )}
    </span>
  );
}
