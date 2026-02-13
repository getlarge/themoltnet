import { Highlight, type Language, themes } from 'prism-react-renderer';

import { useTheme } from '../hooks.js';
import type { BaseComponentProps } from '../types.js';

export interface CodeBlockProps extends BaseComponentProps {
  /** Render as inline <code> instead of a block <pre>. */
  inline?: boolean;
  /** Language for syntax highlighting (e.g. "typescript", "bash"). */
  language?: Language;
}

export function CodeBlock({
  inline,
  language,
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

  const basePreStyle: React.CSSProperties = {
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
  };

  if (language) {
    const code =
      typeof children === 'string'
        ? children.trim()
        : ((children as string[] | undefined)?.join('').trim() ?? '');

    return (
      <div style={{ position: 'relative' }}>
        <span
          style={{
            position: 'absolute',
            top: theme.spacing[2],
            right: theme.spacing[3],
            fontFamily: theme.font.family.mono,
            fontSize: theme.font.size.xs,
            color: theme.color.text.muted,
            userSelect: 'none',
            lineHeight: 1,
            zIndex: 1,
          }}
        >
          {language}
        </span>
        <Highlight theme={themes.oneDark} code={code} language={language}>
          {({ tokens, getLineProps, getTokenProps }) => (
            <pre style={{ ...basePreStyle, ...style }} {...rest}>
              <code>
                {tokens.map((line, i) => (
                  <div key={i} {...getLineProps({ line })}>
                    {line.map((token, j) => (
                      <span key={j} {...getTokenProps({ token })} />
                    ))}
                  </div>
                ))}
              </code>
            </pre>
          )}
        </Highlight>
      </div>
    );
  }

  return (
    <pre style={{ ...basePreStyle, ...style }} {...rest}>
      <code>{children}</code>
    </pre>
  );
}
