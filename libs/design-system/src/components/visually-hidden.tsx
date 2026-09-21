import type { CSSProperties, HTMLAttributes } from 'react';

/**
 * Hides content visually while keeping it in the accessibility tree, e.g.
 * "(opens in a new tab)" after a link or a live-region status message.
 */
export const visuallyHiddenStyle: CSSProperties = {
  border: 0,
  clip: 'rect(0 0 0 0)',
  height: 1,
  margin: -1,
  overflow: 'hidden',
  padding: 0,
  position: 'absolute',
  whiteSpace: 'nowrap',
  width: 1,
};

export type VisuallyHiddenProps = HTMLAttributes<HTMLSpanElement>;

export function VisuallyHidden({ style, ...rest }: VisuallyHiddenProps) {
  return <span style={{ ...visuallyHiddenStyle, ...style }} {...rest} />;
}
