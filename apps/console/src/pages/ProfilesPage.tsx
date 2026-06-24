import {
  createRuntimeProfile,
  type CreateRuntimeProfileBody,
  deleteRuntimeProfile,
  type RuntimeModel,
  type RuntimeProfile,
  type RuntimeProfileContext,
  type RuntimeProfileSandbox,
  updateRuntimeProfile,
} from '@moltnet/api-client';
import {
  listRuntimeModelsOptions,
  listRuntimeProfilesOptions,
} from '@moltnet/api-client/query';
import { useQuery } from '@tanstack/react-query';
import {
  Button,
  Card,
  Stack,
  Text,
  Tooltip,
  useTheme,
} from '@themoltnet/design-system';
import { type ChangeEvent, useEffect, useMemo, useState } from 'react';

import { getApiClient } from '../api.js';
import { useIsMobile } from '../hooks/useIsMobile.js';
import { useTeam } from '../team/useTeam.js';

interface ProfileFormState {
  name: string;
  description: string;
  provider: string;
  model: string;
  sandboxJson: string;
  sessionTtlSec: string;
  workspaceTtlSec: string;
  leaseTtlSec: string;
  heartbeatIntervalMs: string;
  maxBatchSize: string;
  requiredEnv: string;
  requiredTools: string;
  contextJson: string;
}

const EMPTY_FORM: ProfileFormState = {
  name: '',
  description: '',
  provider: '',
  model: '',
  sandboxJson: '{}',
  sessionTtlSec: '1800',
  workspaceTtlSec: '1800',
  leaseTtlSec: '300',
  heartbeatIntervalMs: '60000',
  maxBatchSize: '50',
  requiredEnv: '',
  requiredTools: '',
  contextJson: '[]',
};

const RUNTIME_PROFILE_DOCS_HREF =
  'https://docs.themolt.net/use/agent-daemon.html#remote-runtime-profiles';
const NEW_PROFILE_ID = '__new_runtime_profile__';

const FIELD_HELP = {
  sessionTtlSec:
    'Maximum lifetime for one warm agent session before the daemon starts a fresh executor context.',
  workspaceTtlSec:
    'Maximum lifetime for the profile workspace. Warm sessions are capped by the lower of session TTL and workspace TTL.',
  leaseTtlSec:
    'Task claim lease duration sent to the API. The daemon must heartbeat before this expires or the task can be reclaimed.',
  heartbeatIntervalMs:
    'How often the daemon sends heartbeat and progress batches while a task is running.',
  maxBatchSize:
    'Maximum buffered runtime events sent in one progress flush before the reporter flushes immediately.',
  requiredEnv:
    'Comma-separated environment variables that must be present before this daemon can run the profile.',
  requiredTools:
    'Comma-separated executables or paths that must be available before this daemon can run the profile.',
  sandboxJson:
    'Pi sandbox policy for the runtime, including filesystem/network rules passed to the executor.',
  contextJson:
    'Context entries injected into tasks that use this profile, such as skills, prompt prefixes, or inline context blocks.',
} as const;

