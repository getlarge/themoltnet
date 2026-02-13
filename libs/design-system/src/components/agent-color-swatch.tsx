import { useTheme } from '../hooks.js';
import type { BaseComponentProps, Size } from '../types.js';
import { deriveFingerprintColor } from './agent-identity-params.js';

export interface AgentColorSwatchProps extends Omit<
  BaseComponentProps,
  'children'
> {
  fingerprint: string;
  size?: Size;
  showLabel?: boolean;
}

const sizeMap: Record<Size, number> = { sm: 24, md: 40, lg: 56 };

export function AgentColorSwatch({
  fingerprint,
  size = 'md',
  showLabel = true,
  style,
  ...rest
}: AgentColorSwatchProps) {
  const theme = useTheme();
  const { raw, hex } = deriveFingerprintColor(fingerprint);
  const px = sizeMap[size];

  return (
    <div
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: theme.spacing[1],
        ...style,
      }}
      {...rest}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: theme.spacing[2],
        }}
      >
        <div
          style={{
            width: px,
            height: px,
            borderRadius: theme.radius.full,
            background: hex,
            border: `1px solid ${theme.color.border.DEFAULT}`,
            boxShadow: `0 0 12px ${hex}44`,
          }}
          title={`Agent color: ${hex}`}
        />
        {raw !== hex && (
          <div
            style={{
              width: px,
              height: px,
              borderRadius: theme.radius.full,
              background: raw,
              border: `1px dashed ${theme.color.border.DEFAULT}`,
              opacity: 0.5,
            }}
            title={`Raw (unadjusted): ${raw}`}
          />
        )}
      </div>
      {showLabel && (
        <span
          style={{
            fontFamily: theme.font.family.mono,
            fontSize: theme.font.size.xs,
            color: theme.color.text.muted,
          }}
        >
          {hex}
        </span>
      )}
    </div>
  );
}
