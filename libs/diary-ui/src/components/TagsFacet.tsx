import { useTheme } from '@themoltnet/design-system';
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
        <div style={{ display: 'grid', gap: theme.spacing[2] }}>
          <input
            type="search"
            role="searchbox"
            aria-label="Filter tags"
            placeholder="Search tags…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            style={{
              padding: '6px 8px',
              borderRadius: theme.radius.sm,
              border: `1px solid ${theme.color.border.DEFAULT}`,
              background: theme.color.bg.surface,
              color: theme.color.text.DEFAULT,
              font: 'inherit',
            }}
          />
          <div
            role="list"
            style={{
              display: 'grid',
              gap: 2,
              maxHeight: 260,
              overflowY: 'auto',
            }}
          >
            {filtered.length === 0 && (
              <span style={{ color: theme.color.text.muted, padding: 6 }}>
                No tags match.
              </span>
            )}
            {filtered.map((item) => {
              const isIncluded = selected.includes(item.tag);
              const isExcluded = excluded.includes(item.tag);
              return (
                <div
                  key={item.tag}
                  role="listitem"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: 4,
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
                      flex: 1,
                      textAlign: 'left',
                      padding: '4px 8px',
                      borderRadius: theme.radius.sm,
                      border: `1px solid ${
                        isIncluded
                          ? theme.color.primary.DEFAULT
                          : theme.color.border.DEFAULT
                      }`,
                      background: isIncluded
                        ? theme.color.primary.muted
                        : theme.color.bg.surface,
                      color: theme.color.text.DEFAULT,
                      cursor: 'pointer',
                      font: 'inherit',
                    }}
                  >
                    {isIncluded ? '✓ ' : ''}
                    {item.tag}{' '}
                    <span
                      style={{ color: theme.color.text.muted, fontSize: 11 }}
                    >
                      {item.count}
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-pressed={isExcluded}
                    aria-label={`Exclude tag: ${item.tag}`}
                    onClick={() =>
                      isExcluded ? clearOne(item.tag) : exclude(item.tag)
                    }
                    style={{
                      padding: '4px 6px',
                      borderRadius: theme.radius.sm,
                      border: `1px solid ${
                        isExcluded
                          ? theme.color.error.DEFAULT
                          : theme.color.border.DEFAULT
                      }`,
                      background: isExcluded
                        ? theme.color.error.DEFAULT
                        : theme.color.bg.surface,
                      color: isExcluded
                        ? theme.color.text.inverse
                        : theme.color.text.DEFAULT,
                      cursor: 'pointer',
                      font: 'inherit',
                    }}
                    title="Exclude"
                  >
                    −
                  </button>
                </div>
              );
            })}
          </div>
          {activeCount > 0 && (
            <button
              type="button"
              onClick={onClear}
              aria-label="Clear tags"
              style={{
                marginTop: 4,
                padding: '6px 8px',
                borderRadius: theme.radius.sm,
                border: `1px solid ${theme.color.border.DEFAULT}`,
                background: theme.color.bg.surface,
                color: theme.color.text.DEFAULT,
                cursor: 'pointer',
                font: 'inherit',
              }}
            >
              Clear tags
            </button>
          )}
        </div>
      )}
    </Popover>
  );
}
