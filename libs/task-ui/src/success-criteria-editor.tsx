import {
  Button,
  Input,
  Stack,
  Text,
  Tooltip,
  useTheme,
} from '@themoltnet/design-system';
import type { ChangeEvent } from 'react';

import {
  ASSERTION_OPS,
  type AssertionOp,
  type AssertionRow,
  DEFAULT_RUBRIC_CRITERION_DESCRIPTION,
  type EvidenceRequirementsForm,
  getRubricWeightSummary,
  normalizeCriterionId,
  opUsesMax,
  opUsesValue,
  RUBRIC_SCORING_MODES,
  RUBRIC_TEMPLATES,
  type RubricCriterionRow,
  type RubricForm,
} from './success-criteria.js';

export interface SuccessCriteriaEditorProps {
  rubric: RubricForm;
  onRubricChange: (next: RubricForm) => void;
  evidence: EvidenceRequirementsForm;
  onEvidenceChange: (next: EvidenceRequirementsForm) => void;
  docsHref?: string;
}

const VALUE_PLACEHOLDER: Record<AssertionOp, string> = {
  exists: '',
  equals: 'expected value',
  matches: 'regex source (no flags)',
  'in-range': 'min',
  'min-length': 'minimum length',
};

const SCORING_LABELS = {
  boolean: 'Boolean',
  llm_score: '0-1 score',
  llm_checklist: 'Checklist',
} satisfies Record<RubricCriterionRow['scoring'], string>;

const SCORING_HINTS = {
  boolean: 'Pass/fail hard requirement.',
  llm_score: 'Quality gradient from 0 to 1.',
  llm_checklist: 'Judge evaluates multiple concrete claims.',
} satisfies Record<RubricCriterionRow['scoring'], string>;

