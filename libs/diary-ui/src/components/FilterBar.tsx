import { Button, Stack, useTheme } from '@themoltnet/design-system';
import { useEffect, useRef, useState } from 'react';

import type { DiaryFilterState, TagCloudItem } from '../types.js';
import { ActiveFilterChips } from './ActiveFilterChips.js';
import { SortFacet } from './SortFacet.js';
import { TagsFacet } from './TagsFacet.js';
import { TypesFacet } from './TypesFacet.js';

export interface FilterBarProps {
  state: DiaryFilterState;
  tags: TagCloudItem[];
  resultCount: number;
  onChange: (next: DiaryFilterState) => void;
  onExplore: () => void;
}

export function FilterBar({
  state,
  tags,
  resultCount,
  onChange,
  onExplore,
}: FilterBarProps) {
  const theme = useTheme();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [searchFocused, setSearchFocused] = useState(false);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const isTyping =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);
      if (isTyping) return;
      const slash = event.key === '/';
      const cmdK =
        (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k';
      if (slash || cmdK) {
        event.preventDefault();
        inputRef.current?.focus();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div
      style={{
        display: 'grid',
        gap: theme.spacing[3],
        padding: theme.spacing[4],
        borderRadius: theme.radius.md,
        border: `1px solid ${theme.color.border.DEFAULT}`,
        background: theme.color.bg.surface,
        position: 'sticky',
        top: 0,
        zIndex: 10,
      }}
    >
      {/* Search row */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr auto',
          alignItems: 'center',
          gap: theme.spacing[3],
        }}
      >
        <div
          style={{
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <span
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: 12,
              color: theme.color.text.muted,
              fontSize: 14,
              pointerEvents: 'none',
            }}
          >
            ⌕
          </span>
          <input
            ref={inputRef}
            type="search"
            role="searchbox"
            aria-label="Search entries"
            placeholder="Search entries…"
            value={state.q}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            onChange={(event) => onChange({ ...state, q: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && state.q) {
                event.preventDefault();
                onChange({ ...state, q: '' });
              }
            }}
            style={{
              flex: 1,
              width: '100%',
              padding: '10px 12px 10px 36px',
              borderRadius: theme.radius.md,
              border: `1px solid ${
                searchFocused
                  ? theme.color.primary.DEFAULT
                  : theme.color.border.DEFAULT
              }`,
              background: theme.color.bg.elevated,
              color: theme.color.text.DEFAULT,
              fontFamily: 'inherit',
              fontSize: '0.9375rem',
              outline: 'none',
              transition: `border-color ${theme.transition.fast}, box-shadow ${theme.transition.fast}`,
              boxShadow: searchFocused
                ? `0 0 0 3px ${theme.color.primary.subtle}`
                : 'none',
            }}
          />
          {!state.q && (
            <span
              aria-hidden="true"
              style={{
                position: 'absolute',
                right: 12,
                padding: '2px 6px',
                borderRadius: theme.radius.sm,
                border: `1px solid ${theme.color.border.DEFAULT}`,
                background: theme.color.bg.void,
                color: theme.color.text.muted,
                fontSize: 11,
                fontFamily: theme.font.family.mono,
                lineHeight: 1.2,
              }}
            >
              /
            </span>
          )}
        </div>
        <span
          aria-live="polite"
          style={{
            color: theme.color.text.muted,
            fontFamily: theme.font.family.mono,
            fontSize: 12,
            letterSpacing: '0.02em',
            minWidth: 90,
            textAlign: 'right',
          }}
        >
          {resultCount} result{resultCount === 1 ? '' : 's'}
        </span>
      </div>

      {/* Facet row */}
      <Stack direction="row" gap={2} wrap align="center">
        <TagsFacet
          tags={tags}
          selected={state.tags}
          excluded={state.excludeTags}
          onChange={(next) =>
            onChange({
              ...state,
              tags: next.selected,
              excludeTags: next.excluded,
            })
          }
          onClear={() => onChange({ ...state, tags: [], excludeTags: [] })}
        />
        <TypesFacet
          selected={state.types}
          onChange={(types) => onChange({ ...state, types })}
        />
        <SortFacet
          weights={state.weights}
          disabled={state.q === ''}
          onChange={(weights) => onChange({ ...state, weights })}
        />
        <div style={{ flex: 1 }} />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Explore tags"
          onClick={onExplore}
        >
          Explore tags →
        </Button>
      </Stack>

      <ActiveFilterChips
        state={state}
        onChange={onChange}
        onClear={() =>
          onChange({
            ...state,
            q: '',
            tags: [],
            excludeTags: [],
            types: [],
            weights: null,
          })
        }
      />
    </div>
  );
}
