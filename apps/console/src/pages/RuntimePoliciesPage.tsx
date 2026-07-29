import {
  createRuntimePolicy,
  deleteRuntimePolicy,
  type RuntimePolicyWithTools,
  type ShellCommandRule,
  updateRuntimePolicy,
} from '@moltnet/api-client';
import {
  getRuntimePolicyOptions,
  listRuntimePoliciesOptions,
} from '@moltnet/api-client/query';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
import { canManageRuntime, TEAM_HEADER } from '../team/permissions.js';
import { useTeam } from '../team/useTeam.js';

interface PolicyForm {
  name: string;
  description: string;
  tools: string[];
  shellCommands: ShellCommandRule[];
}

const EMPTY_POLICY: PolicyForm = {
  name: '',
  description: '',
  tools: [],
  shellCommands: [],
};

const ALLOWED_TOOLS_QUERY_ROOT = [
  { _id: 'getRuntimeProfileAllowedTools' },
] as const;

type PolicySelection =
  | { kind: 'none' }
  | { kind: 'create' }
  | { kind: 'existing'; id: string };

export function RuntimePoliciesPage() {
  const theme = useTheme();
  const isMobile = useIsMobile();
  const queryClient = useQueryClient();
  const { selectedTeam, error: teamError, refreshTeams } = useTeam();
  const teamId = selectedTeam?.id;
  const canManage = canManageRuntime(selectedTeam?.role);
  const [selection, setSelection] = useState<PolicySelection>({
    kind: 'none',
  });
  const [form, setForm] = useState<PolicyForm>(EMPTY_POLICY);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const policiesQuery = useQuery({
    ...listRuntimePoliciesOptions({
      client: getApiClient(),
      headers: { [TEAM_HEADER]: teamId ?? '' },
    }),
    enabled: Boolean(teamId),
  });
  const policies = useMemo(
    () => policiesQuery.data?.items ?? [],
    [policiesQuery.data],
  );
  const isCreating = selection.kind === 'create';
  const hasInvalidShellCommands = form.shellCommands.some(
    (rule) =>
      rule.argvPrefix.length < 2 ||
      rule.argvPrefix.length > 8 ||
      rule.argvPrefix.some((token) => shellTokenError(token) !== undefined),
  );
  const selectedSummary = policies.find(
    (policy) => selection.kind === 'existing' && policy.id === selection.id,
  );
  const policyQuery = useQuery({
    ...getRuntimePolicyOptions({
      client: getApiClient(),
      headers: { [TEAM_HEADER]: teamId ?? '' },
      path: { policyId: selectedSummary?.id ?? '' },
    }),
    enabled: Boolean(teamId && selectedSummary),
  });

  useEffect(() => {
    setSelection({ kind: 'none' });
    setForm(EMPTY_POLICY);
    setFormError(null);
  }, [teamId]);

  useEffect(() => {
    if (selection.kind === 'none' && policies.length > 0) {
      setSelection({ kind: 'existing', id: policies[0].id });
    }
  }, [policies, selection.kind]);

  useEffect(() => {
    if (policyQuery.data) {
      setForm(policyToForm(policyQuery.data));
      setFormError(null);
    }
  }, [policyQuery.data]);

  function startNewPolicy() {
    setSelection({ kind: 'create' });
    setForm(EMPTY_POLICY);
    setFormError(null);
  }

  function selectPolicy(policyId: string) {
    setSelection({ kind: 'existing', id: policyId });
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
            headers: { [TEAM_HEADER]: teamId },
            body: {
              name: form.name.trim(),
              description: form.description.trim() || undefined,
              tools: form.tools,
              shellCommands: normalizeFormShellCommands(form.shellCommands),
            },
          })
        : await updateRuntimePolicy({
            client: getApiClient(),
            headers: { [TEAM_HEADER]: teamId },
            path: { policyId: selectedSummary?.id ?? '' },
            body: policyUpdateBody(policyQuery.data, form),
          });
      if (result.error || !result.data) {
        throw new Error(
          getApiErrorDetail(result.error, 'Failed to save tool policy.'),
        );
      }
      setSelection({ kind: 'existing', id: result.data.id });
      setForm(policyToForm(result.data));
      await queryClient.invalidateQueries({
        queryKey: ALLOWED_TOOLS_QUERY_ROOT,
      });
      const listRefresh = await policiesQuery.refetch();
      if (listRefresh.error) {
        setFormError(
          'The policy was saved, but the policy list could not refresh. Retry the list before making another change.',
        );
        return;
      }
      if (!isCreating) {
        const detailRefresh = await policyQuery.refetch();
        if (detailRefresh.error) {
          setFormError(
            'The policy was saved, but its details could not refresh. Retry the policy details before making another change.',
          );
        }
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
        headers: { [TEAM_HEADER]: teamId },
        path: { policyId: selectedSummary.id },
      });
      if (result.error) {
        throw new Error(
          getApiErrorDetail(result.error, 'Failed to delete tool policy.'),
        );
      }
      setDeleteOpen(false);
      await queryClient.invalidateQueries({
        queryKey: ALLOWED_TOOLS_QUERY_ROOT,
      });
      const refreshed = await policiesQuery.refetch();
      if (refreshed.error) {
        setSelection({ kind: 'none' });
        setForm(EMPTY_POLICY);
        setFormError(
          'The policy was deleted, but the policy list could not refresh. Retry the list before making another change.',
        );
        return;
      }
      const nextPolicy = refreshed.data?.items.find(
        (policy) => policy.id !== selectedSummary.id,
      );
      setSelection(
        nextPolicy ? { kind: 'existing', id: nextPolicy.id } : { kind: 'none' },
      );
      if (!nextPolicy) setForm(EMPTY_POLICY);
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
              const active =
                selection.kind === 'existing' && policy.id === selection.id;
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
            ) : !isCreating && selectedSummary && policyQuery.error ? (
              <RetryState
                message="Failed to load tool policy details."
                retry={() => void policyQuery.refetch()}
              />
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
                <ShellCommandEditor
                  shellCommands={form.shellCommands}
                  broadTools={form.tools}
                  disabled={!canManage}
                  onChange={(shellCommands) =>
                    setForm((current) => ({ ...current, shellCommands }))
                  }
                />
                {form.tools.length === 0 && form.shellCommands.length === 0 ? (
                  <Text variant="caption" color="muted">
                    This policy grants no exact tools or shell commands. In
                    enforce mode, every tool call will be blocked.
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
                    disabled={
                      isSaving ||
                      !canManage ||
                      !form.name.trim() ||
                      hasInvalidShellCommands
                    }
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
      <Stack gap={1}>
        <Text variant="h4">Exact tools</Text>
        <Text variant="caption" color="muted">
          Exact tool grants also authorize every shell invocation of an
          executable with the same name.
        </Text>
      </Stack>
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
      ) : (
        <Text variant="caption" color="muted">
          No broad tool grants. Add a tool only when every operation it exposes
          should be available.
        </Text>
      )}
    </Stack>
  );
}

