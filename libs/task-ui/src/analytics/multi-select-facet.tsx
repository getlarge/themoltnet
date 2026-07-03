import { Stack, Text, useTheme } from '@themoltnet/design-system';
import { useEffect, useRef, useState } from 'react';

import type { AnalyticsFilterOption } from './types.js';

export interface MultiSelectFacetProps {
  label: string;
  options: AnalyticsFilterOption[];
  selected: string[];
  onChange: (next: string[]) => void;
}

/**
 * A generic multi-select dropdown facet (value/label options). Mirrors the
 * a11y idiom of `TaskTypeFacet`: a `haspopup` trigger with a selected-count
 * badge and a `listbox` of `option` buttons.
 */
export function MultiSelectFacet({
  label,
  options,
  selected,
  onChange,
}: MultiSelectFacetProps) {
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

  function toggle(value: string) {
    onChange(
      selected.includes(value)
        ? selected.filter((other) => other !== value)
        : [...selected, value],
    );
  }

  return (
    <div ref={rootRef} style={{ position: 'relative', display: 'inline-block' }}>
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
            maxHeight: 320,
            overflowY: 'auto',
            padding: theme.spacing[3],
            borderRadius: theme.radius.md,
            border: `1px solid ${theme.color.border.DEFAULT}`,
            background: theme.color.bg.surface,
            boxShadow: theme.shadow.md,
          }}
        >
          <Stack gap={2}>
            {options.length === 0 ? (
              <Text variant="caption" color="muted">
                No options
              </Text>
            ) : (
              options.map((option) => {
                const active = selected.includes(option.value);
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="option"
                    aria-selected={active}
                    aria-label={option.label}
                    onClick={() => toggle(option.value)}
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
                    {option.label}
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
