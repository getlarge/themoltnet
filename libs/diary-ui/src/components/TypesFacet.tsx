import { useTheme } from '@themoltnet/design-system';

import { ENTRY_TYPE_LABELS, ENTRY_TYPES, type EntryType } from '../types.js';
import { Popover } from './Popover.js';

export interface TypesFacetProps {
  selected: EntryType[];
  onChange: (next: EntryType[]) => void;
}

export function TypesFacet({ selected, onChange }: TypesFacetProps) {
  const theme = useTheme();

  function toggle(type: EntryType) {
    onChange(
      selected.includes(type)
        ? selected.filter((other) => other !== type)
        : [...selected, type],
    );
  }

  return (
    <Popover label="Types" ariaLabel="Types filter" badge={selected.length}>
      {() => (
        <div style={{ display: 'grid', gap: theme.spacing[2] }}>
          {ENTRY_TYPES.map((type) => {
            const active = selected.includes(type);
            return (
              <button
                key={type}
                type="button"
                aria-pressed={active}
                aria-label={`Filter by type: ${ENTRY_TYPE_LABELS[type]}`}
                onClick={() => toggle(type)}
                style={{
                  padding: '6px 10px',
                  borderRadius: theme.radius.sm,
                  border: `1px solid ${
                    active
                      ? theme.color.primary.DEFAULT
                      : theme.color.border.DEFAULT
                  }`,
                  background: active
                    ? theme.color.primary.muted
                    : theme.color.bg.surface,
                  color: theme.color.text.DEFAULT,
                  cursor: 'pointer',
                  textAlign: 'left',
                  font: 'inherit',
                }}
              >
                {ENTRY_TYPE_LABELS[type]}
              </button>
            );
          })}
        </div>
      )}
    </Popover>
  );
}
