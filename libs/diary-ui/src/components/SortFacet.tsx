import { Button, Stack, Text, useTheme } from '@themoltnet/design-system';

import { DEFAULT_WEIGHTS, type DiaryFilterWeights } from '../types.js';
import { Popover } from './Popover.js';

export interface SortFacetProps {
  weights: DiaryFilterWeights | null;
  disabled: boolean;
  onChange: (next: DiaryFilterWeights | null) => void;
}

const FIELDS = ['relevance', 'recency', 'importance'] as const;

export function SortFacet({ weights, disabled, onChange }: SortFacetProps) {
  const theme = useTheme();
  const current = weights ?? DEFAULT_WEIGHTS;

  function patch(field: keyof DiaryFilterWeights, value: number) {
    onChange({ ...current, [field]: value });
  }

  return (
    <Popover label="Sort" ariaLabel="Result sort weights" disabled={disabled}>
      {() => (
        <Stack gap={3}>
          <Text variant="overline" color="muted">
            Ranking weights
          </Text>
          <Stack gap={3}>
            {FIELDS.map((field) => (
              <label
                key={field}
                style={{ display: 'grid', gap: 6, fontSize: '0.875rem' }}
              >
                <span
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                  }}
                >
                  <span
                    style={{
                      textTransform: 'capitalize',
                      color: theme.color.text.DEFAULT,
                    }}
                  >
                    {field}
                  </span>
                  <Text variant="caption" color="muted" mono>
                    {current[field].toFixed(2)}
                  </Text>
                </span>
                <input
                  type="range"
                  min={0}
                  max={2}
                  step={0.1}
                  value={current[field]}
                  onChange={(event) => patch(field, Number(event.target.value))}
                  aria-label={`${field} weight`}
                  style={{
                    accentColor: theme.color.primary.DEFAULT,
                    width: '100%',
                  }}
                />
              </label>
            ))}
          </Stack>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange(null)}
          >
            Reset to defaults
          </Button>
        </Stack>
      )}
    </Popover>
  );
}
