import { Stack, Text, useTheme } from '@themoltnet/design-system';

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
        <Stack gap={3}>
          <Text variant="overline" color="muted">
            Entry type
          </Text>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: theme.spacing[2],
            }}
          >
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
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 10px',
                    borderRadius: theme.radius.sm,
                    border: `1px solid ${
                      active
                        ? theme.color.primary.DEFAULT
                        : theme.color.border.DEFAULT
                    }`,
                    background: active
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
                    aria-hidden="true"
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: 999,
                      background: active
                        ? theme.color.primary.DEFAULT
                        : theme.color.border.DEFAULT,
                      flexShrink: 0,
                    }}
                  />
                  {ENTRY_TYPE_LABELS[type]}
                </button>
              );
            })}
          </div>
        </Stack>
      )}
    </Popover>
  );
}
