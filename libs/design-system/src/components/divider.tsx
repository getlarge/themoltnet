import { useTheme } from '../hooks.js';
import type { BaseComponentProps } from '../types.js';

export interface DividerProps extends Omit<BaseComponentProps, 'children'> {
  direction?: 'horizontal' | 'vertical';
}

export function Divider({
  direction = 'horizontal',
  style,
  ...rest
}: DividerProps) {
  const theme = useTheme();

  const computed: React.CSSProperties =
    direction === 'horizontal'
      ? {
          width: '100%',
          height: '1px',
          background: theme.color.border.DEFAULT,
          border: 'none',
          margin: `${theme.spacing[4]} 0`,
          ...style,
        }
      : {
          width: '1px',
          height: '100%',
          background: theme.color.border.DEFAULT,
          border: 'none',
          margin: `0 ${theme.spacing[4]}`,
          ...style,
        };

  return <hr style={computed} {...rest} />;
}
