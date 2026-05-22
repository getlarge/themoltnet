import { useTheme } from '@themoltnet/design-system';

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
        <div style={{ display: 'grid', gap: theme.spacing[2] }}>
          {FIELDS.map((field) => (
            <label key={field} style={{ display: 'grid', gap: 4 }}>
              <span style={{ textTransform: 'capitalize' }}>
                {field}: {current[field].toFixed(2)}
              </span>
              <input
                type="range"
                min={0}
                max={2}
                step={0.1}
                value={current[field]}
                onChange={(event) => patch(field, Number(event.target.value))}
                aria-label={`${field} weight`}
              />
            </label>
          ))}
          <button
            type="button"
            onClick={() => onChange(null)}
            style={{
              padding: '6px 8px',
              borderRadius: theme.radius.sm,
              border: `1px solid ${theme.color.border.DEFAULT}`,
              background: theme.color.bg.surface,
              color: theme.color.text.DEFAULT,
              cursor: 'pointer',
              font: 'inherit',
            }}
          >
            Reset to defaults
          </button>
        </div>
      )}
    </Popover>
  );
}
