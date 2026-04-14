import { createDiaryGrant } from '@moltnet/api-client';
import {
  Button,
  Dialog,
  Stack,
  Text,
  useTheme,
} from '@themoltnet/design-system';
import { useMemo, useState } from 'react';

import { getApiClient } from '../../api.js';

export interface GrantTarget {
  id: string;
  type: 'Agent' | 'Human' | 'Group';
  label: string;
}

interface GrantDiaryAccessDialogProps {
  open: boolean;
  onClose: () => void;
  diaryId: string;
  diaryName: string;
  candidates: GrantTarget[];
  onGranted: () => void;
}

export function GrantDiaryAccessDialog({
  open,
  onClose,
  diaryId,
  diaryName,
  candidates,
  onGranted,
}: GrantDiaryAccessDialogProps) {
  const theme = useTheme();
  const [targetKey, setTargetKey] = useState('');
  const [role, setRole] = useState<'writer' | 'manager'>('writer');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const targetByKey = useMemo(() => {
    const map = new Map<string, GrantTarget>();
    candidates.forEach((c) => map.set(`${c.type}:${c.id}`, c));
    return map;
  }, [candidates]);

  const selected = targetByKey.get(targetKey) ?? null;

  const handleClose = () => {
    setTargetKey('');
    setRole('writer');
    setError(null);
    onClose();
  };

  const handleSubmit = async () => {
    if (!selected) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await createDiaryGrant({
        client: getApiClient(),
        path: { id: diaryId },
        body: {
          subjectId: selected.id,
          subjectNs: selected.type,
          role,
        },
      });
      onGranted();
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to grant access');
    } finally {
      setIsSubmitting(false);
    }
  };

  const groupedOptions = useMemo(() => {
    const agents = candidates.filter((c) => c.type === 'Agent');
    const humans = candidates.filter((c) => c.type === 'Human');
    const groups = candidates.filter((c) => c.type === 'Group');
    return { agents, humans, groups };
  }, [candidates]);

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title="Grant Diary Access"
      width="440px"
    >
      <Stack gap={4}>
        <Text variant="caption" color="muted">
          Diary: {diaryName}
        </Text>

        {candidates.length === 0 ? (
          <Text color="muted">
            All team members and groups already have access, or the team has no
            other eligible targets.
          </Text>
        ) : (
          <>
            <div>
              <Text
                variant="caption"
                color="muted"
                style={{
                  display: 'block',
                  marginBottom: theme.spacing[1],
                  textTransform: 'uppercase',
                  letterSpacing: theme.font.letterSpacing.wide,
                  fontWeight: theme.font.weight.medium,
                }}
              >
                Target
              </Text>
              <select
                value={targetKey}
                onChange={(e) => setTargetKey(e.target.value)}
                style={{
                  width: '100%',
                  padding: `${theme.spacing[2]} ${theme.spacing[3]}`,
                  backgroundColor: theme.color.bg.surface,
                  color: theme.color.text.DEFAULT,
                  border: `1px solid ${theme.color.border.DEFAULT}`,
                  borderRadius: theme.radius.sm,
                  fontSize: theme.font.size.sm,
                  fontFamily: 'inherit',
                }}
              >
                <option value="" disabled>
                  Select target...
                </option>
                {groupedOptions.agents.length > 0 && (
                  <optgroup label="Agents">
                    {groupedOptions.agents.map((c) => (
                      <option
                        key={`${c.type}:${c.id}`}
                        value={`${c.type}:${c.id}`}
                      >
                        🤖 {c.label}
                      </option>
                    ))}
                  </optgroup>
                )}
                {groupedOptions.humans.length > 0 && (
                  <optgroup label="Humans">
                    {groupedOptions.humans.map((c) => (
                      <option
                        key={`${c.type}:${c.id}`}
                        value={`${c.type}:${c.id}`}
                      >
                        👤 {c.label}
                      </option>
                    ))}
                  </optgroup>
                )}
                {groupedOptions.groups.length > 0 && (
                  <optgroup label="Groups">
                    {groupedOptions.groups.map((c) => (
                      <option
                        key={`${c.type}:${c.id}`}
                        value={`${c.type}:${c.id}`}
                      >
                        👥 {c.label}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>

            <div>
              <Text
                variant="caption"
                color="muted"
                style={{
                  display: 'block',
                  marginBottom: theme.spacing[1],
                  textTransform: 'uppercase',
                  letterSpacing: theme.font.letterSpacing.wide,
                  fontWeight: theme.font.weight.medium,
                }}
              >
                Role
              </Text>
              <select
                value={role}
                onChange={(e) =>
                  setRole(e.target.value as 'writer' | 'manager')
                }
                style={{
                  width: '100%',
                  padding: `${theme.spacing[2]} ${theme.spacing[3]}`,
                  backgroundColor: theme.color.bg.surface,
                  color: theme.color.text.DEFAULT,
                  border: `1px solid ${theme.color.border.DEFAULT}`,
                  borderRadius: theme.radius.sm,
                  fontSize: theme.font.size.sm,
                  fontFamily: 'inherit',
                }}
              >
                <option value="writer">Writer</option>
                <option value="manager">Manager</option>
              </select>
            </div>
          </>
        )}

        {error && (
          <Text variant="caption" style={{ color: theme.color.error.DEFAULT }}>
            {error}
          </Text>
        )}
        <Stack direction="row" gap={3} justify="flex-end">
          <Button variant="ghost" size="sm" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => void handleSubmit()}
            disabled={!selected || isSubmitting}
          >
            {isSubmitting ? 'Granting...' : 'Grant'}
          </Button>
        </Stack>
      </Stack>
    </Dialog>
  );
}
