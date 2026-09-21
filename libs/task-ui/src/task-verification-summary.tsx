import { Disclosure, Stack, Text, useTheme } from '@themoltnet/design-system';

import { humanizeToken } from './format.js';
import { MEASURE, SectionLabel } from './layout.js';
import {
  summarizeVerification,
  type VerificationResultStatus,
  type VerificationView,
} from './task-output.js';

export interface TaskVerificationSummaryProps {
  verification: VerificationView | null;
  /** Whether the task input declared `successCriteria`. */
  criteriaDeclared: boolean;
}

const STATUS_META: Record<
  VerificationResultStatus,
  { glyph: string; label: string; tone: 'success' | 'error' | 'muted' }
> = {
  pass: { glyph: '✓', label: 'Passed', tone: 'success' },
  fail: { glyph: '✕', label: 'Failed', tone: 'error' },
  skip: { glyph: '–', label: 'Skipped', tone: 'muted' },
};

/**
 * The producing agent's self-check against the task's success criteria.
 *
 * Worded as a self-assessment on purpose: `output.verification` is advisory,
 * never gates completion, and is not the binding judgement a separate
 * judgment task would give.
 */
export function TaskVerificationSummary({
  verification,
  criteriaDeclared,
}: TaskVerificationSummaryProps) {
  const theme = useTheme();
  const label = <SectionLabel>Agent self-check</SectionLabel>;

  if (!verification) {
    return (
      <Stack gap={1}>
        {label}
        <Text variant="caption" color="muted">
          {criteriaDeclared
            ? 'The output has no self-check record.'
            : 'None: the task set no success criteria to check against.'}
        </Text>
      </Stack>
    );
  }

  const counts = summarizeVerification(verification);
  const tone = verification.passed
    ? theme.color.success.DEFAULT
    : theme.color.error.DEFAULT;
  const headline = verification.passed
    ? counts.skip > 0
      ? `${counts.pass} of ${counts.total} checks passed, ${counts.skip} skipped`
      : `${counts.pass} of ${counts.total} checks passed`
    : `${counts.fail} of ${counts.total} ${counts.fail === 1 ? 'check' : 'checks'} failed`;

  return (
    <Stack gap={2}>
      <Stack gap={1}>
        {label}
        <Stack direction="row" gap={2} align="baseline" wrap>
          <span
            aria-hidden="true"
            style={{ color: tone, fontWeight: theme.font.weight.bold }}
          >
            {verification.passed ? '✓' : '✕'}
          </span>
          <Text weight="medium" style={{ color: tone }}>
            {headline}
          </Text>
        </Stack>
        <Text variant="caption" color="muted" style={{ maxWidth: MEASURE }}>
          Reported by the agent against the task’s success criteria. Advisory:
          it does not decide acceptance and is not an independent review.
        </Text>
      </Stack>

      {verification.results.length > 0 ? (
        <Disclosure summary="Show checks" hint={`${counts.total} recorded`}>
          <ul
            aria-label="Self-check results"
            style={{
              listStyle: 'none',
              margin: 0,
              padding: 0,
              display: 'grid',
              gap: theme.spacing[2],
            }}
          >
            {verification.results.map((result) => {
              const meta = STATUS_META[result.status];
              const color =
                meta.tone === 'muted'
                  ? theme.color.text.muted
                  : theme.color[meta.tone].DEFAULT;
              return (
                <li
                  key={result.id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1.25rem minmax(0, 1fr)',
                    gap: theme.spacing[2],
                    alignItems: 'baseline',
                  }}
                >
                  <span aria-hidden="true" style={{ color }}>
                    {meta.glyph}
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <Text
                      as="span"
                      variant="caption"
                      mono
                      style={{ overflowWrap: 'anywhere' }}
                    >
                      {result.id}
                    </Text>
                    <Text as="span" variant="caption" color="muted">
                      {' · '}
                      {humanizeToken(result.kind)} · {meta.label}
                    </Text>
                    {result.detail ? (
                      <Text
                        as="span"
                        variant="caption"
                        color="secondary"
                        style={{ display: 'block' }}
                      >
                        {result.detail}
                      </Text>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        </Disclosure>
      ) : null}
    </Stack>
  );
}
