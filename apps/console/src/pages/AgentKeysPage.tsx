import {
  type AgentKey,
  type AgentKeyRevocationReason,
  type AgentKeyStatus,
  type AgentKeyWithSecret,
  createAgentKey,
  revokeAgentKey,
  rotateAgentKey,
} from '@moltnet/api-client';
import {
  listAgentKeysInfiniteOptions,
  listTeamMembersOptions,
} from '@moltnet/api-client/query';
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  Badge,
  Button,
  ConfirmDialog,
  CopyButton,
  Dialog,
  Input,
  Stack,
  Text,
  useTheme,
} from '@themoltnet/design-system';
import { memo, useCallback, useMemo, useRef, useState } from 'react';

import { getApiClient } from '../api.js';
import { getApiErrorDetail } from '../api-error.js';
import { canManageRuntime, TEAM_HEADER } from '../team/permissions.js';
import { useTeam } from '../team/useTeam.js';

interface CreateKeyForm {
  agentId: string;
  name: string;
  ttlDays: string;
}

const EMPTY_CREATE_FORM: CreateKeyForm = {
  agentId: '',
  name: '',
  ttlDays: '',
};

const REVOCATION_REASONS: Array<{
  value: AgentKeyRevocationReason;
  label: string;
}> = [
  { value: 'superseded', label: 'Superseded by another key' },
  { value: 'key_compromise', label: 'Key compromise' },
  { value: 'affiliation_changed', label: 'Agent affiliation changed' },
  { value: 'privilege_withdrawn', label: 'Privilege withdrawn' },
];

