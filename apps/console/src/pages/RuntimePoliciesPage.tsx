import {
  createRuntimePolicy,
  deleteRuntimePolicy,
  type RuntimePolicyWithTools,
  updateRuntimePolicy,
} from '@moltnet/api-client';
import {
  getRuntimePolicyOptions,
  listRuntimePoliciesOptions,
} from '@moltnet/api-client/query';
import { useQuery } from '@tanstack/react-query';
import {
  Badge,
  Button,
  ConfirmDialog,
  Input,
  Stack,
  Text,
  useTheme,
} from '@themoltnet/design-system';
import { type KeyboardEvent, useEffect, useMemo, useState } from 'react';

import { getApiClient } from '../api.js';
import { getApiErrorDetail } from '../api-error.js';
import { useIsMobile } from '../hooks/useIsMobile.js';
import { useTeam } from '../team/useTeam.js';

const NEW_POLICY_ID = '__new_runtime_policy__';

interface PolicyForm {
  name: string;
  description: string;
  tools: string[];
}

const EMPTY_POLICY: PolicyForm = {
  name: '',
  description: '',
  tools: [],
};

export function RuntimePoliciesPage() {
  const theme = useTheme();
  const isMobile = useIsMobile();
  const { selectedTeam, error: teamError, refreshTeams } = useTeam();
  const teamId = selectedTeam?.id;
  const canManage =
    selectedTeam?.role === 'owner' || selectedTeam?.role === 'manager';
  const [selectedPolicyId, setSelectedPolicyId] = useState<string | null>(null);
  const [form, setForm] = useState<PolicyForm>(EMPTY_POLICY);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const policiesQuery = useQuery({
    ...listRuntimePoliciesOptions({
      client: getApiClient(),
      headers: { 'x-moltnet-team-id': teamId ?? '' },
    }),
    enabled: Boolean(teamId),
  });
  const policies = useMemo(
    () => policiesQuery.data?.items ?? [],
    [policiesQuery.data],
  );
  const isCreating = selectedPolicyId === NEW_POLICY_ID;
  const selectedSummary = policies.find(
    (policy) => policy.id === selectedPolicyId,
  );
  const policyQuery = useQuery({
    ...getRuntimePolicyOptions({
      client: getApiClient(),
      headers: { 'x-moltnet-team-id': teamId ?? '' },
      path: { policyId: selectedSummary?.id ?? '' },
    }),
    enabled: Boolean(teamId && selectedSummary),
  });

  useEffect(() => {
    setSelectedPolicyId(null);
    setForm(EMPTY_POLICY);
    setFormError(null);
  }, [teamId]);

  useEffect(() => {
    if (!selectedPolicyId && policies.length > 0) {
      setSelectedPolicyId(policies[0].id);
    }
  }, [policies, selectedPolicyId]);

  useEffect(() => {
    if (policyQuery.data) {
      setForm(policyToForm(policyQuery.data));
      setFormError(null);
    }
  }, [policyQuery.data]);

  function startNewPolicy() {
    setSelectedPolicyId(NEW_POLICY_ID);
    setForm(EMPTY_POLICY);
    setFormError(null);
  }

  function selectPolicy(policyId: string) {
    setSelectedPolicyId(policyId);
    setFormError(null);
  }

  async function savePolicy() {
    if (!teamId || !form.name.trim()) return;
    setIsSaving(true);
    setFormError(null);
    try {
      const result = isCreating
        ? await createRuntimePolicy({
            client: getApiClient(),
            headers: { 'x-moltnet-team-id': teamId },
            body: {
              name: form.name.trim(),
              description: form.description.trim() || undefined,
              tools: form.tools,
            },
          })
        : await updateRuntimePolicy({
            client: getApiClient(),
            headers: { 'x-moltnet-team-id': teamId },
            path: { policyId: selectedSummary?.id ?? '' },
            body: policyUpdateBody(policyQuery.data, form),
          });
      if (result.error || !result.data) {
        throw new Error(
          getApiErrorDetail(result.error, 'Failed to save tool policy.'),
        );
      }
      setSelectedPolicyId(result.data.id);
      setForm(policyToForm(result.data));
      await policiesQuery.refetch();
      if (!isCreating) {
        await policyQuery.refetch();
      }
    } catch (error) {
      setFormError(getApiErrorDetail(error, 'Failed to save tool policy.'));
    } finally {
      setIsSaving(false);
    }
  }

  async function removePolicy() {
    if (!teamId || !selectedSummary) return;
    setIsSaving(true);
    setFormError(null);
    try {
      const result = await deleteRuntimePolicy({
        client: getApiClient(),
        headers: { 'x-moltnet-team-id': teamId },
        path: { policyId: selectedSummary.id },
      });
      if (result.error) {
        throw new Error(
          getApiErrorDetail(result.error, 'Failed to delete tool policy.'),
        );
      }
      setDeleteOpen(false);
      setSelectedPolicyId(null);
      setForm(EMPTY_POLICY);
      await policiesQuery.refetch();
    } catch (error) {
      setFormError(getApiErrorDetail(error, 'Failed to delete tool policy.'));
    } finally {
      setIsSaving(false);
    }
  }

  if (teamError) {
    return (
      <TeamScopeError
        message="Tool policies require an active team scope."
        retry={() => void refreshTeams()}
      />
    );
  }
  if (!teamId) {
    return <Text color="muted">Select a team to manage tool policies.</Text>;
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
          <Text variant="h2">Tool policies</Text>
          <Text color="muted">
            Define reusable, exact tool allow-lists for runtime profiles.
          </Text>
        </Stack>
        <Button size="sm" onClick={startNewPolicy} disabled={!canManage}>
          New policy
        </Button>
      </Stack>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: isMobile
            ? 'minmax(0, 1fr)'
            : 'minmax(260px, 360px) minmax(0, 1fr)',
          gap: theme.spacing[4],
          alignItems: 'start',
        }}
      >
        <Stack gap={2}>
          {policiesQuery.isLoading ? (
            <Text color="muted">Loading policies…</Text>
          ) : policiesQuery.error ? (
            <RetryState
              message="Failed to load tool policies."
              retry={() => void policiesQuery.refetch()}
            />
          ) : policies.length === 0 ? (
            <EmptyState
              title="No tool policies yet"
              description="Create a named allow-list, then bind it to one or more runtime profiles."
              action={startNewPolicy}
            />
          ) : (
            policies.map((policy) => {
              const active = policy.id === selectedPolicyId;
              return (
                <button
                  key={policy.id}
                  type="button"
                  aria-current={active ? 'true' : undefined}
                  onClick={() => selectPolicy(policy.id)}
                  style={{
                    cursor: 'pointer',
                    textAlign: 'left',
                    border: `1px solid ${
                      active
                        ? theme.color.primary.DEFAULT
                        : theme.color.border.DEFAULT
                    }`,
                    background: theme.color.bg.surface,
                    borderRadius: theme.radius.md,
                    padding: theme.spacing[3],
                    color: theme.color.text.DEFAULT,
                  }}
                >
                  <Stack gap={1}>
                    <Text variant="h4">{policy.name}</Text>
                    <Text variant="caption" color="muted">
                      {policy.description || 'No description'}
                    </Text>
                  </Stack>
                </button>
              );
            })
          )}
        </Stack>

        <section
          aria-label={isCreating ? 'New tool policy' : 'Tool policy editor'}
          style={{
            border: `1px solid ${theme.color.border.DEFAULT}`,
            borderRadius: theme.radius.lg,
            background: theme.color.bg.elevated,
            padding: theme.spacing[5],
          }}
        >
          <Stack gap={4}>
            <Stack gap={1}>
              <Text variant="h3">
                {isCreating
                  ? 'New policy'
                  : selectedSummary
                    ? `Edit ${selectedSummary.name}`
                    : 'Select a policy'}
              </Text>
              <Text color="muted">
                Tool names are exact and case-sensitive. Policies are reusable
                across profiles in this team.
              </Text>
            </Stack>

            {!isCreating && selectedSummary && policyQuery.isLoading ? (
              <Text color="muted">Loading policy details…</Text>
            ) : !isCreating && !selectedSummary ? (
              <Text color="muted">
                Choose a policy from the list or create a new one.
              </Text>
            ) : (
              <>
                <Input
                  label="Name"
                  disabled={!canManage}
                  value={form.name}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                />
                <label>
                  <Text
                    variant="caption"
                    weight="medium"
                    style={{ display: 'block', marginBottom: theme.spacing[1] }}
                  >
                    Description
                  </Text>
                  <textarea
                    aria-label="Description"
                    disabled={!canManage}
                    rows={3}
                    value={form.description}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        description: event.target.value,
                      }))
                    }
                    style={textareaStyle(theme)}
                  />
                </label>
                <ToolNameEditor
                  tools={form.tools}
                  disabled={!canManage}
                  onChange={(tools) =>
                    setForm((current) => ({ ...current, tools }))
                  }
                />
                {form.tools.length === 0 ? (
                  <Text variant="caption" color="muted">
                    This policy grants no tools. Profiles may intentionally use
                    an empty allow-list, but enforce mode will block every tool.
                  </Text>
                ) : null}
                {formError ? (
                  <div role="alert">
                    <Text
                      variant="caption"
                      style={{ color: theme.color.error.DEFAULT }}
                    >
                      {formError}
                    </Text>
                  </div>
                ) : null}
                <Stack direction="row" justify="space-between" gap={3} wrap>
                  <div>
                    {!isCreating && selectedSummary ? (
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => setDeleteOpen(true)}
                        disabled={isSaving || !canManage}
                      >
                        Delete policy
                      </Button>
                    ) : null}
                  </div>
                  <Button
                    size="sm"
                    onClick={() => void savePolicy()}
                    disabled={isSaving || !canManage || !form.name.trim()}
                  >
                    {isSaving
                      ? 'Saving…'
                      : isCreating
                        ? 'Create policy'
                        : 'Save policy'}
                  </Button>
                </Stack>
                {!canManage ? (
                  <Text variant="caption" color="muted">
                    You can inspect policies, but changing them requires the
                    team manage-runtime role.
                  </Text>
                ) : null}
              </>
            )}
          </Stack>
        </section>
      </div>

      <ConfirmDialog
        open={deleteOpen}
        title="Delete tool policy?"
        message={`Delete “${selectedSummary?.name ?? ''}”? Any profile bound to it will lose these tool grants.`}
        confirmLabel="Delete policy"
        destructive
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() => void removePolicy()}
      />
    </Stack>
  );
}

