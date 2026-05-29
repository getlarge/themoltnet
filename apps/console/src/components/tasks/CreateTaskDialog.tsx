import { createTask } from '@moltnet/api-client';
import type { TaskSummary } from '@moltnet/task-ui';
import {
  Button,
  Dialog,
  Input,
  Stack,
  Text,
  useTheme,
} from '@themoltnet/design-system';
import { useState } from 'react';

import { getApiClient } from '../../api.js';
import {
  buildClaimCondition,
  type DependsRow,
} from '../../tasks/claim-condition.js';
import { DependsOnBuilder } from './DependsOnBuilder.js';

export interface DiaryOption {
  id: string;
  name: string;
}

export interface CreateTaskDialogProps {
  open: boolean;
  teamId: string;
  diaries: DiaryOption[];
  candidateTasks: TaskSummary[];
  onClose: () => void;
  onCreated: (taskId: string) => void;
}

export function CreateTaskDialog({
  open,
  teamId,
  diaries,
  candidateTasks,
  onClose,
  onCreated,
}: CreateTaskDialogProps) {
  const theme = useTheme();
  const [brief, setBrief] = useState('');
  const [title, setTitle] = useState('');
  const [expectedOutput, setExpectedOutput] = useState('');
  const [diaryId, setDiaryId] = useState(diaries[0]?.id ?? '');
  const [dependsRows, setDependsRows] = useState<DependsRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const canSubmit = Boolean(brief.trim() && diaryId);

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const { data, error: apiError } = await createTask({
        client: getApiClient(),
        body: {
          teamId,
          diaryId,
          taskType: 'freeform',
          input: {
            brief: brief.trim(),
            ...(title.trim() ? { title: title.trim() } : {}),
            ...(expectedOutput.trim()
              ? { expectedOutput: expectedOutput.trim() }
              : {}),
          },
          claimCondition: buildClaimCondition(dependsRows),
        },
      });
      if (apiError) {
        setError(
          typeof apiError === 'object' && apiError && 'detail' in apiError
            ? String((apiError as { detail?: unknown }).detail)
            : 'Failed to create task',
        );
        return;
      }
      if (data && 'id' in data) {
        setBrief('');
        setTitle('');
        setExpectedOutput('');
        setDependsRows([]);
        onCreated(data.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create task');
    } finally {
      setIsSubmitting(false);
    }
  };

  const textareaStyle: React.CSSProperties = {
    width: '100%',
    padding: `${theme.spacing[3]} ${theme.spacing[4]}`,
    borderRadius: theme.radius.md,
    border: `1px solid ${theme.color.border.DEFAULT}`,
    background: theme.color.bg.surface,
    color: theme.color.text.DEFAULT,
    fontFamily: theme.font.family.sans,
    fontSize: theme.font.size.sm,
    minHeight: 80,
    resize: 'vertical',
  };
  const selectStyle: React.CSSProperties = {
    width: '100%',
    padding: `${theme.spacing[2]} ${theme.spacing[3]}`,
    borderRadius: theme.radius.md,
    border: `1px solid ${theme.color.border.DEFAULT}`,
    background: theme.color.bg.surface,
    color: theme.color.text.DEFAULT,
    fontSize: theme.font.size.sm,
  };
  const labelCaption = (text: string, required = false): React.ReactNode => (
    <Text variant="caption" color="muted">
      {text}
      {required ? (
        <span style={{ color: theme.color.accent.DEFAULT }}> *</span>
      ) : null}
    </Text>
  );

  return (
    <Dialog open={open} onClose={onClose} title="New task" width="520px">
      <Stack gap={4}>
        <Stack gap={1}>
          {labelCaption('Brief', true)}
          <textarea
            aria-label="Brief"
            value={brief}
            onChange={(event) => setBrief(event.target.value)}
            placeholder="Describe the work to be done…"
            style={textareaStyle}
          />
        </Stack>

        <Input
          label="Title (optional)"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Short label"
        />

        <Stack gap={1}>
          {labelCaption('Expected output (optional)')}
          <textarea
            aria-label="Expected output"
            value={expectedOutput}
            onChange={(event) => setExpectedOutput(event.target.value)}
            placeholder="What should the result look like?"
            style={textareaStyle}
          />
        </Stack>

        <Stack gap={1}>
          {labelCaption('Diary', true)}
          <select
            aria-label="Diary"
            value={diaryId}
            onChange={(event) => setDiaryId(event.target.value)}
            style={selectStyle}
          >
            {diaries.length === 0 ? (
              <option value="">No diaries in this team</option>
            ) : (
              diaries.map((diary) => (
                <option key={diary.id} value={diary.id}>
                  {diary.name}
                </option>
              ))
            )}
          </select>
        </Stack>

        <DependsOnBuilder
          candidates={candidateTasks}
          rows={dependsRows}
          onChange={setDependsRows}
        />

        {error ? (
          <Text variant="caption" style={{ color: theme.color.error.DEFAULT }}>
            {error}
          </Text>
        ) : null}

        <Stack direction="row" gap={3} justify="flex-end">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => void handleSubmit()}
            disabled={!canSubmit || isSubmitting}
          >
            {isSubmitting ? 'Creating…' : 'Create task'}
          </Button>
        </Stack>
      </Stack>
    </Dialog>
  );
}
