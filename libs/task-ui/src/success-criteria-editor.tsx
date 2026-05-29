import {
  Button,
  Input,
  Stack,
  Text,
  useTheme,
} from '@themoltnet/design-system';

import {
  ASSERTION_OPS,
  type AssertionOp,
  type AssertionRow,
  opUsesMax,
  opUsesValue,
  type SideEffectsForm,
} from './success-criteria.js';

export interface SuccessCriteriaEditorProps {
  assertions: AssertionRow[];
  onAssertionsChange: (rows: AssertionRow[]) => void;
  sideEffects: SideEffectsForm;
  onSideEffectsChange: (next: SideEffectsForm) => void;
}

const VALUE_PLACEHOLDER: Record<AssertionOp, string> = {
  exists: '',
  equals: 'expected value',
  matches: 'regex source (no flags)',
  'in-range': 'min',
  'min-length': 'minimum length',
};

export function SuccessCriteriaEditor({
  assertions,
  onAssertionsChange,
  sideEffects,
  onSideEffectsChange,
}: SuccessCriteriaEditorProps) {
  const theme = useTheme();

  function updateRow(index: number, patch: Partial<AssertionRow>) {
    onAssertionsChange(
      assertions.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  }
  function addRow() {
    onAssertionsChange([...assertions, { path: '', op: 'exists', value: '' }]);
  }
  function removeRow(index: number) {
    onAssertionsChange(assertions.filter((_, i) => i !== index));
  }

  const fieldStyle: React.CSSProperties = {
    padding: `${theme.spacing[2]} ${theme.spacing[3]}`,
    borderRadius: theme.radius.md,
    border: `1px solid ${theme.color.border.DEFAULT}`,
    background: theme.color.bg.surface,
    color: theme.color.text.DEFAULT,
    fontFamily: theme.font.family.sans,
    fontSize: theme.font.size.sm,
  };

  const tagsValue = sideEffects.diaryEntryTags.join(', ');

  return (
    <Stack gap={3}>
      {/* Assertions */}
      <Stack gap={2}>
        <Text variant="caption" color="muted">
          Assertions (optional) — checks run against the task output. Path is
          dotted; <code>*</code> expands arrays (e.g. <code>commits.*.sha</code>
          ).
        </Text>
        {assertions.map((row, index) => (
          <Stack key={index} direction="row" gap={2} align="center" wrap>
            <input
              aria-label="Assertion path"
              value={row.path}
              placeholder="output path"
              onChange={(event) =>
                updateRow(index, { path: event.target.value })
              }
              style={{ ...fieldStyle, flex: 1, minWidth: 140 }}
            />
            <select
              aria-label="Assertion op"
              value={row.op}
              onChange={(event) =>
                updateRow(index, { op: event.target.value as AssertionOp })
              }
              style={fieldStyle}
            >
              {ASSERTION_OPS.map((op) => (
                <option key={op} value={op}>
                  {op}
                </option>
              ))}
            </select>
            {opUsesValue(row.op) ? (
              <input
                aria-label="Assertion value"
                value={row.value}
                placeholder={VALUE_PLACEHOLDER[row.op]}
                onChange={(event) =>
                  updateRow(index, { value: event.target.value })
                }
                style={{ ...fieldStyle, width: 130 }}
              />
            ) : null}
            {opUsesMax(row.op) ? (
              <input
                aria-label="Assertion max"
                value={row.max ?? ''}
                placeholder="max"
                onChange={(event) =>
                  updateRow(index, { max: event.target.value })
                }
                style={{ ...fieldStyle, width: 90 }}
              />
            ) : null}
            <Button variant="ghost" size="sm" onClick={() => removeRow(index)}>
              Remove
            </Button>
          </Stack>
        ))}
        <Button variant="secondary" size="sm" onClick={addRow}>
          + Add assertion
        </Button>
      </Stack>

      {/* Side effects */}
      <Stack gap={2}>
        <Text variant="caption" color="muted">
          Side effects (optional)
        </Text>
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: theme.spacing[2],
            fontSize: theme.font.size.sm,
            color: theme.color.text.DEFAULT,
          }}
        >
          <input
            type="checkbox"
            checked={sideEffects.diaryEntryRequired}
            onChange={(event) =>
              onSideEffectsChange({
                ...sideEffects,
                diaryEntryRequired: event.target.checked,
              })
            }
          />
          Require a diary entry
        </label>
        <Input
          label="Required diary tags (comma-separated)"
          value={tagsValue}
          placeholder="decision, incident"
          onChange={(event) =>
            onSideEffectsChange({
              ...sideEffects,
              diaryEntryTags: event.target.value
                .split(',')
                .map((tag) => tag.trim())
                .filter((tag) => tag.length > 0),
            })
          }
        />
        <Input
          label="Minimum referenced entries"
          value={sideEffects.referencedEntries}
          placeholder="0"
          inputMode="numeric"
          onChange={(event) =>
            onSideEffectsChange({
              ...sideEffects,
              referencedEntries: event.target.value,
            })
          }
        />
      </Stack>
    </Stack>
  );
}
