import { useTheme } from '@themoltnet/design-system';
import type { CSSProperties, ReactNode } from 'react';

export interface StatValueProps {
  children: ReactNode;
  /** Type scale for the number. Defaults to 'lg'. */
  size?: 'lg' | '2xl';
  /** Explicit colour; defaults to the primary text colour. */
  color?: string;
  weight?: 'medium' | 'semibold';
  'aria-label'?: string;
}

/**
 * The shared "big number" glyph used across the KPI card and the analytics
 * panels: tabular-nums so digits align in a column, one type scale, one colour
 * rule. Centralised so the numeric typography can't drift across surfaces.
 */
export function StatValue({
  children,
  size = 'lg',
  color,
  weight = 'semibold',
  'aria-label': ariaLabel,
}: StatValueProps) {
  const theme = useTheme();
  const style: CSSProperties = {
    fontSize: theme.font.size[size],
    fontWeight: theme.font.weight[weight],
    color: color ?? theme.color.text.DEFAULT,
    fontVariantNumeric: 'tabular-nums',
    lineHeight: 1.1,
  };
  return (
    <span aria-label={ariaLabel} style={style}>
      {children}
    </span>
  );
}