function ToolNameEditor({
  tools,
  disabled,
  onChange,
}: {
  tools: string[];
  disabled: boolean;
  onChange: (tools: string[]) => void;
}) {
  const theme = useTheme();
  const [draft, setDraft] = useState('');
  const normalizedTools = useMemo(
    () => [...tools].sort((a, b) => a.localeCompare(b)),
    [tools],
  );

  function addTool() {
    const next = draft.trim();
    if (!next || tools.includes(next)) return;
    onChange([...tools, next]);
    setDraft('');
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      addTool();
    }
  }

  return (
    <Stack gap={2}>
      <Stack direction="row" align="end" gap={2} wrap>
        <div style={{ flex: '1 1 16rem' }}>
          <Input
            label="Exact tool name"
            hint="Press Enter or choose Add tool. Duplicates are ignored."
            value={draft}
            disabled={disabled}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="read"
          />
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={addTool}
          disabled={disabled || !draft.trim() || tools.includes(draft.trim())}
        >
          Add tool
        </Button>
      </Stack>
      {normalizedTools.length > 0 ? (
        <Stack direction="row" gap={2} wrap aria-label="Granted tools">
          {normalizedTools.map((tool) => (
            <Badge
              key={tool}
              variant="primary"
              style={{ gap: theme.spacing[1] }}
            >
              <code style={{ fontFamily: theme.font.family.mono }}>{tool}</code>
              <button
                type="button"
                aria-label={`Remove ${tool}`}
                disabled={disabled}
                onClick={() =>
                  onChange(tools.filter((candidate) => candidate !== tool))
                }
                style={{
                  border: 0,
                  padding: 0,
                  background: 'transparent',
                  color: 'inherit',
                  cursor: disabled ? 'not-allowed' : 'pointer',
                  font: 'inherit',
                }}
              >
                ×
              </button>
            </Badge>
          ))}
        </Stack>
      ) : null}
    </Stack>
  );
}