export function ProfilesPage() {
  const theme = useTheme();
  const isMobile = useIsMobile();
  const { selectedTeam, error: teamError, refreshTeams } = useTeam();
  const teamId = selectedTeam?.id;
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(
    null,
  );
  const [form, setForm] = useState<ProfileFormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const profilesQuery = useQuery({
    ...listRuntimeProfilesOptions({
      client: getApiClient(),
      headers: { 'x-moltnet-team-id': teamId ?? '' },
    }),
    enabled: Boolean(teamId),
  });
  const modelsQuery = useQuery({
    ...listRuntimeModelsOptions({
      client: getApiClient(),
      headers: { 'x-moltnet-team-id': teamId ?? '' },
    }),
    enabled: Boolean(teamId),
  });

  const profiles = useMemo(
    () => profilesQuery.data?.items ?? [],
    [profilesQuery.data],
  );
  const runtimeModels = useMemo(
    () => modelsQuery.data?.items ?? [],
    [modelsQuery.data],
  );
  const selectedProfile = profiles.find((p) => p.id === selectedProfileId);
  const isEditing = selectedProfile !== undefined;

  useEffect(() => {
    setSelectedProfileId(null);
    setForm(EMPTY_FORM);
    setFormError(null);
  }, [teamId]);

  useEffect(() => {
    if (
      profilesQuery.data &&
      selectedProfileId &&
      selectedProfileId !== NEW_PROFILE_ID &&
      !profiles.some((profile) => profile.id === selectedProfileId)
    ) {
      setSelectedProfileId(profiles[0]?.id ?? null);
      if (profiles.length === 0) {
        setForm(EMPTY_FORM);
        setFormError(null);
      }
    }
  }, [profiles, profilesQuery.data, selectedProfileId]);

  useEffect(() => {
    if (!selectedProfileId && profiles.length > 0) {
      setSelectedProfileId(profiles[0].id);
    }
  }, [profiles, selectedProfileId]);

  useEffect(() => {
    if (selectedProfile) {
      setForm(profileToForm(selectedProfile));
      setFormError(null);
    }
  }, [selectedProfile]);

  const providers = useMemo(
    () =>
      [...new Set(runtimeModels.map((model) => model.provider))].sort((a, b) =>
        a.localeCompare(b),
      ),
    [runtimeModels],
  );
  const modelOptions = useMemo(
    () =>
      runtimeModels
        .filter((candidate) =>
          form.provider ? candidate.provider === form.provider : true,
        )
        .sort(compareRuntimeModels),
    [runtimeModels, form.provider],
  );

  function updateField<K extends keyof ProfileFormState>(
    field: K,
    value: ProfileFormState[K],
  ) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function startNewProfile() {
    setSelectedProfileId(NEW_PROFILE_ID);
    setForm(EMPTY_FORM);
    setFormError(null);
  }

  async function saveProfile() {
    if (!teamId) return;
    setFormError(null);
    setIsSaving(true);
    try {
      const body = buildProfileBody(form);
      const result = isEditing
        ? await updateRuntimeProfile({
            client: getApiClient(),
            path: { profileId: selectedProfile.id },
            body,
          })
        : await createRuntimeProfile({
            client: getApiClient(),
            headers: { 'x-moltnet-team-id': teamId },
            body: body,
          });
      if (result.error || !result.data) {
        throw new Error(getApiErrorDetail(result.error));
      }
      await profilesQuery.refetch();
      setSelectedProfileId(result.data.id);
      setForm(profileToForm(result.data));
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : 'Failed to save runtime profile',
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function removeProfile() {
    if (!selectedProfile) return;
    setFormError(null);
    setIsDeleting(true);
    try {
      const result = await deleteRuntimeProfile({
        client: getApiClient(),
        path: { profileId: selectedProfile.id },
      });
      if (result.error) throw new Error(getApiErrorDetail(result.error));
      setSelectedProfileId(null);
      setForm(EMPTY_FORM);
      await profilesQuery.refetch();
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : 'Failed to delete runtime profile',
      );
    } finally {
      setIsDeleting(false);
    }
  }

  if (teamError) {
    return (
      <Card style={{ padding: '1.5rem' }}>
        <Stack gap={3}>
          <Text variant="h4">Team scope unavailable</Text>
          <Text color="muted">
            Runtime profiles require an active team scope.
          </Text>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void refreshTeams()}
          >
            Retry team load
          </Button>
        </Stack>
      </Card>
    );
  }

  if (!teamId) {
    return <Text color="muted">Select a team to manage runtime profiles.</Text>;
  }

  return (
    <Stack gap={6}>
      <Stack
        direction="row"
        align="center"
        justify="space-between"
        gap={4}
        wrap
      >
        <Stack gap={1}>
          <Text variant="h2">Runtime profiles</Text>
          <Text color="muted">
            Configure reusable daemon runtimes for {selectedTeam?.name}.
          </Text>
        </Stack>
        <Button size="sm" onClick={startNewProfile}>
          New profile
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
        <Stack gap={3}>
          {profilesQuery.isLoading ? (
            <Text color="muted">Loading profiles...</Text>
          ) : profilesQuery.error ? (
            <Card style={{ padding: '1rem' }}>
              <Stack gap={2}>
                <Text color="muted">Failed to load profiles.</Text>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void profilesQuery.refetch()}
                >
                  Retry
                </Button>
              </Stack>
            </Card>
          ) : profiles.length === 0 ? (
            <Card style={{ padding: '1rem' }}>
              <Text color="muted">No runtime profiles yet.</Text>
            </Card>
          ) : (
            profiles.map((profile) => {
              const active = profile.id === selectedProfileId;
              return (
                <button
                  key={profile.id}
                  type="button"
                  onClick={() => setSelectedProfileId(profile.id)}
                  aria-current={active ? 'true' : undefined}
                  style={{
                    cursor: 'pointer',
                    textAlign: 'left',
                    border: `1px solid ${
                      active
                        ? theme.color.accent.DEFAULT
                        : theme.color.border.DEFAULT
                    }`,
                    background: theme.color.bg.surface,
                    borderRadius: theme.radius.md,
                    padding: theme.spacing[3],
                    color: theme.color.text.DEFAULT,
                  }}
                >
                  <Stack gap={1}>
                    <Text variant="h4">{profile.name}</Text>
                    <Text variant="caption" color="muted">
                      {profile.provider}/{profile.model}
                    </Text>
                    <Text variant="caption" color="muted">
                      revision {profile.revision}
                    </Text>
                  </Stack>
                </button>
              );
            })
          )}
        </Stack>

        <Card style={{ padding: '1.5rem' }}>
          <Stack gap={4}>
            <Stack gap={1}>
              <Text variant="h3">
                {isEditing ? `Edit ${selectedProfile.name}` : 'New profile'}
              </Text>
              <Text color="muted">
                Profiles pin provider, model, sandbox policy, and daemon
                prerequisites.
              </Text>
              <a
                href={RUNTIME_PROFILE_DOCS_HREF}
                target="_blank"
                rel="noreferrer"
                style={{
                  color: theme.color.accent.DEFAULT,
                  fontSize: theme.font.size.sm,
                  width: 'fit-content',
                }}
              >
                Runtime profile docs
              </a>
            </Stack>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: theme.spacing[3],
              }}
            >
              <LabeledInput
                label="Name"
                value={form.name}
                onChange={(value) => updateField('name', value)}
                required
              />
              <LabeledInput
                label="Provider"
                value={form.provider}
                onChange={(value) => updateField('provider', value)}
                list="runtime-profile-provider-options"
                required
              />
              <LabeledInput
                label="Model"
                value={form.model}
                onChange={(value) => updateField('model', value)}
                list="runtime-profile-model-options"
                required
              />
            </div>

            <datalist id="runtime-profile-provider-options">
              {providers.map((provider) => (
                <option key={provider} value={provider} />
              ))}
            </datalist>
            <datalist id="runtime-profile-model-options">
              {modelOptions.map((model) => (
                <option
                  key={`${model.provider}/${model.model}`}
                  value={model.model}
                >
                  {formatRuntimeModel(model)}
                </option>
              ))}
            </datalist>

            <LabeledInput
              label="Description"
              value={form.description}
              onChange={(value) => updateField('description', value)}
            />

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                gap: theme.spacing[3],
              }}
            >
              <LabeledInput
                label="Session TTL seconds"
                help={FIELD_HELP.sessionTtlSec}
                value={form.sessionTtlSec}
                onChange={(value) => updateField('sessionTtlSec', value)}
                type="number"
              />
              <LabeledInput
                label="Workspace TTL seconds"
                help={FIELD_HELP.workspaceTtlSec}
                value={form.workspaceTtlSec}
                onChange={(value) => updateField('workspaceTtlSec', value)}
                type="number"
              />
              <LabeledInput
                label="Lease TTL seconds"
                help={FIELD_HELP.leaseTtlSec}
                value={form.leaseTtlSec}
                onChange={(value) => updateField('leaseTtlSec', value)}
                type="number"
              />
              <LabeledInput
                label="Heartbeat interval ms"
                help={FIELD_HELP.heartbeatIntervalMs}
                value={form.heartbeatIntervalMs}
                onChange={(value) => updateField('heartbeatIntervalMs', value)}
                type="number"
              />
              <LabeledInput
                label="Max batch size"
                help={FIELD_HELP.maxBatchSize}
                value={form.maxBatchSize}
                onChange={(value) => updateField('maxBatchSize', value)}
                type="number"
              />
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: theme.spacing[3],
              }}
            >
              <LabeledInput
                label="Required env"
                help={FIELD_HELP.requiredEnv}
                value={form.requiredEnv}
                onChange={(value) => updateField('requiredEnv', value)}
                placeholder="ANTHROPIC_API_KEY, GITHUB_TOKEN"
              />
              <LabeledInput
                label="Required tools"
                help={FIELD_HELP.requiredTools}
                value={form.requiredTools}
                onChange={(value) => updateField('requiredTools', value)}
                placeholder="git, gh, pnpm"
              />
            </div>

            <LabeledTextarea
              label="Sandbox JSON"
              help={FIELD_HELP.sandboxJson}
              value={form.sandboxJson}
              onChange={(value) => updateField('sandboxJson', value)}
              rows={8}
            />
            <LabeledTextarea
              label="Context JSON"
              help={FIELD_HELP.contextJson}
              value={form.contextJson}
              onChange={(value) => updateField('contextJson', value)}
              rows={5}
            />

            {formError ? (
              <Text
                variant="caption"
                style={{ color: theme.color.error.DEFAULT }}
              >
                {formError}
              </Text>
            ) : null}

            <Stack direction="row" justify="space-between" gap={3} wrap>
              <div>
                {isEditing ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void removeProfile()}
                    disabled={isDeleting || isSaving}
                  >
                    {isDeleting ? 'Deleting...' : 'Delete profile'}
                  </Button>
                ) : null}
              </div>
              <Stack direction="row" gap={2}>
                <Button variant="ghost" size="sm" onClick={startNewProfile}>
                  Reset
                </Button>
                <Button
                  size="sm"
                  onClick={() => void saveProfile()}
                  disabled={isSaving || !form.name.trim()}
                >
                  {isSaving
                    ? 'Saving...'
                    : isEditing
                      ? 'Save profile'
                      : 'Create profile'}
                </Button>
              </Stack>
            </Stack>
          </Stack>
        </Card>
      </div>
    </Stack>
  );
}

