import { useTheme } from '../hooks.js';
import type { BaseComponentProps } from '../types.js';

export interface CodeBlockProps extends BaseComponentProps {
  /** Render as inline <code> instead of a block <pre>. */
  inline?: boolean;
}

export function CodeBlock({
  inline,
  style,
  children,
  ...rest
}: CodeBlockProps) {
  const theme = useTheme();

  if (inline) {
    const computed: React.CSSProperties = {
      fontFamily: theme.font.family.mono,
      fontSize: '0.875em',
      padding: `${theme.spacing[0.5]} ${theme.spacing[1]}`,
      background: theme.color.primary.subtle,
      color: theme.color.primary.DEFAULT,
      borderRadius: theme.radius.sm,
      ...style,
    };
    return (
      <code style={computed} {...rest}>
        {children}
      </code>
    );
  }

  const computed: React.CSSProperties = {
    fontFamily: theme.font.family.mono,
    fontSize: theme.font.size.sm,
    lineHeight: theme.font.lineHeight.relaxed,
    padding: theme.spacing[4],
    background: theme.color.bg.surface,
    color: theme.color.text.DEFAULT,
    border: `1px solid ${theme.color.border.DEFAULT}`,
    borderRadius: theme.radius.lg,
    overflow: 'auto',
    whiteSpace: 'pre',
    margin: 0,
    ...style,
  };

  return (
    <pre style={computed} {...rest}>
      <code>{children}</code>
    </pre>
  );
}
