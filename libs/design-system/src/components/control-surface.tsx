import type { HTMLAttributes } from 'react';

import { useTheme } from '../hooks.js';

export type ControlSurfaceTone = 'neutral' | 'network' | 'identity';
export type ControlSurfaceElement = 'div' | 'section' | 'article';

export interface ControlSurfaceProps extends HTMLAttributes<HTMLElement> {
  as?: ControlSurfaceElement;
  tone?: ControlSurfaceTone;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  active?: boolean;
}

/**
 * A flat, inspectable operator surface for task, runtime, policy, and evidence
 * data. Unlike Card, it is structural rather than interactive.
 */
export function ControlSurface({
  as: Element = 'div',
  tone = 'neutral',
  padding = 'md',
  active = false,
  style,
  children,
  ...rest
}: ControlSurfaceProps) {
  const theme = useTheme();

  const paddingMap = {
    none: '0',
    sm: theme.spacing[3],
    md: theme.spacing[5],
    lg: theme.spacing[8],
  };

  const toneColor = {
    neutral: theme.color.border.DEFAULT,
    network: theme.color.primary.DEFAULT,
    identity: theme.color.accent.DEFAULT,
  }[tone];

  return (
    <Element
      style={{
        minWidth: 0,
        padding: paddingMap[padding],
        border: `1px solid ${active ? toneColor : theme.color.border.DEFAULT}`,
        borderRadius: theme.radius.lg,
        background: theme.color.bg.surface,
        boxShadow: active ? theme.shadow.md : 'none',
        ...style,
      }}
      {...rest}
    >
      {children}
    </Element>
  );
}
