import { Button, Stack, Text, useTheme } from '@themoltnet/design-system';
import { useMemo, useState } from 'react';

import type { TagCloudItem } from '../types.js';
import { Popover } from './Popover.js';

const TOP_N = 20;

export interface TagsFacetSelection {
  selected: string[];
  excluded: string[];
}

export interface TagsFacetProps {
  tags: TagCloudItem[];
  selected: string[];
  excluded: string[];
  onChange: (next: TagsFacetSelection) => void;
  onClear: () => void;
}

export function TagsFacet({
  tags,
  selected,
  excluded,
  onChange,
  onClear,
}: TagsFacetProps) {
  const theme = useTheme();
  const [search, setSearch] = useState('');
  const activeCount = selected.length + excluded.length;

  const sortedByCount = useMemo(
    () => [...tags].sort((a, b) => b.count - a.count),
    [tags],
  );
  const topN = useMemo(() => sortedByCount.slice(0, TOP_N), [sortedByCount]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return topN;
    return sortedByCount.filter((item) =>
      item.tag.toLowerCase().includes(needle),
    );
  }, [search, sortedByCount, topN]);

  function include(tag: string) {
    onChange({
      selected: selected.includes(tag) ? selected : [...selected, tag],
      excluded: excluded.filter((other) => other !== tag),
    });
  }

  function exclude(tag: string) {
    onChange({
      selected: selected.filter((other) => other !== tag),
      excluded: excluded.includes(tag) ? excluded : [...excluded, tag],
    });
  }

  function clearOne(tag: string) {
    onChange({
      selected: selected.filter((other) => other !== tag),
      excluded: excluded.filter((other) => other !== tag),
    });
  }

  return (
    <Popover label="Tags" ariaLabel="Tags filter" badge={activeCount}>
      {() => (
        <Stack gap={3}>
          <Stack gap={1}>
            <Text variant="overline" color="muted">
              Filter by tag
            </Text>
            <input
              type="search"
              role="searchbox"
              aria-label="Filter tags"
              placeholder="Type to search…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              style={{
                padding: '0.5rem 0.75rem',
                borderRadius: theme.radius.sm,
                border: `1px solid ${theme.color.border.DEFAULT}`,
                background: theme.color.bg.surface,
                color: theme.color.text.DEFAULT,
                fontFamily: 'inherit',
                fontSize: '0.875rem',
                outline: 'none',
                transition: `border-color ${theme.transition.fast}`,
              }}
            />
          </Stack>

          <div
            role="list"
            style={{
              display: 'grid',
              gap: 2,
              maxHeight: 280,
              overflowY: 'auto',
              margin: `0 -${theme.spacing[2]}`,
              padding: `0 ${theme.spacing[2]}`,
            }}
          >
            {filtered.length === 0 && (
              <Text color="muted" variant="caption">
                No tags match.
              </Text>
            )}
            {filtered.map((item) => {
              const isIncluded = selected.includes(item.tag);
              const isExcluded = excluded.includes(item.tag);
              return (
                <div
                  key={item.tag}
                  role="listitem"
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr auto',
                    alignItems: 'center',
                    gap: 6,
                    padding: '2px 0',
                  }}
                >
                  <button
                    type="button"
                    aria-pressed={isIncluded}
                    aria-label={`Include tag: ${item.tag}`}
                    onClick={() =>
                      isIncluded ? clearOne(item.tag) : include(item.tag)
                    }
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                      padding: '6px 10px',
                      borderRadius: theme.radius.sm,
                      border: `1px solid ${
                        isIncluded ? theme.color.primary.DEFAULT : 'transparent'
                      }`,
                      background: isIncluded
                        ? theme.color.primary.muted
                        : 'transparent',
                      color: theme.color.text.DEFAULT,
                      cursor: 'pointer',
                      font: 'inherit',
                      fontSize: '0.875rem',
                      textAlign: 'left',
                      transition: `background ${theme.transition.fast}, border-color ${theme.transition.fast}`,
                    }}
                  >
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 8,
                        minWidth: 0,
                      }}
                    >
                      <span
                        aria-hidden="true"
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: 999,
                          background: isIncluded
                            ? theme.color.primary.DEFAULT
                            : theme.color.border.DEFAULT,
                          flexShrink: 0,
                        }}
                      />
                      <span
                        style={{
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {item.tag}
                      </span>
                    </span>
                    <Text
                      variant="caption"
                      color="muted"
                      mono
                      style={{ flexShrink: 0 }}
                    >
                      {item.count}
                    </Text>
                  </button>
                  <button
                    type="button"
                    aria-pressed={isExcluded}
                    aria-label={`Exclude tag: ${item.tag}`}
                    title="Exclude"
                    onClick={() =>
                      isExcluded ? clearOne(item.tag) : exclude(item.tag)
                    }
                    style={{
                      width: 28,
                      height: 28,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: theme.radius.sm,
                      border: `1px solid ${
                        isExcluded
                          ? theme.color.error.DEFAULT
                          : theme.color.border.DEFAULT
                      }`,
                      background: isExcluded
                        ? theme.color.error.DEFAULT
                        : 'transparent',
                      color: isExcluded
                        ? theme.color.text.inverse
                        : theme.color.text.muted,
                      cursor: 'pointer',
                      font: 'inherit',
                      fontSize: '0.875rem',
                      lineHeight: 1,
                      transition: `background ${theme.transition.fast}, color ${theme.transition.fast}, border-color ${theme.transition.fast}`,
                    }}
                  >
                    <span aria-hidden="true">−</span>
                  </button>
                </div>
              );
            })}
          </div>

          {activeCount > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClear}
              aria-label="Clear tags"
            >
              Clear tags
            </Button>
          )}
        </Stack>
      )}
    </Popover>
  );
}
