import { useTheme } from '@themoltnet/design-system';

import type { DiaryFilterState, EntryType } from '../types.js';

export interface ActiveFilterChipsProps {
  state: DiaryFilterState;
  onChange: (next: DiaryFilterState) => void;
  onClear: () => void;
}

function isEmpty(state: DiaryFilterState): boolean {
  return (
    state.q === '' &&
    state.tags.length === 0 &&
    state.excludeTags.length === 0 &&
    state.types.length === 0
  );
}

export function ActiveFilterChips({
  state,
  onChange,
  onClear,
}: ActiveFilterChipsProps) {
  const theme = useTheme();
  if (isEmpty(state)) return null;

  function removeTag(tag: string) {
    onChange({ ...state, tags: state.tags.filter((other) => other !== tag) });
  }
  function removeExcluded(tag: string) {
    onChange({
      ...state,
      excludeTags: state.excludeTags.filter((other) => other !== tag),
    });
  }
  function removeType(type: EntryType) {
    onChange({
      ...state,
      types: state.types.filter((other) => other !== type),
    });
  }
  function removeQuery() {
    onChange({ ...state, q: '' });
  }

  return (
    <div
      role="list"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: theme.spacing[2],
        alignItems: 'center',
      }}
    >
      {state.q && (
        <Chip
          label={`Query: ${state.q}`}
          ariaLabel="Remove query filter"
          onRemove={removeQuery}
        />
      )}
      {state.tags.map((tag) => (
        <Chip
          key={`t-${tag}`}
          label={`Tag: ${tag}`}
          ariaLabel={`Remove tag: ${tag}`}
          onRemove={() => removeTag(tag)}
        />
      ))}
      {state.excludeTags.map((tag) => (
        <Chip
          key={`e-${tag}`}
          label={`Exclude: ${tag}`}
          ariaLabel={`Remove exclude: ${tag}`}
          onRemove={() => removeExcluded(tag)}
        />
      ))}
      {state.types.map((type) => (
        <Chip
          key={`ty-${type}`}
          label={`Type: ${type}`}
          ariaLabel={`Remove type: ${type}`}
          onRemove={() => removeType(type)}
        />
      ))}
      <button
        type="button"
        onClick={onClear}
        aria-label="Clear all filters"
        style={{
          padding: '4px 8px',
          borderRadius: theme.radius.sm,
          border: `1px solid ${theme.color.border.DEFAULT}`,
          background: theme.color.bg.surface,
          color: theme.color.text.DEFAULT,
          cursor: 'pointer',
          font: 'inherit',
        }}
      >
        Clear all
      </button>
    </div>
  );
}

function Chip({
  label,
  ariaLabel,
  onRemove,
}: {
  label: string;
  ariaLabel: string;
  onRemove: () => void;
}) {
  const theme = useTheme();
  return (
    <span
      role="listitem"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 8px',
        borderRadius: theme.radius.full,
        background: theme.color.primary.muted,
        color: theme.color.primary.DEFAULT,
        fontSize: 12,
      }}
    >
      {label}
      <button
        type="button"
        aria-label={ariaLabel}
        onClick={onRemove}
        style={{
          background: 'transparent',
          border: 0,
          color: 'inherit',
          cursor: 'pointer',
          padding: 0,
          font: 'inherit',
        }}
      >
        ×
      </button>
    </span>
  );
}
