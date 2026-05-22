import { useTheme } from '@themoltnet/design-system';

import type { DiaryFilterState, EntryType } from '../types.js';
import { ensureChipKeyframes } from './chip-keyframes.js';

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
          label="Query"
          value={state.q}
          ariaLabel="Remove query filter"
          onRemove={removeQuery}
        />
      )}
      {state.tags.map((tag) => (
        <Chip
          key={`t-${tag}`}
          label="Tag"
          value={tag}
          ariaLabel={`Remove tag: ${tag}`}
          onRemove={() => removeTag(tag)}
        />
      ))}
      {state.excludeTags.map((tag) => (
        <Chip
          key={`e-${tag}`}
          label="Exclude"
          value={tag}
          tone="danger"
          ariaLabel={`Remove exclude: ${tag}`}
          onRemove={() => removeExcluded(tag)}
        />
      ))}
      {state.types.map((type) => (
        <Chip
          key={`ty-${type}`}
          label="Type"
          value={type}
          ariaLabel={`Remove type: ${type}`}
          onRemove={() => removeType(type)}
        />
      ))}
      <button
        type="button"
        onClick={onClear}
        aria-label="Clear all filters"
        style={{
          padding: '2px 8px',
          borderRadius: theme.radius.full,
          border: `1px dashed ${theme.color.border.DEFAULT}`,
          background: 'transparent',
          color: theme.color.text.muted,
          cursor: 'pointer',
          font: 'inherit',
          fontSize: '0.75rem',
          letterSpacing: '0.04em',
        }}
      >
        Clear all
      </button>
    </div>
  );
}

function Chip({
  label,
  value,
  ariaLabel,
  onRemove,
  tone = 'default',
}: {
  label: string;
  value: string;
  ariaLabel: string;
  onRemove: () => void;
  tone?: 'default' | 'danger';
}) {
  ensureChipKeyframes();
  const theme = useTheme();
  const isDanger = tone === 'danger';
  const fg = isDanger ? theme.color.error.DEFAULT : theme.color.primary.DEFAULT;
  const bg = isDanger
    ? `${theme.color.error.DEFAULT}1f`
    : theme.color.primary.muted;
  return (
    <span
      className="diary-ui-chip"
      role="listitem"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '3px 4px 3px 10px',
        borderRadius: theme.radius.full,
        background: bg,
        color: fg,
        fontSize: 12,
        lineHeight: 1.4,
        border: `1px solid ${isDanger ? `${theme.color.error.DEFAULT}55` : 'transparent'}`,
      }}
    >
      <span
        style={{
          textTransform: 'uppercase',
          fontSize: 10,
          letterSpacing: '0.08em',
          opacity: 0.7,
          fontWeight: 600,
        }}
      >
        {label}
      </span>
      <span style={{ fontFamily: theme.font.family.mono }}>{value}</span>
      <button
        type="button"
        aria-label={ariaLabel}
        onClick={onRemove}
        style={{
          width: 18,
          height: 18,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: theme.radius.full,
          background: 'transparent',
          border: 0,
          color: 'inherit',
          opacity: 0.7,
          cursor: 'pointer',
          padding: 0,
          font: 'inherit',
          fontSize: 14,
          lineHeight: 1,
          transition: `background ${theme.transition.fast}, opacity ${theme.transition.fast}`,
        }}
      >
        ×
      </button>
    </span>
  );
}
