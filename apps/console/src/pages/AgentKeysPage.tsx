import {
  type AgentKey,
  type AgentKeyRevocationReason,
  type AgentKeyStatus,
  type AgentKeyWithSecret,
  createAgentKey,
  listAgentKeys,
  revokeAgentKey,
  rotateAgentKey,
} from '@moltnet/api-client';
import {
  listAgentKeysOptions,
  listTeamMembersOptions,
} from '@moltnet/api-client/query';
import { useQuery } from '@tanstack/react-query';
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
import { useEffect, useMemo, useState } from 'react';

import { getApiClient } from '../api.js';
import { getApiErrorDetail } from '../api-error.js';
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
  const { selectedTeam, error: teamError, refreshTeams } = useTeam();
  const teamId = selectedTeam?.id;
  const canManage =
    selectedTeam?.role === 'owner' || selectedTeam?.role === 'manager';
  const [agentFilter, setAgentFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<AgentKeyStatus | ''>('');
  const [cursor, setCursor] = useState<string | null>(null);
  const [keys, setKeys] = useState<AgentKey[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createIdempotencyKey, setCreateIdempotencyKey] = useState<
    string | null
  >(null);
  const [createForm, setCreateForm] =
    useState<CreateKeyForm>(EMPTY_CREATE_FORM);
  const [rotateTarget, setRotateTarget] = useState<AgentKey | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<AgentKey | null>(null);
  const [revokeReason, setRevokeReason] =
    useState<AgentKeyRevocationReason>('superseded');
  const [revokeDescription, setRevokeDescription] = useState('');
  const [secretResult, setSecretResult] = useState<AgentKeyWithSecret | null>(
    null,
  );
  const [secretStored, setSecretStored] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isMutating, setIsMutating] = useState(false);

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

  const keysQuery = useQuery({
    ...listAgentKeysOptions({
      client: getApiClient(),
      headers: { 'x-moltnet-team-id': teamId ?? '' },
      query: {
        agentId: agentFilter || undefined,
        status: statusFilter || undefined,
        cursor: cursor ?? undefined,
        limit: 50,
      },
    }),
    enabled: Boolean(teamId),
  });

  useEffect(() => {
    setCursor(null);
    setKeys([]);
    setNextCursor(null);
    setActionError(null);
  }, [agentFilter, statusFilter, teamId]);

  useEffect(() => {
    const page = keysQuery.data;
    if (!page) return;
    setKeys((current) => {
      if (!cursor) return page.items;
      const known = new Set(current.map((key) => key.id));
      return [...current, ...page.items.filter((key) => !known.has(key.id))];
    });
    setNextCursor(page.nextCursor);
  }, [cursor, keysQuery.data]);

  function openCreateDialog() {
    setCreateForm({
      ...EMPTY_CREATE_FORM,
      agentId: agentFilter || agents[0]?.subjectId || '',
    });
    setActionError(null);
    setCreateIdempotencyKey(crypto.randomUUID());
    setCreateOpen(true);
  }

  async function reloadKeys() {
    if (!teamId) return;
    const result = await listAgentKeys({
      client: getApiClient(),
      headers: { 'x-moltnet-team-id': teamId },
      query: {
        agentId: agentFilter || undefined,
        status: statusFilter || undefined,
        limit: 50,
      },
    });
    if (result.error || !result.data) {
      throw new Error(
        getApiErrorDetail(result.error, 'Failed to reload agent keys.'),
      );
    }
    setCursor(null);
    setKeys(result.data.items);
    setNextCursor(result.data.nextCursor);
  }

  async function createKey() {
    if (
      !teamId ||
      !createForm.agentId ||
      !createForm.name.trim() ||
      !createIdempotencyKey
    )
      return;
    setIsMutating(true);
    setActionError(null);
    try {
      const ttlDays = createForm.ttlDays
        ? Number(createForm.ttlDays)
        : undefined;
      const result = await createAgentKey({
        client: getApiClient(),
        headers: {
          'x-moltnet-team-id': teamId,
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
      await reloadKeys();
    } catch (error) {
      setActionError(getApiErrorDetail(error, 'Failed to create agent key.'));
    } finally {
      setIsMutating(false);
    }
  }

  async function rotateKey() {
    if (!teamId || !rotateTarget) return;
    setIsMutating(true);
    setActionError(null);
    try {
      const result = await rotateAgentKey({
        client: getApiClient(),
        headers: { 'x-moltnet-team-id': teamId },
        path: { keyId: rotateTarget.id },
      });
      if (result.error || !result.data) {
        throw new Error(
          getApiErrorDetail(result.error, 'Failed to rotate agent key.'),
        );
      }
      setRotateTarget(null);
      revealSecret(result.data);
      await reloadKeys();
    } catch (error) {
      setActionError(getApiErrorDetail(error, 'Failed to rotate agent key.'));
    } finally {
      setIsMutating(false);
    }
  }

  async function revokeKey() {
    if (!teamId || !revokeTarget) return;
    setIsMutating(true);
    setActionError(null);
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
        headers: { 'x-moltnet-team-id': teamId },
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
      await reloadKeys();
    } catch (error) {
      setActionError(getApiErrorDetail(error, 'Failed to revoke agent key.'));
    } finally {
      setIsMutating(false);
    }
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
          onRotate={setRotateTarget}
          onRevoke={setRevokeTarget}
          canManage={canManage}
        />
      )}

      {nextCursor ? (
        <div>
          <Button
            variant="secondary"
            size="sm"
            disabled={keysQuery.isFetching}
            onClick={() => setCursor(nextCursor)}
          >
            {keysQuery.isFetching ? 'Loading…' : 'Load more'}
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
      {!canManage ? (
        <Text variant="caption" color="muted">
          You can inspect keys, but changing them requires the team
          manage-runtime role.
        </Text>
      ) : null}

      <Dialog
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
          setCreateIdempotencyKey(null);
        }}
        title="Create agent key"
      >
        <Stack gap={4}>
          <SelectField
            label="Agent"
            value={createForm.agentId}
            onChange={(agentId) =>
              setCreateForm((current) => ({ ...current, agentId }))
            }
            options={agents.map((agent) => ({
              value: agent.subjectId,
              label: agent.displayName,
            }))}
          />
          <Input
            label="Key name"
            hint="Use a deployment-specific name, such as production-daemon."
            value={createForm.name}
            onChange={(event) =>
              setCreateForm((current) => ({
                ...current,
                name: event.target.value,
              }))
            }
          />
          <Input
            label="Lifetime in days"
            hint="Leave blank to use the server default."
            type="number"
            min={1}
            value={createForm.ttlDays}
            onChange={(event) =>
              setCreateForm((current) => ({
                ...current,
                ttlDays: event.target.value,
              }))
            }
          />
          <Stack direction="row" gap={2} justify="flex-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setCreateOpen(false);
                setCreateIdempotencyKey(null);
              }}
              disabled={isMutating}
            >
              Cancel
            </Button>
            <Button
              variant="accent"
              size="sm"
              onClick={() => void createKey()}
              disabled={
                isMutating || !createForm.agentId || !createForm.name.trim()
              }
            >
              {isMutating ? 'Creating…' : 'Create key'}
            </Button>
          </Stack>
        </Stack>
      </Dialog>

      <ConfirmDialog
        open={rotateTarget !== null}
        title="Rotate agent key?"
        message={`Rotate “${rotateTarget?.name ?? ''}”? Existing deployments using its current secret will stop authenticating.`}
        confirmLabel={isMutating ? 'Rotating…' : 'Rotate key'}
        destructive
        onCancel={() => setRotateTarget(null)}
        onConfirm={() => void rotateKey()}
      />

      <Dialog
        open={revokeTarget !== null}
        onClose={() => setRevokeTarget(null)}
        title="Revoke agent key"
      >
        <Stack gap={4}>
          <Text color="muted">
            Revoke “{revokeTarget?.name ?? ''}”. This takes effect immediately
            and cannot be undone.
          </Text>
          <SelectField
            label="Reason"
            value={revokeReason}
            onChange={(value) =>
              setRevokeReason(value as AgentKeyRevocationReason)
            }
            options={REVOCATION_REASONS}
          />
          {revokeReason === 'privilege_withdrawn' ? (
            <Input
              label="Description"
              value={revokeDescription}
              onChange={(event) => setRevokeDescription(event.target.value)}
            />
          ) : null}
          <Stack direction="row" gap={2} justify="flex-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setRevokeTarget(null)}
              disabled={isMutating}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => void revokeKey()}
              disabled={isMutating}
            >
              {isMutating ? 'Revoking…' : 'Revoke key'}
            </Button>
          </Stack>
        </Stack>
      </Dialog>

      <OneTimeSecretDialog
        result={secretResult}
        stored={secretStored}
        onStoredChange={setSecretStored}
        onDone={clearSecret}
      />
    </Stack>
  );
}

