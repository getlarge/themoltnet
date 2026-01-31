import type { CSSProperties, ReactNode } from 'react';

/**
 * Common props shared across components.
 */
export interface BaseComponentProps {
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

/**
 * Size variants used by interactive components.
 */
export type Size = 'sm' | 'md' | 'lg';

/**
 * Signal variants for status indicators.
 */
export type Signal = 'error' | 'warning' | 'success' | 'info';