function LabeledInput({
  label,
  help,
  value,
  onChange,
  list,
  placeholder,
  required = false,
  type = 'text',
}: {
  label: string;
  help?: string;
  value: string;
  onChange: (value: string) => void;
  list?: string;
  placeholder?: string;
  required?: boolean;
  type?: 'number' | 'text';
}) {
  const theme = useTheme();
  return (
    <label style={{ display: 'grid', gap: theme.spacing[1] }}>
      <FieldLabel label={label} help={help} required={required} />
      <input
        aria-label={label}
        value={value}
        type={type}
        list={list}
        placeholder={placeholder}
        onChange={(event: ChangeEvent<HTMLInputElement>) =>
          onChange(event.target.value)
        }
        style={fieldStyle(theme)}
      />
    </label>
  );
}

function LabeledTextarea({
  label,
  help,
  value,
  onChange,
  rows,
}: {
  label: string;
  help?: string;
  value: string;
  onChange: (value: string) => void;
  rows: number;
}) {
  const theme = useTheme();
  return (
    <label style={{ display: 'grid', gap: theme.spacing[1] }}>
      <FieldLabel label={label} help={help} />
      <textarea
        aria-label={label}
        value={value}
        rows={rows}
        onChange={(event) => onChange(event.target.value)}
        style={{
          ...fieldStyle(theme),
          fontFamily: theme.font.family.mono,
          resize: 'vertical',
        }}
      />
    </label>
  );
}

