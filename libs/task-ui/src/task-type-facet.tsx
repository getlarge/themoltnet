import { Stack, Text, useTheme } from '@themoltnet/design-system';
import { useEffect, useRef, useState } from 'react';

import { humanizeToken } from './format.js';

export interface TaskTypeFacetProps {
  /** Registered task-type names (resolved by the app, e.g. via listTaskSchemas). */
  availableTypes: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  /** Trigger label. Defaults to "Type". */
  label?: string;
}

export function TaskTypeFacet({
  availableTypes,
  selected,
  onChange,
  label = 'Type',
}: TaskTypeFacetProps) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  function toggle(type: string) {
    onChange(
      selected.includes(type)
        ? selected.filter((other) => other !== type)
        : [...selected, type],
    );
  }

  return (
    <div
      ref={rootRef}
      style={{ position: 'relative', display: 'inline-block' }}
    >
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((value) => !value)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: `${theme.spacing[2]} ${theme.spacing[3]}`,
          borderRadius: theme.radius.md,
          border: `1px solid ${
            selected.length
              ? theme.color.primary.DEFAULT
              : theme.color.border.DEFAULT
          }`,
          background: theme.color.bg.surface,
          color: theme.color.text.DEFAULT,
          font: 'inherit',
          fontSize: theme.font.size.sm,
          cursor: 'pointer',
        }}
      >
        {label}
        {selected.length > 0 ? (
          <span
            aria-hidden="true"
            style={{
              minWidth: 18,
              padding: '0 6px',
              borderRadius: 9999,
              background: theme.color.primary.muted,
              color: theme.color.primary.DEFAULT,
              fontSize: theme.font.size.xs,
              textAlign: 'center',
            }}
          >
            {selected.length}
          </span>
        ) : null}
      </button>
      {open ? (
        <div
          role="listbox"
          aria-label={`${label} options`}
          style={{
            position: 'absolute',
            zIndex: 20,
            marginTop: theme.spacing[1],
            minWidth: 220,
            padding: theme.spacing[3],
            borderRadius: theme.radius.md,
            border: `1px solid ${theme.color.border.DEFAULT}`,
            background: theme.color.bg.surface,
            boxShadow: theme.shadow.md,
          }}
        >
          <Stack gap={2}>
            <Text variant="overline" color="muted">
              Task type
            </Text>
            {availableTypes.length === 0 ? (
              <Text variant="caption" color="muted">
                No task types
              </Text>
            ) : (
              availableTypes.map((type) => {
                const active = selected.includes(type);
                return (
                  <button
                    key={type}
                    type="button"
                    role="option"
                    aria-selected={active}
                    aria-label={humanizeToken(type)}
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
                      font: 'inherit',
                      fontSize: theme.font.size.sm,
                      textAlign: 'left',
                      cursor: 'pointer',
                    }}
                  >
                    {humanizeToken(type)}
                  </button>
                );
              })
            )}
          </Stack>
        </div>
      ) : null}
    </div>
  );
}
