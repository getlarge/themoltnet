import { useTheme } from '../hooks.js';
import type { spacing } from '../tokens.js';
import type { BaseComponentProps } from '../types.js';

type SpacingKey = keyof typeof spacing;

export interface StackProps extends BaseComponentProps {
  direction?: 'row' | 'column';
  gap?: SpacingKey;
  align?: React.CSSProperties['alignItems'];
  justify?: React.CSSProperties['justifyContent'];
  wrap?: boolean;
  /**
   * Let this stack shrink below its content's width inside a flex parent
   * (`min-width: 0`), so long values wrap or truncate instead of overflowing.
   */
  shrink?: boolean;
}

export function Stack({
  direction = 'column',
  gap = 4,
  align,
  justify,
  wrap,
  shrink,
  style,
  children,
  ...rest
}: StackProps) {
  const theme = useTheme();

  const computed: React.CSSProperties = {
    display: 'flex',
    flexDirection: direction,
    gap: theme.spacing[gap],
    alignItems: align,
    justifyContent: justify,
    flexWrap: wrap ? 'wrap' : undefined,
    minWidth: shrink ? 0 : undefined,
    ...style,
  };

  return (
    <div style={computed} {...rest}>
      {children}
    </div>
  );
}
