import { useTheme } from '../hooks.js';
import type { BaseComponentProps, Size } from '../types.js';

export interface KeyFingerprintProps extends Omit<
  BaseComponentProps,
  'children'
> {
  /** The fingerprint string, e.g. "A1B2-C3D4-E5F6-G7H8". */
  fingerprint: string;
  /** Optional label shown above the fingerprint. */
  label?: string;
  size?: Size;
  /** Copy the fingerprint to clipboard on click. */
  copyable?: boolean;
  /** Optional accent color (hex string) shown as a left-border highlight. */
  color?: string;
}

export function KeyFingerprint({
  fingerprint,
  label,
  size = 'md',
  copyable,
  color,
  style,
  ...rest
}: KeyFingerprintProps) {
  const theme = useTheme();

  const fontSizeMap: Record<Size, string> = {
    sm: theme.font.size.xs,
    md: theme.font.size.sm,
    lg: theme.font.size.md,
  };

  const handleClick = copyable
    ? () => {
        void navigator.clipboard.writeText(fingerprint);
      }
    : undefined;

  const wrapperStyle: React.CSSProperties = {
    display: 'inline-flex',
    flexDirection: 'column',
    gap: theme.spacing[1],
    ...style,
  };

  const labelStyle: React.CSSProperties = {
    fontSize: theme.font.size.xs,
    fontWeight: theme.font.weight.medium,
    color: theme.color.text.muted,
    letterSpacing: theme.font.letterSpacing.wider,
    textTransform: 'uppercase' as const,
  };

  const fingerprintStyle: React.CSSProperties = {
    fontFamily: theme.font.family.mono,
    fontSize: fontSizeMap[size],
    fontWeight: theme.font.weight.medium,
    color: theme.color.accent.DEFAULT,
    background: theme.color.accent.subtle,
    padding: `${theme.spacing[1]} ${theme.spacing[2]}`,
    borderRadius: theme.radius.md,
    border: `1px solid ${theme.color.accent.muted}`,
    letterSpacing: theme.font.letterSpacing.wide,
    cursor: copyable ? 'pointer' : 'default',
    userSelect: 'all',
    transition: `background ${theme.transition.fast}`,
    ...(color
      ? { borderLeft: `3px solid ${color}`, paddingLeft: theme.spacing[3] }
      : {}),
  };

  return (
    <div style={wrapperStyle} {...rest}>
      {label && <span style={labelStyle}>{label}</span>}
      <span
        style={fingerprintStyle}
        onClick={handleClick}
        role={copyable ? 'button' : undefined}
        tabIndex={copyable ? 0 : undefined}
        title={copyable ? 'Click to copy' : undefined}
      >
        {fingerprint}
      </span>
    </div>
  );
}
