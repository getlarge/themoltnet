import { useTheme } from '../hooks.js';
import type { BaseComponentProps } from '../types.js';
import type { spacing } from '../tokens.js';

type SpacingKey = keyof typeof spacing;

export interface StackProps extends BaseComponentProps {
  direction?: 'row' | 'column';
  gap?: SpacingKey;
  align?: React.CSSProperties['alignItems'];
  justify?: React.CSSProperties['justifyContent'];
  wrap?: boolean;
}

export function Stack({
  direction = 'column',
  gap = 4,
  align,
  justify,
  wrap,
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
    ...style,
  };

  return (
    <div style={computed} {...rest}>
      {children}
    </div>
  );
}