function ShellCommandEditor({
  shellCommands,
  broadTools,
  disabled,
  onChange,
}: {
  shellCommands: ShellCommandRule[];
  broadTools: string[];
  disabled: boolean;
  onChange: (rules: ShellCommandRule[]) => void;
}) {
  const theme = useTheme();

  function updateToken(ruleIndex: number, tokenIndex: number, value: string) {
    onChange(
      shellCommands.map((rule, index) => {
        if (index !== ruleIndex) return rule;
        const argvPrefix = [...rule.argvPrefix];
        argvPrefix[tokenIndex] = value;
        return { argvPrefix };
      }),
    );
  }

  function addToken(ruleIndex: number) {
    onChange(
      shellCommands.map((rule, index) =>
        index === ruleIndex ? { argvPrefix: [...rule.argvPrefix, ''] } : rule,
      ),
    );
  }

  function removeToken(ruleIndex: number, tokenIndex: number) {
    onChange(
      shellCommands.map((rule, index) =>
        index === ruleIndex
          ? {
              argvPrefix: rule.argvPrefix.filter(
                (_token, indexToKeep) => indexToKeep !== tokenIndex,
              ),
            }
          : rule,
      ),
    );
  }

  return (
    <Stack gap={3}>
      <Stack
        direction="row"
        align="center"
        justify="space-between"
        gap={3}
        wrap
      >
        <Stack gap={1}>
          <Text variant="h4">Allowed shell commands</Text>
          <Text variant="caption" color="muted">
            Match literal argv tokens from the executable onward. Extra
            arguments after the configured tokens remain allowed.
          </Text>
        </Stack>
        <Button
          variant="secondary"
          size="sm"
          disabled={disabled}
          onClick={() => onChange([...shellCommands, { argvPrefix: ['', ''] }])}
        >
          Add shell command
        </Button>
      </Stack>

      {shellCommands.length === 0 ? (
        <Text variant="caption" color="muted">
          No scoped shell access. Add a command to grant a specific CLI path
          without granting the whole executable.
        </Text>
      ) : (
        <Stack gap={3}>
          {shellCommands.map((rule, ruleIndex) => {
            const redundant = broadTools.includes(rule.argvPrefix[0] ?? '');
            return (
              <fieldset
                key={ruleIndex}
                style={{
                  margin: 0,
                  padding: theme.spacing[3],
                  border: `1px solid ${theme.color.border.DEFAULT}`,
                  borderRadius: theme.radius.md,
                  minWidth: 0,
                }}
              >
                <legend
                  style={{
                    padding: `0 ${theme.spacing[1]}`,
                    color: theme.color.text.muted,
                    fontSize: theme.font.size.xs,
                  }}
                >
                  Shell command {ruleIndex + 1}
                </legend>
                <Stack gap={3}>
                  <Stack direction="row" align="start" gap={2} wrap>
                    {rule.argvPrefix.map((token, tokenIndex) => (
                      <div
                        key={tokenIndex}
                        style={{
                          flex: tokenIndex < 2 ? '1 1 11rem' : '1 1 9rem',
                          minWidth: 0,
                        }}
                      >
                        <Input
                          size="sm"
                          label={
                            tokenIndex === 0
                              ? 'Executable'
                              : tokenIndex === 1
                                ? 'Subcommand'
                                : `Token ${tokenIndex + 1}`
                          }
                          value={token}
                          disabled={disabled}
                          placeholder={
                            tokenIndex === 0
                              ? 'gh'
                              : tokenIndex === 1
                                ? 'pr'
                                : 'view'
                          }
                          error={shellTokenError(token)}
                          onChange={(event) =>
                            updateToken(
                              ruleIndex,
                              tokenIndex,
                              event.target.value,
                            )
                          }
                        />
                        {tokenIndex >= 2 ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={disabled}
                            onClick={() => removeToken(ruleIndex, tokenIndex)}
                          >
                            Remove token
                          </Button>
                        ) : null}
                      </div>
                    ))}
                  </Stack>
                  <Stack direction="row" align="center" gap={2} wrap>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={disabled || rule.argvPrefix.length >= 8}
                      onClick={() => addToken(ruleIndex)}
                    >
                      Add token
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={disabled}
                      onClick={() =>
                        onChange(
                          shellCommands.filter(
                            (_candidate, index) => index !== ruleIndex,
                          ),
                        )
                      }
                    >
                      Remove shell command
                    </Button>
                  </Stack>
                  <Text
                    variant="caption"
                    style={{ fontFamily: theme.font.family.mono }}
                  >
                    {rule.argvPrefix.map((token) => token || '…').join(' › ')}
                    {' › …'}
                  </Text>
                  {redundant ? (
                    <div
                      role="status"
                      style={{
                        padding: theme.spacing[2],
                        borderRadius: theme.radius.md,
                        background: theme.color.warning.muted,
                        color: theme.color.warning.DEFAULT,
                      }}
                    >
                      <Text variant="caption">
                        The exact tool grant for “{rule.argvPrefix[0]}” already
                        permits every invocation, so this scoped rule is
                        redundant.
                      </Text>
                    </div>
                  ) : null}
                </Stack>
              </fieldset>
            );
          })}
        </Stack>
      )}
    </Stack>
  );
}