function policyToForm(policy: RuntimePolicyWithTools): PolicyForm {
  return {
    name: policy.name,
    description: policy.description ?? '',
    tools: [...policy.tools],
  };
}

function policyUpdateBody(
  policy: RuntimePolicyWithTools | undefined,
  form: PolicyForm,
) {
  const previousTools = new Set(policy?.tools ?? []);
  const nextTools = new Set(form.tools);
  return {
    name: form.name.trim(),
    description: form.description.trim() || null,
    addTools: form.tools.filter((tool) => !previousTools.has(tool)),
    removeTools: [...previousTools].filter((tool) => !nextTools.has(tool)),
  };
}

function textareaStyle(
  theme: ReturnType<typeof useTheme>,
): React.CSSProperties {
  return {
    display: 'block',
    width: '100%',
    resize: 'vertical',
    padding: theme.spacing[3],
    border: `1px solid ${theme.color.border.DEFAULT}`,
    borderRadius: theme.radius.md,
    background: theme.color.bg.surface,
    color: theme.color.text.DEFAULT,
    font: 'inherit',
  };
}

function TeamScopeError({
  message,
  retry,
}: {
  message: string;
  retry: () => void;
}) {
  return (
    <RetryState
      message={message}
      retry={retry}
      title="Team scope unavailable"
    />
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
        border: `1px solid ${theme.color.border.DEFAULT}`,
        borderRadius: theme.radius.md,
        padding: theme.spacing[4],
        background: theme.color.bg.surface,
      }}
    >
      <Stack gap={2}>
        {title ? <Text variant="h4">{title}</Text> : null}
        <Text color="muted">{message}</Text>
        <Button variant="secondary" size="sm" onClick={retry}>
          Retry
        </Button>
      </Stack>
    </div>
  );
}

function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action: () => void;
}) {
  const theme = useTheme();
  return (
    <div
      style={{
        border: `1px solid ${theme.color.border.DEFAULT}`,
        borderRadius: theme.radius.md,
        padding: theme.spacing[4],
        background: theme.color.bg.surface,
      }}
    >
      <Stack gap={2}>
        <Text variant="h4">{title}</Text>
        <Text variant="caption" color="muted">
          {description}
        </Text>
        <Button variant="secondary" size="sm" onClick={action}>
          Create policy
        </Button>
      </Stack>
    </div>
  );
}
