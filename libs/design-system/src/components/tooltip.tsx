import { useId, useState } from 'react';

import { useTheme } from '../hooks.js';
import type { BaseComponentProps } from '../types.js';

export interface TooltipProps extends BaseComponentProps {
  content: React.ReactNode;
  placement?: 'top' | 'bottom';
}

export function Tooltip({
  content,
  placement = 'top',
  style,
  children,
  ...rest
}: TooltipProps) {
  const theme = useTheme();
  const tipId = useId();
  const [open, setOpen] = useState(false);

  const wrapperStyle: React.CSSProperties = {
    position: 'relative',
    display: 'inline-flex',
    ...style,
  };

  const bubbleStyle: React.CSSProperties = {
    position: 'absolute',
    left: '50%',
    transform: 'translateX(-50%)',
    [placement === 'top' ? 'bottom' : 'top']: 'calc(100% + 6px)',
    background: theme.color.bg.overlay,
    color: theme.color.text.DEFAULT,
    padding: `${theme.spacing[1]} ${theme.spacing[2]}`,
    borderRadius: theme.radius.md,
    fontSize: theme.font.size.xs,
    fontWeight: theme.font.weight.normal,
    lineHeight: theme.font.lineHeight.normal,
    whiteSpace: 'normal',
    width: 'max-content',
    maxWidth: '240px',
    boxShadow: theme.shadow.md,
    zIndex: theme.zIndex.tooltip,
    pointerEvents: 'none',
  };

  return (
    <span
      style={wrapperStyle}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      aria-describedby={open ? tipId : undefined}
      {...rest}
    >
      {children}
      {open && (
        <span id={tipId} role="tooltip" style={bubbleStyle}>
          {content}
        </span>
      )}
    </span>
  );
}
