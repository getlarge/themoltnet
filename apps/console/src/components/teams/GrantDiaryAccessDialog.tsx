import { createDiaryGrant, listDiaryGrants } from '@moltnet/api-client';
import {
  Button,
  Dialog,
  Stack,
  Text,
  useTheme,
} from '@themoltnet/design-system';
import { useEffect, useMemo, useState } from 'react';

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
  const [existingKeys, setExistingKeys] = useState<Set<string>>(new Set());

  // Load current grants when dialog opens so we can filter out already-granted
  // targets for the selected role.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      try {
        const { data } = await listDiaryGrants({
          client: getApiClient(),
          path: { id: diaryId },
        });
        if (cancelled) return;
        const keys = new Set<string>(
          (data?.grants ?? [])
            .filter((g) => g.role === role)
            .map((g) => `${g.subjectNs}:${g.subjectId}`),
        );
        setExistingKeys(keys);
      } catch {
        if (!cancelled) setExistingKeys(new Set());
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, diaryId, role]);

  const filteredCandidates = useMemo(
    () => candidates.filter((c) => !existingKeys.has(`${c.type}:${c.id}`)),
    [candidates, existingKeys],
  );

  const targetByKey = useMemo(() => {
    const map = new Map<string, GrantTarget>();
    filteredCandidates.forEach((c) => map.set(`${c.type}:${c.id}`, c));
    return map;
  }, [filteredCandidates]);

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
    const agents = filteredCandidates.filter((c) => c.type === 'Agent');
    const humans = filteredCandidates.filter((c) => c.type === 'Human');
    const groups = filteredCandidates.filter((c) => c.type === 'Group');
    return { agents, humans, groups };
  }, [filteredCandidates]);

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

        {filteredCandidates.length === 0 ? (
          <Text color="muted">
            All team members and groups already have {role} access, or the team
            has no other eligible targets.
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
                aria-label="Grant target"
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
                aria-label="Grant role"
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
