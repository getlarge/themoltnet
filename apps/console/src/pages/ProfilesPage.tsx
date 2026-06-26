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
import {
  type ChangeEvent,
  Fragment,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { getApiClient } from '../api.js';
import { useIsMobile } from '../hooks/useIsMobile.js';
import { useTeam } from '../team/useTeam.js';

type RuntimeProfileWorkspaceMode =
  | 'none'
  | 'shared_mount'
  | 'dedicated_worktree';
type RuntimeProfileThinkingLevel =
  | 'off'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh';
type RuntimeProfileListItem = Omit<RuntimeProfile, 'thinkingLevel'> &
  Partial<Pick<RuntimeProfile, 'thinkingLevel'>>;

interface ProfileFormState {
  name: string;
  description: string;
  provider: string;
  model: string;
  thinkingLevel: RuntimeProfileThinkingLevel | '';
  temperature: string;
  topP: string;
  topK: string;
  maxOutputTokens: string;
  sandboxJson: string;
  sessionTtlSec: string;
  workspaceTtlSec: string;
  leaseTtlSec: string;
  heartbeatIntervalMs: string;
  maxBatchSize: string;
  maxTurns: string;
  maxBashTimeouts: string;
  defaultWorkspaceMode: RuntimeProfileWorkspaceMode | '';
  allowedWorkspaceModes: RuntimeProfileWorkspaceMode[];
  requiredEnv: string;
  requiredTools: string;
  contextJson: string;
}

const EMPTY_FORM: ProfileFormState = {
  name: '',
  description: '',
  provider: '',
  model: '',
  thinkingLevel: '',
  temperature: '',
  topP: '',
  topK: '',
  maxOutputTokens: '',
  sandboxJson: '{}',
  sessionTtlSec: '1800',
  workspaceTtlSec: '1800',
  leaseTtlSec: '300',
  heartbeatIntervalMs: '60000',
  maxBatchSize: '50',
  maxTurns: '0',
  maxBashTimeouts: '3',
  defaultWorkspaceMode: '',
  allowedWorkspaceModes: ['none', 'shared_mount', 'dedicated_worktree'],
  requiredEnv: '',
  requiredTools: '',
  contextJson: '[]',
};

const RUNTIME_PROFILE_DOCS_HREF =
  'https://docs.themolt.net/use/agent-daemon.html#remote-runtime-profiles';
const NEW_PROFILE_ID = '__new_runtime_profile__';
const CONTEXT_JSON_EXAMPLE = JSON.stringify(
  [
    {
      slug: 'repo-rules',
      binding: 'skill',
      content:
        '---\nname: repo-rules\ndescription: Repository operating rules\n---\nUse pnpm and Nx. Keep migrations and generated clients in sync.',
    },
    {
      slug: 'api-contract',
      binding: 'context_inline',
      content:
        'Preserve backward-compatible response shapes unless the task explicitly asks for a breaking API change.',
    },
  ],
  null,
  2,
);

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
  maxTurns:
    'Maximum tool-use turns allowed for one attempt. Use 0 to disable the profile default.',
  maxBashTimeouts:
    'Maximum bash tool timeouts allowed before the daemon stops the attempt. Use 0 to disable.',
  thinkingLevel:
    'Reasoning/thinking effort applied when the Pi session starts. Leave unset to use the agent default.',
  temperature:
    'Sampling temperature. Leave blank for provider default. Lower is more deterministic; higher is more varied.',
  topP: 'Nucleus sampling probability mass. Leave blank for provider default. Usually tune temperature or top-p, not both.',
  topK: 'Top-k sampling cutoff. Leave blank for provider default. Applied only to providers that support top-k.',
  maxOutputTokens:
    'Maximum generated output tokens. Leave blank for provider/model default.',
  defaultWorkspaceMode:
    'Workspace mode this profile chooses when a task does not request one. Task type defaults apply when unset.',
  allowedWorkspaceModes:
    'Workspace modes this profile may use. Task requests outside this set are ignored, and task defaults outside this set are replaced with the safest allowed mode.',
  requiredEnv:
    'Comma-separated environment variables that must be present before this daemon can run the profile.',
  requiredTools:
    'Comma-separated executables or paths that must be available before this daemon can run the profile.',
  sandboxJson:
    'Pi sandbox policy for the runtime, including filesystem/network rules passed to the executor.',
  contextJson:
    'Optional context entries injected into every task that uses this profile. Use skill for Pi skills, context_inline for workspace context files, prompt_prefix for system/task prompt prefixing, or user_inline for user prompt suffixing.',
} as const;