export function SuccessCriteriaEditor({
  rubric,
  onRubricChange,
  evidence,
  onEvidenceChange,
  docsHref = '/docs/use/agent-executors#self-verification-producer-llm-evaluates-its-own-output',
}: SuccessCriteriaEditorProps) {
  const theme = useTheme();

  function updateEvidenceAssertion(
    index: number,
    patch: Partial<AssertionRow>,
  ) {
    onEvidenceChange({
      ...evidence,
      customAssertions: evidence.customAssertions.map((row, i) =>
        i === index ? { ...row, ...patch } : row,
      ),
    });
  }
  function addEvidenceAssertion() {
    onEvidenceChange({
      ...evidence,
      customAssertions: [
        ...evidence.customAssertions,
        { path: '', op: 'exists', value: '' },
      ],
    });
  }
  function removeEvidenceAssertion(index: number) {
    onEvidenceChange({
      ...evidence,
      customAssertions: evidence.customAssertions.filter((_, i) => i !== index),
    });
  }
  function updateCriterion(index: number, patch: Partial<RubricCriterionRow>) {
    onRubricChange({
      ...rubric,
      criteria: rubric.criteria.map((row, i) =>
        i === index ? { ...row, ...patch } : row,
      ),
    });
  }
  function addCriterion() {
    onRubricChange({
      ...rubric,
      criteria: [
        ...rubric.criteria,
        {
          name: '',
          weightPercent: '',
          scoring: 'llm_score',
          description: DEFAULT_RUBRIC_CRITERION_DESCRIPTION,
        },
      ],
    });
  }
  function removeCriterion(index: number) {
    onRubricChange({
      ...rubric,
      criteria: rubric.criteria.filter((_, i) => i !== index),
    });
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
  const panelStyle: React.CSSProperties = {
    border: `1px solid ${theme.color.border.DEFAULT}`,
    borderRadius: theme.radius.md,
    padding: theme.spacing[3],
    background: theme.color.bg.surface,
  };
  const textareaStyle: React.CSSProperties = {
    ...fieldStyle,
    width: '100%',
    minHeight: 84,
    resize: 'vertical',
  };
  const tagsValue = evidence.diaryEntryTags.join(', ');
  const weightSummary = getRubricWeightSummary(rubric);
  const authoredCriteria = rubric.criteria.filter(
    (criterion) =>
      criterion.name.trim() ||
      criterion.description.trim() ||
      criterion.weightPercent.trim(),
  );

  return (
    <Stack gap={4}>
      <Stack gap={1}>
        <Text variant="caption" color="muted">
          Define how the agent and any later judge should decide whether this
          task was done well.
        </Text>
        <a
          href={docsHref}
          target="_blank"
          rel="noreferrer"
          style={{ color: theme.color.accent.DEFAULT, fontSize: 12 }}
        >
          Self-verification docs
        </a>
      </Stack>

      <Stack gap={3} style={panelStyle}>
        <Stack direction="row" gap={2} align="center" wrap>
          <Text variant="h4">Rubric Builder</Text>
          <Tooltip content="Reusable scoring guide used for producer self-verification and later judge tasks.">
            <button type="button" style={hintStyle(theme)}>
              ?
            </button>
          </Tooltip>
        </Stack>

        <Stack direction="row" gap={2} align="center" wrap>
          <select
            aria-label="Rubric template"
            defaultValue=""
            onChange={(event) => {
              const template = RUBRIC_TEMPLATES.find(
                (candidate) => candidate.id === event.target.value,
              );
              if (template) {
                onRubricChange(structuredClone(template.rubric));
                event.target.value = '';
              }
            }}
            style={fieldStyle}
          >
            <option value="">Clone a starter template</option>
            {RUBRIC_TEMPLATES.map((template) => (
              <option key={template.id} value={template.id}>
                {template.label}
              </option>
            ))}
          </select>
          <Button variant="secondary" size="sm" onClick={addCriterion}>
            + Add criterion
          </Button>
        </Stack>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: theme.spacing[3],
          }}
        >
          <Input
            label="Rubric ID"
            value={rubric.rubricId}
            placeholder="implementation-quality"
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              onRubricChange({ ...rubric, rubricId: event.target.value })
            }
          />
          <Input
            label="Version"
            value={rubric.version}
            placeholder="v1"
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              onRubricChange({ ...rubric, version: event.target.value })
            }
          />
          <Input
            label="Minimum acceptable score (%)"
            value={rubric.minCompositePercent}
            placeholder="85"
            inputMode="decimal"
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              onRubricChange({
                ...rubric,
                minCompositePercent: event.target.value,
              })
            }
          />
        </div>

        <Stack gap={1}>
          <Text variant="caption" color="muted">
            Preamble
          </Text>
          <textarea
            aria-label="Rubric preamble"
            value={rubric.preamble}
            placeholder="Tell the producer and judge what this rubric is trying to protect."
            onChange={(event) =>
              onRubricChange({ ...rubric, preamble: event.target.value })
            }
            style={textareaStyle}
          />
        </Stack>

        {rubric.criteria.map((criterion, index) => (
          <Stack key={index} gap={2} style={panelStyle}>
            <Stack direction="row" gap={2} align="center" wrap>
              <Input
                label="Criterion name"
                value={criterion.name}
                placeholder="implementation_quality"
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  updateCriterion(index, { name: event.target.value })
                }
              />
              <Input
                label="Weight (%)"
                value={criterion.weightPercent}
                placeholder="25"
                inputMode="decimal"
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  updateCriterion(index, {
                    weightPercent: event.target.value,
                  })
                }
              />
              <Stack gap={1}>
                <Text variant="caption" color="muted">
                  Scoring mode
                </Text>
                <select
                  aria-label={`Scoring mode ${index + 1}`}
                  value={criterion.scoring}
                  onChange={(event) =>
                    updateCriterion(index, {
                      scoring: event.target
                        .value as RubricCriterionRow['scoring'],
                    })
                  }
                  style={fieldStyle}
                >
                  {RUBRIC_SCORING_MODES.map((mode) => (
                    <option key={mode} value={mode}>
                      {SCORING_LABELS[mode]}
                    </option>
                  ))}
                </select>
              </Stack>
              <Tooltip content={SCORING_HINTS[criterion.scoring]}>
                <button type="button" style={hintStyle(theme)}>
                  ?
                </button>
              </Tooltip>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => removeCriterion(index)}
              >
                Remove
              </Button>
            </Stack>
            <Text variant="caption" color="muted">
              Payload key: {normalizeCriterionId(criterion.name) || 'unset'}
            </Text>
            <textarea
              aria-label={`Criterion description ${index + 1}`}
              value={criterion.description}
              placeholder={DEFAULT_RUBRIC_CRITERION_DESCRIPTION}
              onChange={(event) =>
                updateCriterion(index, { description: event.target.value })
              }
              style={textareaStyle}
            />
          </Stack>
        ))}

        <Text
          variant="caption"
          style={{
            color: weightSummary.error
              ? theme.color.error.DEFAULT
              : theme.color.text.muted,
          }}
        >
          Weight total: {weightSummary.totalPercent.toFixed(1)}%
          {weightSummary.error ? ` - ${weightSummary.error}` : ''}
        </Text>
      </Stack>

      <Stack gap={3} style={panelStyle}>
        <Stack direction="row" gap={2} align="center" wrap>
          <Text variant="h4">Required Evidence</Text>
          <Tooltip content="Machine-checkable output requirements and process evidence, separate from quality scoring.">
            <button type="button" style={hintStyle(theme)}>
              ?
            </button>
          </Tooltip>
        </Stack>
        <CheckboxRow
          label="Require PR URL"
          checked={evidence.requirePrUrl}
          onChange={(checked) =>
            onEvidenceChange({ ...evidence, requirePrUrl: checked })
          }
        />
        <Input
          label="Require at least N commits"
          value={evidence.minCommits}
          placeholder="1"
          inputMode="numeric"
          onChange={(event: ChangeEvent<HTMLInputElement>) =>
            onEvidenceChange({ ...evidence, minCommits: event.target.value })
          }
        />
        <CheckboxRow
          label="Require diary entry"
          checked={evidence.requireDiaryEntry}
          onChange={(checked) =>
            onEvidenceChange({ ...evidence, requireDiaryEntry: checked })
          }
        />
        <Input
          label="Require diary tags"
          value={tagsValue}
          placeholder="accountable-commit, branch:issue-1347"
          onChange={(event: ChangeEvent<HTMLInputElement>) =>
            onEvidenceChange({
              ...evidence,
              diaryEntryTags: splitTags(event.target.value),
            })
          }
        />
        <Input
          label="Require at least N referenced entries"
          value={evidence.referencedEntries}
          placeholder="1"
          inputMode="numeric"
          onChange={(event: ChangeEvent<HTMLInputElement>) =>
            onEvidenceChange({
              ...evidence,
              referencedEntries: event.target.value,
            })
          }
        />
        <CheckboxRow
          label="Require artifact/output body"
          checked={evidence.requireOutputBody}
          onChange={(checked) =>
            onEvidenceChange({ ...evidence, requireOutputBody: checked })
          }
        />
        <Stack gap={2}>
          <Text variant="caption" color="muted">
            Custom output assertions
          </Text>
          <AssertionRows
            rows={evidence.customAssertions}
            fieldStyle={fieldStyle}
            updateRow={updateEvidenceAssertion}
            removeRow={removeEvidenceAssertion}
          />
          <Button variant="secondary" size="sm" onClick={addEvidenceAssertion}>
            + Add assertion
          </Button>
        </Stack>
      </Stack>

      <Stack gap={1} style={panelStyle}>
        <Text variant="h4">Preview</Text>
        <Text variant="caption" color="muted">
          {previewText({
            criteriaCount: authoredCriteria.length,
            minCompositePercent: rubric.minCompositePercent,
            evidence,
          })}
        </Text>
      </Stack>
    </Stack>
  );
}