function FieldLabel({
  label,
  help,
  required = false,
}: {
  label: string;
  help?: string;
  required?: boolean;
}) {
  const theme = useTheme();
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: theme.spacing[1],
        minWidth: 0,
      }}
    >
      <Text variant="caption" color="muted">
        {label}
        {required ? (
          <span style={{ color: theme.color.accent.DEFAULT }}> *</span>
        ) : null}
      </Text>
      {help ? (
        <Tooltip content={help} placement="top">
          <button
            type="button"
            aria-label={`Help: ${label}`}
            onClick={(event) => event.preventDefault()}
            style={helpButtonStyle(theme)}
          >
            ?
          </button>
        </Tooltip>
      ) : null}
    </span>
  );
}

function helpButtonStyle(
  theme: ReturnType<typeof useTheme>,
): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '1rem',
    height: '1rem',
    borderRadius: '999px',
    border: `1px solid ${theme.color.border.DEFAULT}`,
    background: theme.color.bg.surface,
    color: theme.color.text.muted,
    cursor: 'help',
    fontSize: theme.font.size.xs,
    lineHeight: 1,
    padding: 0,
  };
}

function fieldStyle(theme: ReturnType<typeof useTheme>): React.CSSProperties {
  return {
    width: '100%',
    padding: `${theme.spacing[2]} ${theme.spacing[3]}`,
    borderRadius: theme.radius.md,
    border: `1px solid ${theme.color.border.DEFAULT}`,
    background: theme.color.bg.surface,
    color: theme.color.text.DEFAULT,
    fontSize: theme.font.size.sm,
  };
}

