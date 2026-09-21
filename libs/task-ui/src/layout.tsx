import { Text, useTheme } from '@themoltnet/design-system';
import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useId,
  useState,
} from 'react';

/** Comfortable prose measure for summaries, descriptions, and notes. */
export const MEASURE = '72ch';

export function lineClamp(lines: number): CSSProperties {
  return {
    display: '-webkit-box',
    WebkitLineClamp: lines,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
  };
}

/** The small heading that names a part of a panel. */
export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <Text as="h3" variant="caption" weight="semibold" color="secondary">
      {children}
    </Text>
  );
}

/** A list whose items are separated by one-pixel rules. */
export function RuledList({
  label,
  labelledBy,
  gap = 4,
  children,
}: {
  label?: string;
  labelledBy?: string;
  gap?: 4 | 5;
  children: ReactNode[];
}) {
  const theme = useTheme();
  const space = theme.spacing[gap];
  return (
    <ul
      aria-label={label}
      aria-labelledby={labelledBy}
      style={{
        listStyle: 'none',
        margin: 0,
        padding: 0,
        display: 'grid',
        rowGap: space,
      }}
    >
      {children.map((child, index) => (
        <li
          key={index}
          style={
            index === 0
              ? undefined
              : {
                  borderTop: `1px solid ${theme.color.border.DEFAULT}`,
                  paddingTop: space,
                }
          }
        >
          {child}
        </li>
      ))}
    </ul>
  );
}

/**
 * State for content that starts collapsed: the region id to label it and
 * the props for the toggle button.
 */
export function useExpandable() {
  const regionId = useId();
  const [expanded, setExpanded] = useState(false);
  const toggle = useCallback(() => setExpanded((value) => !value), []);
  return {
    expanded,
    regionId,
    toggleProps: {
      'aria-expanded': expanded,
      'aria-controls': regionId,
      onClick: toggle,
    },
  };
}