function AssertionRows({
  rows,
  fieldStyle,
  updateRow,
  removeRow,
}: {
  rows: AssertionRow[];
  fieldStyle: React.CSSProperties;
  updateRow: (index: number, patch: Partial<AssertionRow>) => void;
  removeRow: (index: number) => void;
}) {
  return (
    <>
      {rows.map((row, index) => (
        <Stack key={index} direction="row" gap={2} align="center" wrap>
          <input
            aria-label="Assertion path"
            value={row.path}
            placeholder="output path"
            onChange={(event) => updateRow(index, { path: event.target.value })}
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
    </>
  );
}

function CheckboxRow({
  label,
  ariaLabel,
  checked,
  onChange,
}: {
  label: string;
  ariaLabel?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const theme = useTheme();
  return (
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
        aria-label={ariaLabel}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      {label}
    </label>
  );
}

function splitTags(value: string): string[] {
  return value
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

function previewText({
  criteriaCount,
  minCompositePercent,
  evidence,
}: {
  criteriaCount: number;
  minCompositePercent: string;
  evidence: EvidenceRequirementsForm;
}) {
  const parts = [
    criteriaCount > 0
      ? `The agent will self-check ${criteriaCount} criteria before completing. A later judge can reuse this rubric.`
      : 'No rubric criteria have been added yet.',
  ];
  if (minCompositePercent.trim()) {
    parts.push(`Minimum acceptable score: ${minCompositePercent.trim()}%.`);
  }
  const requirements: string[] = [];
  if (evidence.requirePrUrl) requirements.push('a PR URL');
  if (evidence.minCommits.trim()) {
    requirements.push(`at least ${evidence.minCommits.trim()} commit(s)`);
  }
  if (evidence.requireDiaryEntry) requirements.push('one diary entry');
  if (evidence.referencedEntries.trim()) {
    requirements.push(
      `at least ${evidence.referencedEntries.trim()} referenced entr${
        evidence.referencedEntries.trim() === '1' ? 'y' : 'ies'
      }`,
    );
  }
  if (evidence.requireOutputBody) requirements.push('an output body');
  if (evidence.customAssertions.length > 0) {
    requirements.push(
      `${evidence.customAssertions.length} custom assertion(s)`,
    );
  }
  if (requirements.length > 0) {
    parts.push(`The output must include ${requirements.join(', ')}.`);
  }
  return parts.join(' ');
}

function hintStyle(theme: ReturnType<typeof useTheme>): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 20,
    height: 20,
    borderRadius: '50%',
    border: `1px solid ${theme.color.border.DEFAULT}`,
    background: theme.color.bg.surface,
    color: theme.color.text.muted,
    fontSize: 12,
    cursor: 'help',
    padding: 0,
  };
}