function profileToForm(profile: RuntimeProfile): ProfileFormState {
  return {
    name: profile.name,
    description: profile.description ?? '',
    provider: profile.provider,
    model: profile.model,
    sandboxJson: JSON.stringify(profile.sandbox, null, 2),
    sessionTtlSec: String(profile.sessionTtlSec),
    workspaceTtlSec: String(profile.workspaceTtlSec),
    leaseTtlSec: String(profile.leaseTtlSec),
    heartbeatIntervalMs: String(profile.heartbeatIntervalMs),
    maxBatchSize: String(profile.maxBatchSize),
    requiredEnv: profile.requiredEnv.join(', '),
    requiredTools: profile.requiredTools.join(', '),
    contextJson: JSON.stringify(profile.context, null, 2),
  };
}

function buildProfileBody(form: ProfileFormState): CreateRuntimeProfileBody {
  const sandbox = parseJson<RuntimeProfileSandbox>(
    form.sandboxJson,
    'Sandbox JSON',
  );
  const context = parseJson<RuntimeProfileContext[]>(
    form.contextJson,
    'Context JSON',
  );
  if (!Array.isArray(context)) {
    throw new Error('Context JSON must be an array.');
  }
  return {
    name: requireText(form.name, 'Name'),
    ...(form.description.trim()
      ? { description: form.description.trim() }
      : {}),
    provider: requireText(form.provider, 'Provider'),
    model: requireText(form.model, 'Model'),
    runtimeKind: 'gondolin_pi',
    sandbox,
    sessionStorageMode: 'local',
    workspaceStorageMode: 'local',
    sessionTtlSec: parsePositiveInt(form.sessionTtlSec, 'Session TTL seconds'),
    workspaceTtlSec: parsePositiveInt(
      form.workspaceTtlSec,
      'Workspace TTL seconds',
    ),
    leaseTtlSec: parsePositiveInt(form.leaseTtlSec, 'Lease TTL seconds'),
    heartbeatIntervalMs: parseNonNegativeInt(
      form.heartbeatIntervalMs,
      'Heartbeat interval ms',
    ),
    maxBatchSize: parsePositiveInt(form.maxBatchSize, 'Max batch size'),
    requiredEnv: parseCsv(form.requiredEnv),
    requiredTools: parseCsv(form.requiredTools),
    context,
  };
}

function parseJson<T>(value: string, label: string): T {
  try {
    return JSON.parse(value) as T;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`${label} is invalid JSON: ${message}`);
  }
}

function requireText(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} is required.`);
  return trimmed;
}

function parseCsv(value: string): string[] {
  return [
    ...new Set(
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

function parsePositiveInt(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

function parseNonNegativeInt(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return parsed;
}

function compareRuntimeModels(a: RuntimeModel, b: RuntimeModel): number {
  return a.provider.localeCompare(b.provider) || a.model.localeCompare(b.model);
}

function formatRuntimeModel(model: RuntimeModel): string {
  return model.displayName
    ? `${model.provider}/${model.model} - ${model.displayName}`
    : `${model.provider}/${model.model}`;
}

function getApiErrorDetail(error: unknown): string {
  if (error && typeof error === 'object' && 'detail' in error) {
    return String((error as { detail?: unknown }).detail);
  }
  return 'Runtime profile request failed';
}