function KeyTable({
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
  return (
    <div style={{ overflowX: 'auto' }}>
      <table
        style={{
          width: '100%',
          minWidth: 820,
          borderCollapse: 'collapse',
          color: theme.color.text.DEFAULT,
        }}
      >
        <thead>
          <tr>
            {['Name', 'Agent', 'Status', 'Expires', 'Last used', 'Actions'].map(
              (label) => (
                <th key={label} scope="col" style={headerCellStyle(theme)}>
                  {label}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {keys.map((key) => (
            <tr key={key.id}>
              <td style={bodyCellStyle(theme)}>
                <Stack gap={1}>
                  <Text weight="medium">{key.name}</Text>
                  <code
                    title={key.id}
                    style={{
                      fontFamily: theme.font.family.mono,
                      color: theme.color.text.muted,
                      fontSize: theme.font.size.xs,
                    }}
                  >
                    {shortId(key.id)}
                  </code>
                </Stack>
              </td>
              <td style={bodyCellStyle(theme)}>
                {agentNames.get(key.agentId) ?? shortId(key.agentId)}
              </td>
              <td style={bodyCellStyle(theme)}>
                <Badge variant={statusVariant(key.status)}>{key.status}</Badge>
              </td>
              <td style={bodyCellStyle(theme)}>
                {formatTimestamp(key.expiresAt)}
              </td>
              <td style={bodyCellStyle(theme)}>
                {formatTimestamp(key.lastUsedAt)}
              </td>
              <td style={bodyCellStyle(theme)}>
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
}

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
