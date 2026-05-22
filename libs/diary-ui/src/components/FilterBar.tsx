import { useTheme } from '@themoltnet/design-system';
import { useEffect, useRef } from 'react';

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
        padding: theme.spacing[3],
        borderRadius: theme.radius.md,
        border: `1px solid ${theme.color.border.DEFAULT}`,
        background: theme.color.bg.surface,
        position: 'sticky',
        top: 0,
        zIndex: 10,
      }}
    >
      <div
        style={{
          display: 'flex',
          gap: theme.spacing[2],
          alignItems: 'center',
        }}
      >
        <input
          ref={inputRef}
          type="search"
          role="searchbox"
          aria-label="Search entries"
          placeholder="Search entries…  (/ or ⌘K)"
          value={state.q}
          onChange={(event) => onChange({ ...state, q: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && state.q) {
              event.preventDefault();
              onChange({ ...state, q: '' });
            }
          }}
          style={{
            flex: 1,
            padding: '8px 10px',
            borderRadius: theme.radius.md,
            border: `1px solid ${theme.color.border.DEFAULT}`,
            background: theme.color.bg.elevated,
            color: theme.color.text.DEFAULT,
            font: 'inherit',
          }}
        />
        <span
          aria-live="polite"
          style={{
            color: theme.color.text.muted,
            minWidth: 80,
            textAlign: 'right',
          }}
        >
          {resultCount} result{resultCount === 1 ? '' : 's'}
        </span>
      </div>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: theme.spacing[2],
        }}
      >
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
        <button
          type="button"
          onClick={onExplore}
          aria-label="Explore tags"
          style={{
            marginLeft: 'auto',
            padding: '6px 10px',
            borderRadius: theme.radius.md,
            border: `1px solid ${theme.color.border.DEFAULT}`,
            background: theme.color.bg.elevated,
            color: theme.color.text.DEFAULT,
            cursor: 'pointer',
            font: 'inherit',
          }}
        >
          Explore tags →
        </button>
      </div>
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