export function AgentKeysPage() {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const { selectedTeam, error: teamError, refreshTeams } = useTeam();
  const teamId = selectedTeam?.id;
  const canManage = canManageRuntime(selectedTeam?.role);
  const [agentFilter, setAgentFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<AgentKeyStatus | ''>('');
  const [createOpen, setCreateOpen] = useState(false);
  const [createIdempotencyKey, setCreateIdempotencyKey] = useState<
    string | null
  >(null);
  const [createForm, setCreateForm] =
    useState<CreateKeyForm>(EMPTY_CREATE_FORM);
  const [rotateTarget, setRotateTarget] = useState<AgentKey | null>(null);
  const [rotateAttemptToken, setRotateAttemptToken] = useState<string | null>(
    null,
  );
  const [revokeTarget, setRevokeTarget] = useState<AgentKey | null>(null);
  const [revokeReason, setRevokeReason] =
    useState<AgentKeyRevocationReason>('superseded');
  const [revokeDescription, setRevokeDescription] = useState('');
  const [secretResult, setSecretResult] = useState<AgentKeyWithSecret | null>(
    null,
  );
  const [secretStored, setSecretStored] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [refreshWarning, setRefreshWarning] = useState<string | null>(null);
  const [isMutating, setIsMutating] = useState(false);
  const mutationInFlightRef = useRef(false);
  const dispatchedRotateTokenRef = useRef<string | null>(null);

  const membersQuery = useQuery({
    ...listTeamMembersOptions({
      client: getApiClient(),
      path: { id: teamId ?? '' },
    }),
    enabled: Boolean(teamId),
  });
  const agents = useMemo(
    () =>
      (membersQuery.data?.items ?? [])
        .filter((member) => member.subjectType === 'agent')
        .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [membersQuery.data],
  );
  const agentNames = useMemo(
    () => new Map(agents.map((agent) => [agent.subjectId, agent.displayName])),
    [agents],
  );

  const keysOptions = listAgentKeysInfiniteOptions({
    client: getApiClient(),
    headers: { [TEAM_HEADER]: teamId ?? '' },
    query: {
      agentId: agentFilter || undefined,
      status: statusFilter || undefined,
      limit: 50,
    },
  });
  const keysQuery = useInfiniteQuery({
    ...keysOptions,
    enabled: Boolean(teamId),
    initialPageParam: {
      headers: { [TEAM_HEADER]: teamId ?? '' },
      query: {},
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
  const keys = useMemo(() => {
    const unique = new Map<string, AgentKey>();
    for (const page of keysQuery.data?.pages ?? []) {
      for (const key of page.items) unique.set(key.id, key);
    }
    return [...unique.values()];
  }, [keysQuery.data]);

  async function refreshKeysAfterMutation() {
    setRefreshWarning(null);
    await queryClient.invalidateQueries({
      queryKey: keysOptions.queryKey,
      refetchType: 'none',
    });
    const refreshResult = await keysQuery.refetch();
    if (refreshResult.error) {
      setRefreshWarning(
        'The key change succeeded, but the list could not refresh. Retry the list before making another change.',
      );
    }
  }

  function beginMutation(): boolean {
    if (mutationInFlightRef.current) return false;
    mutationInFlightRef.current = true;
    setIsMutating(true);
    setActionError(null);
    setRefreshWarning(null);
    return true;
  }

  function endMutation() {
    mutationInFlightRef.current = false;
    setIsMutating(false);
  }

  const openRotateDialog = useCallback((key: AgentKey) => {
    const token = crypto.randomUUID();
    dispatchedRotateTokenRef.current = null;
    setActionError(null);
    setRotateAttemptToken(token);
    setRotateTarget(key);
  }, []);

  const closeRotateDialog = useCallback(() => {
    if (mutationInFlightRef.current) return;
    setRotateTarget(null);
    setRotateAttemptToken(null);
    dispatchedRotateTokenRef.current = null;
  }, []);

  const openRevokeDialog = useCallback((key: AgentKey) => {
    setActionError(null);
    setRevokeTarget(key);
  }, []);

  function openCreateDialog() {
    setCreateForm({
      ...EMPTY_CREATE_FORM,
      agentId: agentFilter || agents[0]?.subjectId || '',
    });
    setActionError(null);
    setCreateIdempotencyKey(crypto.randomUUID());
    setCreateOpen(true);
  }

  async function createKey() {
    if (
      !teamId ||
      !createForm.agentId ||
      !createForm.name.trim() ||
      !createIdempotencyKey ||
      !beginMutation()
    )
      return;
    let succeeded = false;
    try {
      const ttlDays = createForm.ttlDays
        ? Number(createForm.ttlDays)
        : undefined;
      const result = await createAgentKey({
        client: getApiClient(),
        headers: {
          [TEAM_HEADER]: teamId,
          'idempotency-key': createIdempotencyKey,
        },
        body: {
          agentId: createForm.agentId,
          name: createForm.name.trim(),
          ttlDays,
        },
      });
      if (result.error || !result.data) {
        throw new Error(
          getApiErrorDetail(result.error, 'Failed to create agent key.'),
        );
      }
      setCreateOpen(false);
      setCreateIdempotencyKey(null);
      revealSecret(result.data);
      succeeded = true;
    } catch (error) {
      setActionError(getApiErrorDetail(error, 'Failed to create agent key.'));
    } finally {
      endMutation();
    }
    if (succeeded) await refreshKeysAfterMutation();
  }

  async function rotateKey() {
    if (
      !teamId ||
      !rotateTarget ||
      !rotateAttemptToken ||
      dispatchedRotateTokenRef.current === rotateAttemptToken ||
      !beginMutation()
    )
      return;
    dispatchedRotateTokenRef.current = rotateAttemptToken;
    let succeeded = false;
    try {
      const result = await rotateAgentKey({
        client: getApiClient(),
        headers: { [TEAM_HEADER]: teamId },
        path: { keyId: rotateTarget.id },
      });
      if (result.error || !result.data) {
        throw new Error(
          getApiErrorDetail(result.error, 'Failed to rotate agent key.'),
        );
      }
      setRotateTarget(null);
      setRotateAttemptToken(null);
      revealSecret(result.data);
      succeeded = true;
    } catch (error) {
      dispatchedRotateTokenRef.current = null;
      setActionError(getApiErrorDetail(error, 'Failed to rotate agent key.'));
    } finally {
      endMutation();
    }
    if (succeeded) await refreshKeysAfterMutation();
  }

  async function revokeKey() {
    if (!teamId || !revokeTarget || !beginMutation()) return;
    let succeeded = false;
    try {
      const body =
        revokeReason === 'privilege_withdrawn'
          ? {
              reason: revokeReason,
              description: revokeDescription.trim() || undefined,
            }
          : { reason: revokeReason };
      const result = await revokeAgentKey({
        client: getApiClient(),
        headers: { [TEAM_HEADER]: teamId },
        path: { keyId: revokeTarget.id },
        body,
      });
      if (result.error) {
        throw new Error(
          getApiErrorDetail(result.error, 'Failed to revoke agent key.'),
        );
      }
      setRevokeTarget(null);
      setRevokeReason('superseded');
      setRevokeDescription('');
      succeeded = true;
    } catch (error) {
      setActionError(getApiErrorDetail(error, 'Failed to revoke agent key.'));
    } finally {
      endMutation();
    }
    if (succeeded) await refreshKeysAfterMutation();
  }

  function revealSecret(result: AgentKeyWithSecret) {
    setSecretStored(false);
    setSecretResult(result);
  }

  function clearSecret() {
    if (!secretStored) return;
    setSecretResult(null);
    setSecretStored(false);
  }

  if (teamError) {
    return (
      <RetryState
        title="Team scope unavailable"
        message="Agent keys require an active team scope."
        retry={() => void refreshTeams()}
      />
    );
  }
  if (!teamId) {
    return <Text color="muted">Select a team to manage agent keys.</Text>;
  }

  return (
    <Stack gap={5}>
      <Stack
        direction="row"
        align="center"
        justify="space-between"
        gap={4}
        wrap
      >
        <Stack gap={1}>
          <Text variant="h2">Agent keys</Text>
          <Text color="muted">
            Issue and revoke team-bound credentials for agent runtimes.
          </Text>
        </Stack>
        <Button
          size="sm"
          variant="accent"
          onClick={openCreateDialog}
          disabled={agents.length === 0 || !canManage}
        >
          Create key
        </Button>
      </Stack>

      <Stack direction="row" gap={3} align="end" wrap>
        <SelectField
          label="Agent"
          value={agentFilter}
          onChange={setAgentFilter}
          options={[
            { value: '', label: 'All team agents' },
            ...agents.map((agent) => ({
              value: agent.subjectId,
              label: agent.displayName,
            })),
          ]}
        />
        <SelectField
          label="Status"
          value={statusFilter}
          onChange={(value) => setStatusFilter(value as AgentKeyStatus | '')}
          options={[
            { value: '', label: 'All statuses' },
            { value: 'active', label: 'Active' },
            { value: 'expired', label: 'Expired' },
            { value: 'revoked', label: 'Revoked' },
          ]}
        />
      </Stack>

      {membersQuery.error ? (
        <RetryState
          message="Failed to load team agents."
          retry={() => void membersQuery.refetch()}
        />
      ) : keysQuery.error && keys.length === 0 ? (
        <RetryState
          message="Failed to load agent keys."
          retry={() => void keysQuery.refetch()}
        />
      ) : keysQuery.isLoading && keys.length === 0 ? (
        <Text color="muted">Loading agent keys…</Text>
      ) : keys.length === 0 ? (
        <EmptyKeysState
          hasAgents={agents.length > 0}
          create={openCreateDialog}
        />
      ) : (
        <KeyTable
          keys={keys}
          agentNames={agentNames}
          rotating={isMutating}
          onRotate={openRotateDialog}
          onRevoke={openRevokeDialog}
          canManage={canManage}
        />
      )}

      {keysQuery.hasNextPage ? (
        <div>
          <Button
            variant="secondary"
            size="sm"
            disabled={keysQuery.isFetchingNextPage}
            onClick={() => void keysQuery.fetchNextPage()}
          >
            {keysQuery.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      ) : null}

      {actionError ? (
        <div role="alert">
          <Text variant="caption" style={{ color: theme.color.error.DEFAULT }}>
            {actionError}
          </Text>
        </div>
      ) : null}
      {refreshWarning ? (
        <div role="status">
          <Stack direction="row" gap={2} align="center" wrap>
            <Text
              variant="caption"
              style={{ color: theme.color.warning.DEFAULT }}
            >
              {refreshWarning}
            </Text>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void refreshKeysAfterMutation()}
              disabled={keysQuery.isFetching}
            >
              Retry list
            </Button>
          </Stack>
        </div>
      ) : null}
      {!canManage ? (
        <Text variant="caption" color="muted">
          You can inspect keys, but changing them requires the team
          manage-runtime role.
        </Text>
      ) : null}

      <CreateKeyDialog
        open={createOpen}
        agents={agents}
        form={createForm}
        isMutating={isMutating}
        onFormChange={setCreateForm}
        onClose={() => {
          if (mutationInFlightRef.current) return;
          setCreateOpen(false);
          setCreateIdempotencyKey(null);
        }}
        onSubmit={() => void createKey()}
      />

      <RotateKeyDialog
        target={rotateTarget}
        isMutating={isMutating}
        onCancel={closeRotateDialog}
        onConfirm={() => void rotateKey()}
      />

      <RevokeKeyDialog
        target={revokeTarget}
        reason={revokeReason}
        description={revokeDescription}
        isMutating={isMutating}
        onReasonChange={setRevokeReason}
        onDescriptionChange={setRevokeDescription}
        onCancel={() => {
          if (mutationInFlightRef.current) return;
          setRevokeTarget(null);
        }}
        onConfirm={() => void revokeKey()}
      />

      <OneTimeSecretDialog
        result={secretResult}
        stored={secretStored}
        onStoredChange={setSecretStored}
        onDone={clearSecret}
      />
    </Stack>
  );
}

function CreateKeyDialog({
  open,
  agents,
  form,
  isMutating,
  onFormChange,
  onClose,
  onSubmit,
}: {
  open: boolean;
  agents: Array<{ subjectId: string; displayName: string }>;
  form: CreateKeyForm;
  isMutating: boolean;
  onFormChange: (form: CreateKeyForm) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} title="Create agent key">
      <Stack gap={4}>
        <SelectField
          label="Agent"
          value={form.agentId}
          onChange={(agentId) => onFormChange({ ...form, agentId })}
          options={agents.map((agent) => ({
            value: agent.subjectId,
            label: agent.displayName,
          }))}
        />
        <Input
          label="Key name"
          hint="Use a deployment-specific name, such as production-daemon."
          value={form.name}
          onChange={(event) =>
            onFormChange({ ...form, name: event.target.value })
          }
        />
        <Input
          label="Lifetime in days"
          hint="Leave blank to use the server default."
          type="number"
          min={1}
          value={form.ttlDays}
          onChange={(event) =>
            onFormChange({ ...form, ttlDays: event.target.value })
          }
        />
        <Stack direction="row" gap={2} justify="flex-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            disabled={isMutating}
          >
            Cancel
          </Button>
          <Button
            variant="accent"
            size="sm"
            onClick={onSubmit}
            disabled={isMutating || !form.agentId || !form.name.trim()}
          >
            {isMutating ? 'Creating…' : 'Create key'}
          </Button>
        </Stack>
      </Stack>
    </Dialog>
  );
}

function RotateKeyDialog({
  target,
  isMutating,
  onCancel,
  onConfirm,
}: {
  target: AgentKey | null;
  isMutating: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <ConfirmDialog
      open={target !== null}
      title="Rotate agent key?"
      message={`Rotate “${target?.name ?? ''}”? Existing deployments using its current secret will stop authenticating.`}
      confirmLabel={isMutating ? 'Rotating…' : 'Rotate key'}
      destructive
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}

function RevokeKeyDialog({
  target,
  reason,
  description,
  isMutating,
  onReasonChange,
  onDescriptionChange,
  onCancel,
  onConfirm,
}: {
  target: AgentKey | null;
  reason: AgentKeyRevocationReason;
  description: string;
  isMutating: boolean;
  onReasonChange: (reason: AgentKeyRevocationReason) => void;
  onDescriptionChange: (description: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={target !== null} onClose={onCancel} title="Revoke agent key">
      <Stack gap={4}>
        <Text color="muted">
          Revoke “{target?.name ?? ''}”. This takes effect immediately and
          cannot be undone.
        </Text>
        <SelectField
          label="Reason"
          value={reason}
          onChange={(value) =>
            onReasonChange(value as AgentKeyRevocationReason)
          }
          options={REVOCATION_REASONS}
        />
        {reason === 'privilege_withdrawn' ? (
          <Input
            label="Description"
            value={description}
            onChange={(event) => onDescriptionChange(event.target.value)}
          />
        ) : null}
        <Stack direction="row" gap={2} justify="flex-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={onCancel}
            disabled={isMutating}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={onConfirm}
            disabled={isMutating}
          >
            {isMutating ? 'Revoking…' : 'Revoke key'}
          </Button>
        </Stack>
      </Stack>
    </Dialog>
  );
}

const KeyTable = memo(function KeyTable({
  keys,
  agentNames,
  rotating,
  onRotate,
  onRevoke,
  canManage,
}: {
  keys: AgentKey[];
  agentNames: Map<string, string>;
  rotating: boolean;
  onRotate: (key: AgentKey) => void;
  onRevoke: (key: AgentKey) => void;
  canManage: boolean;
}) {
  const theme = useTheme();
  const styles = useMemo(
    () => ({
      wrapper: { overflowX: 'auto' } as const,
      table: {
        width: '100%',
        minWidth: 820,
        borderCollapse: 'collapse' as const,
        color: theme.color.text.DEFAULT,
      },
      headerCell: headerCellStyle(theme),
      bodyCell: bodyCellStyle(theme),
      code: {
        fontFamily: theme.font.family.mono,
        color: theme.color.text.muted,
        fontSize: theme.font.size.xs,
      },
    }),
    [theme],
  );
  return (
    <div style={styles.wrapper}>
      <table style={styles.table}>
        <thead>
          <tr>
            {['Name', 'Agent', 'Status', 'Expires', 'Last used', 'Actions'].map(
              (label) => (
                <th key={label} scope="col" style={styles.headerCell}>
                  {label}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {keys.map((key) => (
            <tr key={key.id}>
              <td style={styles.bodyCell}>
                <Stack gap={1}>
                  <Text weight="medium">{key.name}</Text>
                  <code title={key.id} style={styles.code}>
                    {shortId(key.id)}
                  </code>
                </Stack>
              </td>
              <td style={styles.bodyCell}>
                {agentNames.get(key.agentId) ?? shortId(key.agentId)}
              </td>
              <td style={styles.bodyCell}>
                <Badge variant={statusVariant(key.status)}>{key.status}</Badge>
              </td>
              <td style={styles.bodyCell}>{formatTimestamp(key.expiresAt)}</td>
              <td style={styles.bodyCell}>{formatTimestamp(key.lastUsedAt)}</td>
              <td style={styles.bodyCell}>
                {key.status === 'active' ? (
                  <Stack direction="row" gap={2}>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={rotating || !canManage}
                      onClick={() => onRotate(key)}
                    >
                      Rotate
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      disabled={rotating || !canManage}
                      onClick={() => onRevoke(key)}
                    >
                      Revoke
                    </Button>
                  </Stack>
                ) : (
                  <Text variant="caption" color="muted">
                    No actions
                  </Text>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});

function OneTimeSecretDialog({
  result,
  stored,
  onStoredChange,
  onDone,
}: {
  result: AgentKeyWithSecret | null;
  stored: boolean;
  onStoredChange: (stored: boolean) => void;
  onDone: () => void;
}) {
  const theme = useTheme();
  return (
    <Dialog
      open={result !== null}
      onClose={() => {}}
      title="Store this secret now"
      width="620px"
      dismissible={false}
      ariaDescribedBy="one-time-secret-warning"
    >
      <Stack gap={4}>
        <div
          id="one-time-secret-warning"
          role="alert"
          style={{
            padding: theme.spacing[3],
            borderRadius: theme.radius.md,
            background: theme.color.warning.muted,
            color: theme.color.warning.DEFAULT,
          }}
        >
          This secret is shown once. MoltNet cannot retrieve it after you close
          this dialog. Store it in your deployment secret manager now.
        </div>
        <Stack gap={2}>
          <Text variant="caption" weight="medium">
            Secret for {result?.key.name ?? 'agent key'}
          </Text>
          <div
            style={{
              overflowWrap: 'anywhere',
              padding: theme.spacing[3],
              borderRadius: theme.radius.md,
              background: theme.color.bg.surface,
              border: `1px solid ${theme.color.border.DEFAULT}`,
              fontFamily: theme.font.family.mono,
            }}
          >
            {result?.secret ?? ''}
          </div>
          {result ? (
            <CopyButton
              value={result.secret}
              label="Agent key secret"
              ariaLabel="Copy one-time agent key secret"
            />
          ) : null}
        </Stack>
        <label
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: theme.spacing[2],
          }}
        >
          <input
            type="checkbox"
            checked={stored}
            onChange={(event) => onStoredChange(event.target.checked)}
          />
          <Text>I stored this secret in a secure location.</Text>
        </label>
        <Stack direction="row" justify="flex-end">
          <Button variant="accent" onClick={onDone} disabled={!stored}>
            Done — clear secret
          </Button>
        </Stack>
      </Stack>
    </Dialog>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  const theme = useTheme();
  return (
    <label style={{ display: 'grid', gap: theme.spacing[1], minWidth: 190 }}>
      <Text variant="caption" weight="medium">
        {label}
      </Text>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        style={{
          minHeight: 38,
          padding: `${theme.spacing[2]} ${theme.spacing[3]}`,
          border: `1px solid ${theme.color.border.DEFAULT}`,
          borderRadius: theme.radius.md,
          background: theme.color.bg.surface,
          color: theme.color.text.DEFAULT,
          font: 'inherit',
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function EmptyKeysState({
  hasAgents,
  create,
}: {
  hasAgents: boolean;
  create: () => void;
}) {
  const theme = useTheme();
  return (
    <div
      style={{
        padding: theme.spacing[5],
        border: `1px solid ${theme.color.border.DEFAULT}`,
        borderRadius: theme.radius.md,
        background: theme.color.bg.surface,
      }}
    >
      <Stack gap={2}>
        <Text variant="h4">
          {hasAgents ? 'No matching agent keys' : 'No agents in this team'}
        </Text>
        <Text color="muted">
          {hasAgents
            ? 'Create a deployment credential or change the filters.'
            : 'Add an agent to the team before issuing a team-bound key.'}
        </Text>
        {hasAgents ? (
          <div>
            <Button variant="secondary" size="sm" onClick={create}>
              Create key
            </Button>
          </div>
        ) : null}
      </Stack>
    </div>
  );
}

function RetryState({
  message,
  retry,
  title,
}: {
  message: string;
  retry: () => void;
  title?: string;
}) {
  const theme = useTheme();
  return (
    <div
      role="alert"
      style={{
        padding: theme.spacing[4],
        border: `1px solid ${theme.color.border.DEFAULT}`,
        borderRadius: theme.radius.md,
        background: theme.color.bg.surface,
      }}
    >
      <Stack gap={2}>
        {title ? <Text variant="h4">{title}</Text> : null}
        <Text color="muted">{message}</Text>
        <div>
          <Button variant="secondary" size="sm" onClick={retry}>
            Retry
          </Button>
        </div>
      </Stack>
    </div>
  );
}

function statusVariant(status: AgentKeyStatus) {
  if (status === 'active') return 'success' as const;
  if (status === 'expired') return 'warning' as const;
  return 'error' as const;
}

function formatTimestamp(value: string | null): string {
  if (!value) return 'Never';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function shortId(value: string): string {
  return value.length > 12 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
}

function headerCellStyle(
  theme: ReturnType<typeof useTheme>,
): React.CSSProperties {
  return {
    textAlign: 'left',
    padding: theme.spacing[3],
    borderBottom: `1px solid ${theme.color.border.DEFAULT}`,
    color: theme.color.text.muted,
    fontSize: theme.font.size.xs,
    fontWeight: theme.font.weight.semibold,
  };
}

function bodyCellStyle(
  theme: ReturnType<typeof useTheme>,
): React.CSSProperties {
  return {
    padding: theme.spacing[3],
    borderBottom: `1px solid ${theme.color.border.DEFAULT}`,
    verticalAlign: 'middle',
    fontSize: theme.font.size.sm,
  };
}