function policyToForm(policy: RuntimePolicyWithTools): PolicyForm {
  return {
    name: policy.name,
    description: policy.description ?? '',
    tools: [...policy.tools],
    shellCommands: policy.shellCommands.map((rule) => ({
      argvPrefix: [...rule.argvPrefix],
    })),
  };
}

function policyUpdateBody(
  policy: RuntimePolicyWithTools | undefined,
  form: PolicyForm,
) {
  const previousTools = new Set(policy?.tools ?? []);
  const nextTools = new Set(form.tools);
  const previousShellCommands = new Map(
    (policy?.shellCommands ?? []).map((rule) => [shellCommandKey(rule), rule]),
  );
  const nextShellCommands = new Map(
    normalizeFormShellCommands(form.shellCommands).map((rule) => [
      shellCommandKey(rule),
      rule,
    ]),
  );
  return {
    name: form.name.trim(),
    description: form.description.trim() || null,
    addTools: form.tools.filter((tool) => !previousTools.has(tool)),
    removeTools: [...previousTools].filter((tool) => !nextTools.has(tool)),
    addShellCommands: [...nextShellCommands]
      .filter(([key]) => !previousShellCommands.has(key))
      .map(([, rule]) => rule),
    removeShellCommands: [...previousShellCommands]
      .filter(([key]) => !nextShellCommands.has(key))
      .map(([, rule]) => rule),
  };
}

function normalizeFormShellCommands(
  rules: ShellCommandRule[],
): ShellCommandRule[] {
  const unique = new Map<string, ShellCommandRule>();
  for (const rule of rules) {
    const normalized = {
      argvPrefix: rule.argvPrefix.map((token) => token.trim()),
    };
    unique.set(shellCommandKey(normalized), normalized);
  }
  return [...unique.values()].sort((left, right) =>
    shellCommandKey(left).localeCompare(shellCommandKey(right)),
  );
}

function shellCommandKey(rule: ShellCommandRule): string {
  return JSON.stringify(rule.argvPrefix);
}

function shellTokenError(token: string): string | undefined {
  if (!token.trim()) return 'Enter a literal token.';
  if ([...token].length > 128) return 'Use 128 characters or fewer.';
  if (/\p{Cc}/u.test(token)) return 'Control characters are not allowed.';
  return undefined;
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