const CONTEXT_BINDINGS: Array<{ binding: string; delivery: string }> = [
  {
    binding: 'skill',
    delivery: 'temporary Pi skill advertised in available skills',
  },
  {
    binding: 'context_inline',
    delivery: 'workspace context files plus context-pack.md and AGENTS.md',
  },
  {
    binding: 'prompt_prefix',
    delivery: 'prepended before the runtime/task prompt',
  },
  {
    binding: 'user_inline',
    delivery: 'appended to the task user prompt',
  },
];

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
    () => (profilesQuery.data?.items ?? []).map(normalizeRuntimeProfile),
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
              <LabeledSelect
                label="Thinking level"
                help={FIELD_HELP.thinkingLevel}
                value={form.thinkingLevel}
                onChange={(value) =>
                  updateField(
                    'thinkingLevel',
                    value as ProfileFormState['thinkingLevel'],
                  )
                }
                options={[
                  { value: '', label: 'Agent default' },
                  { value: 'off', label: 'Off' },
                  { value: 'minimal', label: 'Minimal' },
                  { value: 'low', label: 'Low' },
                  { value: 'medium', label: 'Medium' },
                  { value: 'high', label: 'High' },
                  { value: 'xhigh', label: 'Extra high' },
                ]}
              />
              <LabeledInput
                label="Temperature"
                help={FIELD_HELP.temperature}
                value={form.temperature}
                onChange={(value) => updateField('temperature', value)}
                inputMode="decimal"
                placeholder="Provider default"
              />
              <LabeledInput
                label="Top-p"
                help={FIELD_HELP.topP}
                value={form.topP}
                onChange={(value) => updateField('topP', value)}
                inputMode="decimal"
                placeholder="Provider default"
              />
              <LabeledInput
                label="Top-k"
                help={FIELD_HELP.topK}
                value={form.topK}
                onChange={(value) => updateField('topK', value)}
                inputMode="numeric"
                placeholder="Provider default"
              />
              <LabeledInput
                label="Max output tokens"
                help={FIELD_HELP.maxOutputTokens}
                value={form.maxOutputTokens}
                onChange={(value) => updateField('maxOutputTokens', value)}
                inputMode="numeric"
                placeholder="Provider default"
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
              <LabeledInput
                label="Max turns"
                help={FIELD_HELP.maxTurns}
                value={form.maxTurns}
                onChange={(value) => updateField('maxTurns', value)}
                type="number"
              />
              <LabeledInput
                label="Max bash timeouts"
                help={FIELD_HELP.maxBashTimeouts}
                value={form.maxBashTimeouts}
                onChange={(value) => updateField('maxBashTimeouts', value)}
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
              <LabeledSelect
                label="Default workspace mode"
                help={FIELD_HELP.defaultWorkspaceMode}
                value={form.defaultWorkspaceMode}
                onChange={(value) =>
                  updateField(
                    'defaultWorkspaceMode',
                    value as ProfileFormState['defaultWorkspaceMode'],
                  )
                }
                options={[
                  { value: '', label: 'Task type default' },
                  { value: 'none', label: 'None' },
                  { value: 'shared_mount', label: 'Shared mount' },
                  { value: 'dedicated_worktree', label: 'Dedicated worktree' },
                ]}
              />
              <WorkspaceModeChecklist
                label="Allowed workspace modes"
                help={FIELD_HELP.allowedWorkspaceModes}
                value={form.allowedWorkspaceModes}
                onChange={(value) =>
                  updateField('allowedWorkspaceModes', value)
                }
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
              label="Injected context"
              help={FIELD_HELP.contextJson}
              value={form.contextJson}
              onChange={(value) => updateField('contextJson', value)}
              rows={5}
            />
            <ContextReference
              onInsertExample={() =>
                updateField('contextJson', CONTEXT_JSON_EXAMPLE)
              }
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

