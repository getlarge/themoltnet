import { useTheme } from '../hooks.js';
import type { BaseComponentProps } from '../types.js';

export interface ContainerProps extends BaseComponentProps {
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
}

const maxWidthMap = {
  sm: '640px',
  md: '768px',
  lg: '1024px',
  xl: '1280px',
  full: '100%',
};

export function Container({
  maxWidth = 'lg',
  style,
  children,
  ...rest
}: ContainerProps) {
  const theme = useTheme();

  const computed: React.CSSProperties = {
    width: '100%',
    maxWidth: maxWidthMap[maxWidth],
    marginLeft: 'auto',
    marginRight: 'auto',
    paddingLeft: theme.spacing[6],
    paddingRight: theme.spacing[6],
    ...style,
  };

  return (
    <div style={computed} {...rest}>
      {children}
    </div>
  );
}
