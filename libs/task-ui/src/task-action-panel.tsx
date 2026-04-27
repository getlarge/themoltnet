import {
  Button,
  Card,
  CopyButton,
  Stack,
  Text,
  useTheme,
} from '@themoltnet/design-system';

import type { TaskAction, TaskAttemptSummary, TaskSummary } from './types.js';

export interface TaskActionPanelProps {
  task: TaskSummary;
  selectedAttempt?: TaskAttemptSummary | null;
  actions?: TaskAction[];
  onAction?: (action: TaskAction) => void;
}

export function getDefaultTaskActions(
  task: TaskSummary,
  selectedAttempt?: TaskAttemptSummary | null,
): TaskAction[] {
  const actions: TaskAction[] = [
    {
      id: 'inspect-task',
      label: 'Inspect task',
      description: 'Ask an agent to retrieve this task.',
      prompt: `@tasks_get id=${task.id}`,
    },
    {
      id: 'list-attempts',
      label: 'List attempts',
      description: 'Ask an agent for the task attempt summary.',
      prompt: `@tasks_attempts_list task_id=${task.id}`,
    },
  ];

  if (selectedAttempt) {
    actions.push({
      id: 'list-messages',
      label: 'Read attempt messages',
      description: 'Ask an agent for the execution stream.',
      prompt: `@tasks_messages_list task_id=${task.id} attempt_n=${selectedAttempt.attemptN}`,
    });
  }

  if (task.consoleUrl) {
    actions.push({
      id: 'open-console',
      label: 'Open full console',
      description: 'Open the durable console task detail page.',
      href: task.consoleUrl,
    });
  }

  return actions;
}

export function TaskActionPanel({
  task,
  selectedAttempt,
  actions = getDefaultTaskActions(task, selectedAttempt),
  onAction,
}: TaskActionPanelProps) {
  const theme = useTheme();

  return (
    <Card variant="outlined" padding="md">
      <Stack gap={3}>
        <Stack gap={1}>
          <Text variant="h4" style={{ margin: 0 }}>
            Agent actions
          </Text>
          <Text color="muted">
            Copy deterministic prompts or hand off to the host wrapper.
          </Text>
        </Stack>

        <Stack gap={2}>
          {actions.map((action) => (
            <div
              key={action.id}
              style={{
                border: `1px solid ${theme.color.border.DEFAULT}`,
                borderRadius: theme.radius.md,
                padding: theme.spacing[3],
              }}
            >
              <Stack gap={2}>
                <Stack
                  direction="row"
                  justify="space-between"
                  align="center"
                  gap={2}
                  wrap
                >
                  <Stack gap={1}>
                    <Text style={{ fontWeight: theme.font.weight.semibold }}>
                      {action.label}
                    </Text>
                    {action.description ? (
                      <Text variant="caption" color="muted">
                        {action.description}
                      </Text>
                    ) : null}
                  </Stack>

                  <Stack direction="row" gap={2} align="center">
                    {action.prompt ? (
                      <CopyButton value={action.prompt} label="Copy" />
                    ) : null}
                    {onAction ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={action.disabled}
                        onClick={() => onAction(action)}
                      >
                        Run
                      </Button>
                    ) : null}
                  </Stack>
                </Stack>

                {action.prompt ? (
                  <Text
                    variant="caption"
                    color="muted"
                    style={{
                      fontFamily: theme.font.family.mono,
                      overflowWrap: 'anywhere',
                    }}
                  >
                    {action.prompt}
                  </Text>
                ) : action.href ? (
                  <Text
                    variant="caption"
                    color="muted"
                    style={{ overflowWrap: 'anywhere' }}
                  >
                    {action.href}
                  </Text>
                ) : null}
              </Stack>
            </div>
          ))}
        </Stack>
      </Stack>
    </Card>
  );
}
