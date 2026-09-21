import { DescriptionList, Stack, Text } from '@themoltnet/design-system';
import type { ComponentType } from 'react';

import { FreeformArtifactList } from './freeform-artifact-list.js';
import { readFreeformOutput, readOutputSummary } from './task-output.js';
import type { TaskAttemptSummary, TaskSummary } from './types.js';

export interface TaskOutputRenderContext {
  task: TaskSummary;
  attempt: TaskAttemptSummary;
  output: Record<string, unknown>;
  /** Shorten long identifiers (presentation surfaces). */
  compactIdentifiers: boolean;
}

/**
 * Presents one family of task outputs inside the accepted-result panel.
 *
 * The panel owns everything common to every task type — acceptance state,
 * `output.verification`, and the evidence disclosure. A renderer only
 * decides whether it understands the output, what its one-paragraph lead
 * is, and what goes beneath it. Register renderers in order; the first
 * match wins and `genericOutputRenderer` catches everything else.
 */
export interface TaskOutputRenderer {
  id: string;
  matches: (context: TaskOutputRenderContext) => boolean;
  /** The result's lead paragraph, or null when the output carries none. */
  summary: (context: TaskOutputRenderContext) => string | null;
  Body: ComponentType<TaskOutputRenderContext>;
}

function FreeformOutputBody({
  output,
  compactIdentifiers,
}: TaskOutputRenderContext) {
  const freeform = readFreeformOutput(output);
  if (!freeform) return null;

  return (
    <Stack gap={5}>
      <Stack gap={4}>
        <Text as="h3" variant="caption" weight="semibold" color="secondary">
          What the agent produced
        </Text>
        {freeform.artifacts.length > 0 ? (
          <FreeformArtifactList
            artifacts={freeform.artifacts}
            compactIdentifiers={compactIdentifiers}
          />
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

export const freeformOutputRenderer: TaskOutputRenderer = {
  id: 'freeform',
  matches: ({ task, output }) =>
    task.taskType === 'freeform' && readFreeformOutput(output) !== null,
  summary: ({ output }) => readFreeformOutput(output)?.summary ?? null,
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
  const text =
    typeof value === 'string'
      ? value
      : typeof value === 'number' || typeof value === 'boolean'
        ? String(value)
        : JSON.stringify(value);
  return text.length > 160 ? `${text.slice(0, 157)}…` : text;
}

function GenericOutputBody({ task, output }: TaskOutputRenderContext) {
  const fields = Object.entries(output).filter(
    ([key]) => !SKIPPED_FIELDS.has(key),
  );

  return (
    <Stack gap={3}>
      <Text color="secondary" style={{ maxWidth: '72ch' }}>
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

export const genericOutputRenderer: TaskOutputRenderer = {
  id: 'generic',
  matches: () => true,
  summary: ({ output }) => readOutputSummary(output),
  Body: GenericOutputBody,
};

export const defaultTaskOutputRenderers: readonly TaskOutputRenderer[] = [
  freeformOutputRenderer,
];

export function resolveTaskOutputRenderer(
  context: TaskOutputRenderContext,
  renderers: readonly TaskOutputRenderer[] = defaultTaskOutputRenderers,
): TaskOutputRenderer {
  return (
    renderers.find((renderer) => renderer.matches(context)) ??
    genericOutputRenderer
  );
}