function ContextReference({
  onInsertExample,
}: {
  onInsertExample: () => void;
}) {
  const theme = useTheme();
  return (
    <div
      style={{
        display: 'grid',
        gap: theme.spacing[2],
        border: `1px solid ${theme.color.border.DEFAULT}`,
        borderRadius: theme.radius.md,
        padding: theme.spacing[3],
        background: theme.color.bg.surface,
      }}
    >
      <Stack
        direction="row"
        justify="space-between"
        align="center"
        gap={2}
        wrap
      >
        <Text variant="caption" color="muted">
          Context entries are optional. Each entry needs slug, binding, and
          content.
        </Text>
        <Button variant="secondary" size="sm" onClick={onInsertExample}>
          Insert example
        </Button>
      </Stack>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(8rem, 0.4fr) minmax(12rem, 1fr)',
          gap: theme.spacing[2],
          fontSize: theme.font.size.sm,
        }}
      >
        {CONTEXT_BINDINGS.map((item) => (
          <Fragment key={item.binding}>
            <code style={{ color: theme.color.text.DEFAULT }}>
              {item.binding}
            </code>
            <Text variant="caption">{item.delivery}</Text>
          </Fragment>
        ))}
      </div>
    </div>
  );
}

function LabeledSelect({
  label,
  help,
  value,
  onChange,
  options,
}: {
  label: string;
  help?: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  const theme = useTheme();
  return (
    <label style={{ display: 'grid', gap: theme.spacing[1] }}>
      <FieldLabel label={label} help={help} />
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        style={fieldStyle(theme)}
      >
        {options.map((option) => (
          <option key={option.value || '__unset'} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

const WORKSPACE_MODE_OPTIONS: {
  value: RuntimeProfileWorkspaceMode;
  label: string;
}[] = [
  { value: 'none', label: 'None' },
  { value: 'shared_mount', label: 'Shared mount' },
  { value: 'dedicated_worktree', label: 'Dedicated worktree' },
];

function WorkspaceModeChecklist({
  label,
  help,
  value,
  onChange,
}: {
  label: string;
  help?: string;
  value: RuntimeProfileWorkspaceMode[];
  onChange: (value: RuntimeProfileWorkspaceMode[]) => void;
}) {
  const theme = useTheme();
  return (
    <fieldset
      style={{
        display: 'grid',
        gap: theme.spacing[2],
        border: 0,
        margin: 0,
        padding: 0,
      }}
    >
      <legend style={{ padding: 0 }}>
        <FieldLabel label={label} help={help} />
      </legend>
      <Stack direction="row" gap={2} wrap>
        {WORKSPACE_MODE_OPTIONS.map((option) => {
          const checked = value.includes(option.value);
          return (
            <label
              key={option.value}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: theme.spacing[1],
                border: `1px solid ${theme.color.border.DEFAULT}`,
                borderRadius: theme.radius.md,
                padding: `${theme.spacing[1]} ${theme.spacing[2]}`,
                fontSize: theme.font.size.sm,
                color: theme.color.text.DEFAULT,
              }}
            >
              <input
                type="checkbox"
                checked={checked}
                aria-label={`Allow ${option.label}`}
                onChange={(event) => {
                  const next = event.target.checked
                    ? [...value, option.value]
                    : value.filter((mode) => mode !== option.value);
                  onChange(
                    WORKSPACE_MODE_OPTIONS.map(
                      (candidate) => candidate.value,
                    ).filter((mode) => next.includes(mode)),
                  );
                }}
              />
              {option.label}
            </label>
          );
        })}
      </Stack>
    </fieldset>
  );
}

function LabeledInput({
  label,
  help,
  value,
  onChange,
  list,
  placeholder,
  inputMode,
  required = false,
  type = 'text',
}: {
  label: string;
  help?: string;
  value: string;
  onChange: (value: string) => void;
  list?: string;
  placeholder?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
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
        inputMode={inputMode}
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
    thinkingLevel: profile.thinkingLevel ?? '',
    temperature:
      profile.temperature === null ? '' : String(profile.temperature),
    topP: profile.topP === null ? '' : String(profile.topP),
    topK: profile.topK === null ? '' : String(profile.topK),
    maxOutputTokens:
      profile.maxOutputTokens === null ? '' : String(profile.maxOutputTokens),
    sandboxJson: JSON.stringify(profile.sandbox, null, 2),
    sessionTtlSec: String(profile.sessionTtlSec),
    workspaceTtlSec: String(profile.workspaceTtlSec),
    leaseTtlSec: String(profile.leaseTtlSec),
    heartbeatIntervalMs: String(profile.heartbeatIntervalMs),
    maxBatchSize: String(profile.maxBatchSize),
    maxTurns: String(profile.maxTurns),
    maxBashTimeouts: String(profile.maxBashTimeouts),
    defaultWorkspaceMode: profile.defaultWorkspaceMode ?? '',
    allowedWorkspaceModes: profile.allowedWorkspaceModes,
    requiredEnv: profile.requiredEnv.join(', '),
    requiredTools: profile.requiredTools.join(', '),
    contextJson: JSON.stringify(profile.context, null, 2),
  };
}

function normalizeRuntimeProfile(
  profile: RuntimeProfileListItem,
): RuntimeProfile {
  return {
    ...profile,
    thinkingLevel: profile.thinkingLevel ?? null,
    temperature: profile.temperature ?? null,
    topP: profile.topP ?? null,
    topK: profile.topK ?? null,
    maxOutputTokens: profile.maxOutputTokens ?? null,
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
  if (form.allowedWorkspaceModes.length === 0) {
    throw new Error('Allowed workspace modes must include at least one mode.');
  }
  if (
    form.defaultWorkspaceMode &&
    !form.allowedWorkspaceModes.includes(form.defaultWorkspaceMode)
  ) {
    throw new Error(
      'Default workspace mode must be included in allowed workspace modes.',
    );
  }
  return {
    name: requireText(form.name, 'Name'),
    ...(form.description.trim()
      ? { description: form.description.trim() }
      : {}),
    provider: requireText(form.provider, 'Provider'),
    model: requireText(form.model, 'Model'),
    thinkingLevel: form.thinkingLevel || null,
    temperature: parseOptionalNumber(form.temperature, 'Temperature', {
      min: 0,
      max: 2,
    }),
    topP: parseOptionalNumber(form.topP, 'Top-p', { min: 0, max: 1 }),
    topK: parseOptionalPositiveInt(form.topK, 'Top-k'),
    maxOutputTokens: parseOptionalPositiveInt(
      form.maxOutputTokens,
      'Max output tokens',
    ),
    runtimeKind: 'gondolin_pi',
    sandbox,
    sessionStorageMode: 'local',
    workspaceStorageMode: 'local',
    defaultWorkspaceMode: form.defaultWorkspaceMode || null,
    allowedWorkspaceModes: form.allowedWorkspaceModes,
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
    maxTurns: parseNonNegativeInt(form.maxTurns, 'Max turns'),
    maxBashTimeouts: parseNonNegativeInt(
      form.maxBashTimeouts,
      'Max bash timeouts',
    ),
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

function parseOptionalNumber(
  value: string,
  label: string,
  range: { min: number; max: number },
): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < range.min || parsed > range.max) {
    throw new Error(`${label} must be between ${range.min} and ${range.max}.`);
  }
  return parsed;
}

function parseOptionalPositiveInt(value: string, label: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${label} must be a positive integer.`);
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
