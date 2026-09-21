import { DescriptionList, Stack, Text } from '@themoltnet/design-system';
import type { ComponentType } from 'react';

import { FreeformArtifactList } from './freeform-artifact-list.js';
import { MEASURE, SectionLabel } from './layout.js';
import { readFreeformOutput } from './task-output.js';
import type { TaskAttemptSummary, TaskSummary } from './types.js';

export interface TaskOutputRenderContext {
  task: TaskSummary;
  attempt: TaskAttemptSummary;
  output: Record<string, unknown>;
}

/**
 * Presents one family of task outputs inside the accepted-result panel.
 *
 * The panel owns everything common to every task type: acceptance state,
 * the `summary` lead paragraph, `output.verification`, and the evidence
 * disclosure. A renderer only decides whether it understands the output and
 * what goes beneath the summary. Host renderers are tried first, then the
 * built-in ones; the generic view catches everything else.
 */
export interface TaskOutputRenderer {
  matches: (context: TaskOutputRenderContext) => boolean;
  Body: ComponentType<TaskOutputRenderContext>;
}

function FreeformOutputBody({ output }: TaskOutputRenderContext) {
  const freeform = readFreeformOutput(output);
  if (!freeform) return null;

  return (
    <Stack gap={5}>
      <Stack gap={4}>
        <SectionLabel>What the agent produced</SectionLabel>
        {freeform.artifacts.length > 0 ? (
          <FreeformArtifactList artifacts={freeform.artifacts} />
        ) : (
          <Text color="secondary">
            No artifacts were attached. The summary above is the whole result.
          </Text>
        )}
      </Stack>

      {freeform.branch || freeform.proposedTaskType ? (
        <DescriptionList
          columns={2}
          compact
          items={[
            ...(freeform.branch
              ? [{ label: 'Branch', value: freeform.branch, mono: true }]
              : []),
            ...(freeform.proposedTaskType
              ? [
                  {
                    label: 'Proposed task type',
                    value: `${freeform.proposedTaskType.name} — ${freeform.proposedTaskType.rationale}`,
                  },
                ]
              : []),
          ]}
        />
      ) : null}
    </Stack>
  );
}

const freeformOutputRenderer: TaskOutputRenderer = {
  matches: ({ task, output }) =>
    task.taskType === 'freeform' && readFreeformOutput(output) !== null,
  Body: FreeformOutputBody,
};

const SKIPPED_FIELDS = new Set(['summary', 'verification']);

function describeValue(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    return value.length === 1 ? '1 item' : `${value.length} items`;
  }
  if (typeof value === 'object') {
    const count = Object.keys(value).length;
    return count === 1 ? '1 field' : `${count} fields`;
  }
  const text = String(value as string | number | boolean);
  return text.length > 160 ? `${text.slice(0, 157)}…` : text;
}

function GenericOutputBody({ task, output }: TaskOutputRenderContext) {
  const fields = Object.entries(output).filter(
    ([key]) => !SKIPPED_FIELDS.has(key),
  );

  return (
    <Stack gap={3}>
      <Text color="secondary" style={{ maxWidth: MEASURE }}>
        The Console has no dedicated view for{' '}
        <Text as="span" mono>
          {task.taskType}
        </Text>{' '}
        output yet. Its top-level fields are listed here; the complete output is
        under Evidence.
      </Text>
      {fields.length > 0 ? (
        <DescriptionList
          columns={2}
          compact
          ariaLabel="Output fields"
          items={fields.slice(0, 12).map(([key, value]) => ({
            label: key,
            value: describeValue(value),
            mono: typeof value !== 'string' || value.length < 64,
          }))}
        />
      ) : (
        <Text color="muted">The output has no fields.</Text>
      )}
      {fields.length > 12 ? (
        <Text variant="caption" color="muted">
          {fields.length - 12} more fields are in the raw output.
        </Text>
      ) : null}
    </Stack>
  );
}

const genericOutputRenderer: TaskOutputRenderer = {
  matches: () => true,
  Body: GenericOutputBody,
};

const BUILT_IN_RENDERERS: readonly TaskOutputRenderer[] = [
  freeformOutputRenderer,
];

/** Host renderers first, then built-ins, then the generic view. */
export function resolveTaskOutputRenderer(
  context: TaskOutputRenderContext,
  renderers: readonly TaskOutputRenderer[] = [],
): TaskOutputRenderer {
  return (
    [...renderers, ...BUILT_IN_RENDERERS].find((renderer) =>
      renderer.matches(context),
    ) ?? genericOutputRenderer
  );
}
