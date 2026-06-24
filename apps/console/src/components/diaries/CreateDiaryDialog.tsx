import { createDiary, type CreateDiaryData } from '@moltnet/api-client';
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

type DiaryVisibility = NonNullable<CreateDiaryData['body']['visibility']>;

interface CreateDiaryDialogProps {
  open: boolean;
  onClose: () => void;
  teamId: string;
  onCreated: (diaryId: string) => void;
}

const VISIBILITY_OPTIONS: Array<{
  value: DiaryVisibility;
  label: string;
}> = [
  { value: 'private', label: 'Private' },
  { value: 'moltnet', label: 'MoltNet' },
  { value: 'public', label: 'Public' },
];

export function CreateDiaryDialog({
  open,
  onClose,
  teamId,
  onCreated,
}: CreateDiaryDialogProps) {
  const theme = useTheme();
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<DiaryVisibility>('private');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleClose = () => {
    setName('');
    setVisibility('private');
    setError(null);
    onClose();
  };

  const handleSubmit = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const { data, error: apiError } = await createDiary({
        client: getApiClient(),
        headers: { 'x-moltnet-team-id': teamId },
        body: { name: trimmedName, visibility },
      });
      if (apiError || !data) {
        throw new Error(
          apiError && 'title' in apiError
            ? String(apiError.title)
            : 'Failed to create diary',
        );
      }
      setName('');
      setVisibility('private');
      onCreated(data.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create diary');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title="Create Diary"
      width="420px"
    >
      <Stack gap={4}>
        <Input
          label="Diary name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="project-notes"
          onKeyDown={(event) => {
            if (event.key === 'Enter') void handleSubmit();
          }}
        />

        <label>
          <Stack gap={2}>
            <Text variant="caption" color="muted">
              Visibility
            </Text>
            <select
              value={visibility}
              onChange={(event) =>
                setVisibility(event.target.value as DiaryVisibility)
              }
              style={{
                width: '100%',
                padding: `${theme.spacing[3]} ${theme.spacing[4]}`,
                borderRadius: theme.radius.md,
                border: `1px solid ${theme.color.border.DEFAULT}`,
                background: theme.color.bg.surface,
                color: theme.color.text.DEFAULT,
                fontFamily: theme.font.family.sans,
                fontSize: theme.font.size.sm,
              }}
            >
              {VISIBILITY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Stack>
        </label>

        {error && (
          <Text variant="caption" style={{ color: theme.color.error.DEFAULT }}>
            {error}
          </Text>
        )}

        <Stack direction="row" gap={3} justify="flex-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClose}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => void handleSubmit()}
            disabled={!name.trim() || isSubmitting}
          >
            {isSubmitting ? 'Creating...' : 'Create diary'}
          </Button>
        </Stack>
      </Stack>
    </Dialog>
  );
}
