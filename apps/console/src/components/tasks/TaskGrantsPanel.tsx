import {
  createTaskGrant,
  listTaskGrants,
  type ListTaskGrantsResponses,
  revokeTaskGrant,
} from '@moltnet/api-client';
import {
  Badge,
  Button,
  ConfirmDialog,
  Input,
  Stack,
  Text,
  useTheme,
} from '@themoltnet/design-system';
import { useCallback, useEffect, useState } from 'react';

import { getApiClient } from '../../api.js';

type Grant = ListTaskGrantsResponses[200]['grants'][number];

export function TaskGrantsPanel({
  taskId,
  teamId,
  canManage,
}: {
  taskId: string;
  teamId: string;
  canManage: boolean;
}) {
  const theme = useTheme();
  const [grants, setGrants] = useState<Grant[]>([]);
  const [subjectId, setSubjectId] = useState('');
  const [subjectNs, setSubjectNs] = useState<Grant['subjectNs']>('Agent');
  const [role, setRole] = useState<Grant['role']>('writer');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<Grant | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await listTaskGrants({
        client: getApiClient(),
        headers: { 'x-moltnet-team-id': teamId },
        path: { id: taskId },
      });
      if (!response.data)
        throw new Error('The task grant list was unavailable.');
      setGrants(response.data.grants);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Failed to load task grants.',
      );
    } finally {
      setLoading(false);
    }
  }, [taskId, teamId]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    if (!subjectId.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await createTaskGrant({
        client: getApiClient(),
        headers: { 'x-moltnet-team-id': teamId },
        path: { id: taskId },
        body: { subjectId: subjectId.trim(), subjectNs, role },
      });
      if (!response.data) throw new Error('The task grant was not created.');
      setSubjectId('');
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Failed to create task grant.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  const revoke = async () => {
    if (!revokeTarget || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await revokeTaskGrant({
        client: getApiClient(),
        headers: { 'x-moltnet-team-id': teamId },
        path: { id: taskId },
        body: revokeTarget,
      });
      if (!response.data?.revoked)
        throw new Error('The task grant was not revoked.');
      setRevokeTarget(null);
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Failed to revoke task grant.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Stack gap={4}>
      <Stack gap={1}>
        <Text variant="h3" style={{ margin: 0 }}>
          Task authority
        </Text>
        <Text color="muted">
          Explicit writers can operate this task. Managers can also administer
          its grants.
        </Text>
      </Stack>

      {error && (
        <div role="alert">
          <Stack direction="row" gap={2} align="center">
            <Text
              style={{
                color: theme.color.error.DEFAULT,
                overflowWrap: 'anywhere',
              }}
            >
              {error}
            </Text>
            <Button variant="ghost" size="sm" onClick={() => void load()}>
              Retry
            </Button>
          </Stack>
        </div>
      )}

      {loading ? (
        <Text color="muted">Loading explicit grants…</Text>
      ) : grants.length === 0 ? (
        <Text color="muted">
          No explicit task grants. Owning-team authority still applies.
        </Text>
      ) : (
        <Stack gap={2}>
          {grants.map((grant) => (
            <Stack
              key={`${grant.subjectNs}:${grant.subjectId}:${grant.role}`}
              direction="row"
              gap={3}
              align="center"
              justify="space-between"
              style={{
                minWidth: 0,
                paddingBlock: theme.spacing[2],
                borderBottom: `1px solid ${theme.color.border.DEFAULT}`,
              }}
            >
              <Stack gap={1} style={{ minWidth: 0 }}>
                <Text
                  style={{
                    fontFamily: theme.font.family.mono,
                    overflowWrap: 'anywhere',
                  }}
                >
                  {grant.subjectId}
                </Text>
                <Stack direction="row" gap={2} align="center">
                  <Badge variant="default">{grant.subjectNs}</Badge>
                  <Badge
                    variant={grant.role === 'manager' ? 'warning' : 'default'}
                  >
                    {grant.role}
                  </Badge>
                </Stack>
              </Stack>
              {canManage && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={submitting}
                  onClick={() => setRevokeTarget(grant)}
                >
                  Revoke
                </Button>
              )}
            </Stack>
          ))}
        </Stack>
      )}

      {canManage && (
        <Stack gap={3}>
          <Input
            label="Subject UUID"
            value={subjectId}
            onChange={(event) => setSubjectId(event.target.value)}
            placeholder="Agent, human, or group UUID"
            disabled={submitting}
          />
          <Stack direction="row" gap={3} style={{ flexWrap: 'wrap' }}>
            <label style={{ flex: '1 1 10rem' }}>
              <Text variant="caption" color="muted">
                Subject type
              </Text>
              <select
                aria-label="Subject type"
                value={subjectNs}
                onChange={(event) =>
                  setSubjectNs(event.target.value as Grant['subjectNs'])
                }
                disabled={submitting}
                style={selectStyle(theme)}
              >
                <option value="Agent">Agent</option>
                <option value="Human">Human</option>
                <option value="Group">Group</option>
              </select>
            </label>
            <label style={{ flex: '1 1 10rem' }}>
              <Text variant="caption" color="muted">
                Role
              </Text>
              <select
                aria-label="Task role"
                value={role}
                onChange={(event) =>
                  setRole(event.target.value as Grant['role'])
                }
                disabled={submitting}
                style={selectStyle(theme)}
              >
                <option value="writer">Writer</option>
                <option value="manager">Manager</option>
              </select>
            </label>
          </Stack>
          <Button
            onClick={() => void create()}
            disabled={!subjectId.trim() || submitting}
            style={{ alignSelf: 'flex-start' }}
          >
            {submitting ? 'Updating authority…' : 'Grant task access'}
          </Button>
        </Stack>
      )}

      <ConfirmDialog
        open={revokeTarget !== null}
        title="Revoke task access"
        message="This subject will immediately lose its explicit task authority. Owning-team authority is unaffected."
        confirmLabel="Revoke"
        destructive
        onConfirm={() => void revoke()}
        onCancel={() => setRevokeTarget(null)}
      />
    </Stack>
  );
}

function selectStyle(theme: ReturnType<typeof useTheme>): React.CSSProperties {
  return {
    width: '100%',
    marginTop: theme.spacing[1],
    padding: `${theme.spacing[2]} ${theme.spacing[3]}`,
    backgroundColor: theme.color.bg.surface,
    color: theme.color.text.DEFAULT,
    border: `1px solid ${theme.color.border.DEFAULT}`,
    borderRadius: theme.radius.sm,
    font: 'inherit',
  };
}
