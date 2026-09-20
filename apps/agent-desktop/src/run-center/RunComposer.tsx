import { BUILT_IN_TASK_TYPES } from '@moltnet/tasks';
import {
  Badge,
  Button,
  ControlSurface,
  DescriptionList,
  Divider,
  InlineNotice,
  Input,
  Select,
  Stack,
  Text,
  useTheme,
} from '@themoltnet/design-system';
import { useEffect, useMemo, useState } from 'react';

import { relativeTime } from './format.js';
import type {
  AgentServerCatalogue,
  AgentServerCatalogueProfile,
  DesktopRun,
  RunCenterActions,
  RunCenterData,
} from './types.js';

/** The daemon's own task-type registry; no server round trip needed. */
const TASK_TYPE_OPTIONS = Object.keys(BUILT_IN_TASK_TYPES).sort();

export interface RunComposerProps {
  active?: boolean;
  previousRun?: DesktopRun;
  data: RunCenterData;
  actions: RunCenterActions;
  /** Prefills from a saved preset when set. */
  presetId: string | null;
  now: number;
  onTeams?: () => void;
  onDone: () => void;
}

export function RunComposer({
  active = true,
  previousRun,
  data,
  actions,
  presetId,
  now,
  onDone,
  onTeams,
}: RunComposerProps) {
  // Everything the composer offers comes from the server: identities from the
  // status surface, teams and profiles from the identity-scoped catalogue.
  const agents = data.status?.agents ?? [];
  const [catalogue, setCatalogue] = useState<AgentServerCatalogue | null>(
    data.catalogue,
  );
  const teams = catalogue?.teams ?? [];
  const taskTypeOptions = TASK_TYPE_OPTIONS;

  const preset = presetId
    ? (data.presets.find((candidate) => candidate.id === presetId) ?? null)
    : null;

  const [agent, setAgent] = useState(
    previousRun?.agent ??
      preset?.agent ??
      data.status?.selectedIdentity ??
      agents[0]?.agentName ??
      '',
  );
  const [teamId, setTeamId] = useState(
    previousRun?.teamId ??
      preset?.teamId ??
      data.catalogue?.defaultTeamId ??
      '',
  );
  const [primaryId, setPrimaryId] = useState(
    previousRun?.profiles[0] ?? preset?.profileIds[0] ?? '',
  );
  const [fallbackIds, setFallbackIds] = useState<string[]>(
    previousRun?.profiles.slice(1) ?? preset?.profileIds.slice(1) ?? [],
  );
  const [taskTypes, setTaskTypes] = useState<string[]>(
    previousRun?.taskTypes ?? preset?.taskTypes ?? ['freeform'],
  );
  const [advancedOpen, setAdvancedOpen] = useState(
    (previousRun?.profiles.length ?? preset?.profileIds.length ?? 0) > 1,
  );
  const [presetName, setPresetName] = useState(preset?.name ?? '');
  const [catalogueError, setCatalogueError] = useState<string | null>(null);
  const [catalogueLoading, setCatalogueLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    let current = true;
    setCatalogue(null);
    setCatalogueError(null);
    setCatalogueLoading(Boolean(agent));
    if (!agent) return;
    void actions.catalogue(agent).then(
      (value) => {
        if (!current) return;
        setCatalogue(value);
        setCatalogueLoading(false);
        setTeamId((selected) => selected || value.defaultTeamId || '');
      },
      () => {
        if (current) {
          setCatalogueLoading(false);
          setCatalogueError(
            'The catalogue could not be loaded. Try again to verify teams and profiles.',
          );
        }
      },
    );
    return () => {
      current = false;
    };
  }, [actions, agent, active, retry]);
  const profiles = useMemo(
    () =>
      (catalogue?.profiles ?? []).filter(
        (profile) => profile.teamId === teamId,
      ),
    [catalogue, teamId],
  );
  const selectedAgent = agents.find(
    (candidate) => candidate.agentName === agent,
  );
  const primary = profiles.find((candidate) => candidate.id === primaryId);
  const team = teams.find((candidate) => candidate.teamId === teamId);
  // Team and diary are one binding; the catalogue resolves the pair or leaves
  // it null when the operator must choose.
  const selectedTeamDiary = team?.defaultDiaryId ?? null;

  const boundElsewhere = Boolean(team && !team.available);

  const availableFallbacks = useMemo(
    () =>
      profiles.filter(
        (candidate) =>
          candidate.id !== primaryId && !fallbackIds.includes(candidate.id),
      ),
    [profiles, primaryId, fallbackIds],
  );

  const problems: string[] = [];
  if (!selectedAgent) problems.push('Choose an available identity.');
  if (catalogueLoading) problems.push('Loading teams and profiles…');
  if (catalogueError) problems.push('Retry the catalogue before starting.');
  if (!team?.available) problems.push('Verify an available team credential.');
  if (!teamId) problems.push('Choose a team.');
  if (!primaryId) problems.push('Choose a runtime profile.');
  if (taskTypes.length === 0) problems.push('Choose at least one task type.');
  if (boundElsewhere)
    problems.push(
      `${agent} is key-bound to another team and cannot claim work for ${team?.teamName ?? 'this team'}.`,
    );

  const canStart = problems.length === 0 && Boolean(primary?.ready);

  const start = async () => {
    setBusy(true);
    setSubmitError(null);
    try {
      await actions.startRun({
        agent,
        teamId,
        profiles: [primaryId, ...fallbackIds],
        taskTypes,
        mode: 'poll',
        ...(selectedTeamDiary ? { diaryId: selectedTeamDiary } : {}),
      });
      onDone();
    } catch (error) {
      setSubmitError(
        error instanceof Error
          ? error.message
          : 'The run could not be started. Check the Server view.',
      );
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setSaveMessage(null);
    try {
      await actions.savePreset({
        id: preset?.id ?? null,
        name: presetName.trim(),
        agent,
        teamId,
        diaryId: selectedTeamDiary,
        profileIds: [primaryId, ...fallbackIds],
        taskTypes,
      });
      setSaveMessage('Preset saved.');
    } catch (error) {
      setSaveMessage(
        error instanceof Error
          ? error.message
          : 'The preset could not be saved.',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Stack gap={6} style={{ maxWidth: '46rem' }}>
      <Stack gap={2}>
        <Button
          variant="ghost"
          size="sm"
          onClick={onDone}
          style={{ alignSelf: 'flex-start' }}
        >
          ← Runs
        </Button>
        <Text as="h1" variant="h4">
          {preset ? `Start “${preset.name}”` : 'New run'}
        </Text>
        <Text variant="caption" color="secondary">
          {preset
            ? `Saved on this Mac${preset.lastUsedAt ? `, last used ${relativeTime(preset.lastUsedAt, now)}` : ' and not used yet'}. Nothing starts until you press Start run.`
            : 'One worker process that claims matching tasks for a team until you stop it.'}
        </Text>
      </Stack>

      <ControlSurface padding="md" as="section">
        <Stack gap={5}>
          <div className="field-grid">
            <Select
              label="Identity"
              value={agent}
              onChange={(event) => {
                setAgent(event.target.value);
                setPrimaryId('');
                setFallbackIds([]);
              }}
              hint={
                selectedAgent?.fingerprint
                  ? `Agent key ${selectedAgent.fingerprint}`
                  : undefined
              }
            >
              {agents.map((candidate) => (
                <option key={candidate.agentName} value={candidate.agentName}>
                  {candidate.agentName}
                </option>
              ))}
            </Select>
            <Select
              label="Team"
              value={teamId}
              onChange={(event) => {
                setTeamId(event.target.value);
                setPrimaryId('');
                setFallbackIds([]);
              }}
              error={
                boundElsewhere
                  ? `${agent} cannot claim work for this team`
                  : undefined
              }
            >
              <option value="">Choose a team</option>
              {teams.map((candidate) => (
                <option key={candidate.teamId} value={candidate.teamId}>
                  {candidate.teamName}
                </option>
              ))}
            </Select>
          </div>

          {catalogueLoading ? (
            <div role="status">
              <Text>Loading teams and profiles…</Text>
            </div>
          ) : null}
          {catalogueError ? (
            <InlineNotice tone="error" title="Catalogue unavailable">
              {catalogueError}
              <Button
                variant="secondary"
                onClick={() => setRetry((value) => value + 1)}
              >
                Retry catalogue
              </Button>
            </InlineNotice>
          ) : null}
          {catalogue && teams.length === 0 ? (
            <InlineNotice tone="info" title="No teams found">
              This identity has no teams in this environment.
              <Button variant="ghost" onClick={onTeams}>
                Identity and teams
              </Button>
            </InlineNotice>
          ) : null}
          {catalogue &&
          teams.length > 0 &&
          (boundElsewhere || !teams.some((entry) => entry.available)) ? (
            <InlineNotice tone="warning" title="Team access needs attention">
              {team?.blockers.map((blocker) => blocker.message).join(' ') ||
                'Enroll this identity into a team before starting a run.'}
              <Button variant="ghost" onClick={onTeams}>
                Enroll or renew team access
              </Button>
            </InlineNotice>
          ) : null}

          <Divider style={{ margin: 0 }} />

          <Stack gap={3}>
            <Select
              label="Runtime profile"
              value={primaryId}
              onChange={(event) => {
                const selected = event.target.value;
                setPrimaryId(selected);
                setFallbackIds((ids) => ids.filter((id) => id !== selected));
              }}
              hint="Profiles are authored in Console. This is the policy the run executes under."
            >
              <option value="">Select a profile…</option>
              {profiles.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                  {candidate.ready ? '' : ' — not ready on this Mac'}
                </option>
              ))}
            </Select>
            {primary ? <ProfileInspector profile={primary} /> : null}
          </Stack>

          <Divider style={{ margin: 0 }} />

          <TaskTypePicker
            options={taskTypeOptions}
            selected={taskTypes}
            onChange={setTaskTypes}
          />

          <Divider style={{ margin: 0 }} />

          <Stack gap={2}>
            <Text variant="caption" color="muted">
              Mode
            </Text>
            <Stack direction="row" gap={2} align="center" wrap>
              <Badge variant="primary">poll</Badge>
              <Text variant="caption" color="secondary">
                Keeps claiming matching tasks until you stop it. The desktop app
                runs polling workers only.
              </Text>
            </Stack>
          </Stack>
        </Stack>
      </ControlSurface>

      <ControlSurface padding="none" as="section">
        <details
          className="detail-section"
          open={advancedOpen || undefined}
          onToggle={(event) =>
            setAdvancedOpen((event.target as HTMLDetailsElement).open)
          }
        >
          <summary>
            <span>
              <Text as="span" variant="h4">
                Advanced
              </Text>
              <Text as="span" variant="caption" color="muted">
                {fallbackIds.length
                  ? `${fallbackIds.length} fallback profile${fallbackIds.length === 1 ? '' : 's'}`
                  : 'Fallback profiles'}
              </Text>
            </span>
          </summary>
          <Stack className="detail-content" gap={4}>
            <Text variant="caption" color="secondary">
              If the primary profile cannot run — its provider key is missing,
              its runtime kind is not registered — the worker tries these in
              order instead of failing the task.
            </Text>
            <FallbackList
              profiles={profiles}
              fallbackIds={fallbackIds}
              available={availableFallbacks}
              onChange={setFallbackIds}
            />
          </Stack>
        </details>
      </ControlSurface>

      {primary && !primary.ready ? (
        <InlineNotice
          tone="error"
          title={`${primary.name} cannot run on this Mac`}
        >
          <Stack gap={2}>
            {primary.blockers.map((blocker) => (
              <Text key={blocker.code} variant="caption">
                {blocker.message} {blocker.remedy}
              </Text>
            ))}
          </Stack>
        </InlineNotice>
      ) : null}

      {submitError ? (
        <InlineNotice tone="error" title="The run did not start">
          {submitError}
        </InlineNotice>
      ) : null}

      <ControlSurface padding="md" as="section">
        <Stack gap={4}>
          <Input
            label="Preset name"
            value={presetName}
            placeholder="Nightly digest"
            onChange={(event) => setPresetName(event.target.value)}
          />
          <Text variant="caption" color="muted">
            Saved on this Mac. Starting a run does not change saved presets.
          </Text>
          <Button
            variant="secondary"
            disabled={!canStart || !presetName.trim()}
            loading={saving}
            onClick={() => void save()}
          >
            {preset ? 'Update preset' : 'Save preset'}
          </Button>
          {saveMessage ? (
            <div role="status">
              <Text variant="caption">{saveMessage}</Text>
            </div>
          ) : null}
        </Stack>
      </ControlSurface>

      <Stack
        direction="row"
        justify="space-between"
        align="center"
        gap={4}
        wrap
      >
        <Stack gap={1}>
          {problems.length ? (
            <Text variant="caption" color="error">
              {problems[0]}
            </Text>
          ) : (
            <Text variant="caption" color="muted">
              Starts one worker process on this machine.
            </Text>
          )}
        </Stack>
        <Stack direction="row" gap={3}>
          {preset ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void actions.deletePreset(preset.id).then(onDone)}
            >
              Delete preset
            </Button>
          ) : null}
          <Button variant="secondary" size="sm" onClick={onDone}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!canStart}
            loading={busy}
            loadingLabel="Starting run"
            onClick={() => void start()}
          >
            Start run
          </Button>
        </Stack>
      </Stack>
    </Stack>
  );
}

/** Read-only profile inspection. Authoring stays in Console, by decision. */
function ProfileInspector({
  profile,
}: {
  profile: AgentServerCatalogueProfile;
}) {
  const theme = useTheme();
  return (
    <div
      style={{
        borderTop: `1px solid ${theme.color.border.DEFAULT}`,
        paddingTop: theme.spacing[4],
      }}
    >
      <Stack gap={3}>
        {profile.description ? (
          <Text variant="caption" color="secondary">
            {profile.description}
          </Text>
        ) : null}
        <DescriptionList
          ariaLabel={`${profile.name} profile settings`}
          columns={3}
          compact
          items={[
            { label: 'Provider', value: profile.provider, mono: true },
            { label: 'Model', value: profile.model, mono: true },
            { label: 'Runtime', value: profile.runtimeKind, mono: true },
            {
              label: 'Tool policy',
              value: profile.toolEnforcement,
              mono: true,
            },
            {
              label: 'Workspace',
              value: profile.defaultWorkspaceMode ?? 'none',
              mono: true,
            },
            { label: 'Max turns', value: String(profile.maxTurns), mono: true },
          ]}
        />
        <Stack direction="row" gap={3} align="center" wrap>
          {profile.ready ? (
            <Badge variant="success">ready on this Mac</Badge>
          ) : (
            <Badge variant="error">not ready</Badge>
          )}
          <Text as="span" variant="caption" color="muted" mono>
            rev {profile.revision} · {profile.definitionCid.slice(0, 12)}…
          </Text>
          {profile.requiredEnv.length ? (
            <Text as="span" variant="caption" color="muted">
              needs {profile.requiredEnv.join(', ')}
            </Text>
          ) : null}
        </Stack>
      </Stack>
    </div>
  );
}

function TaskTypePicker({
  options,
  selected,
  onChange,
}: {
  options: readonly string[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const toggle = (type: string) =>
    onChange(
      selected.includes(type)
        ? selected.filter((value) => value !== type)
        : [...selected, type],
    );
  return (
    <fieldset className="chip-group">
      <legend>
        <Text as="span" variant="caption" color="muted">
          Task types this worker may claim
        </Text>
      </legend>
      <div className="chip-group__items">
        {/*
          No tooltip: the task-type registry carries only structural metadata
          and no descriptions, so any summary here would be invented.
        */}
        {options.map((option) => (
          <label
            key={option}
            className="chip"
            data-checked={selected.includes(option) || undefined}
          >
            <input
              type="checkbox"
              checked={selected.includes(option)}
              onChange={() => toggle(option)}
            />
            <span>{option}</span>
          </label>
        ))}
      </div>
      <Text variant="caption" color="muted">
        {selected.length === 0
          ? 'Select at least one. A worker only claims the types you allow.'
          : `Claims ${selected.length} of ${options.length} types. Anything else stays in the queue for another worker.`}
      </Text>
    </fieldset>
  );
}

function FallbackList({
  profiles,
  fallbackIds,
  available,
  onChange,
}: {
  profiles: AgentServerCatalogueProfile[];
  fallbackIds: string[];
  available: AgentServerCatalogueProfile[];
  onChange: (next: string[]) => void;
}) {
  const theme = useTheme();
  const move = (index: number, delta: number) => {
    const next = [...fallbackIds];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  return (
    <Stack gap={3}>
      {fallbackIds.length ? (
        <ol className="fallback-list">
          {fallbackIds.map((id, index) => {
            const profile = profiles.find((candidate) => candidate.id === id);
            return (
              <li key={id}>
                <Text as="span" variant="caption" mono color="muted">
                  {index + 1}
                </Text>
                <Stack gap={0.5} style={{ flex: 1, minWidth: 0 }}>
                  <Text as="span" weight="medium">
                    {profile?.name ?? id}
                  </Text>
                  <Text as="span" variant="caption" color="muted" mono>
                    {profile
                      ? `${profile.provider} · ${profile.model}`
                      : 'unknown profile'}
                  </Text>
                </Stack>
                <Stack direction="row" gap={1}>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Move ${profile?.name ?? id} earlier`}
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    ↑
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Move ${profile?.name ?? id} later`}
                    disabled={index === fallbackIds.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    ↓
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove ${profile?.name ?? id}`}
                    onClick={() =>
                      onChange(fallbackIds.filter((value) => value !== id))
                    }
                  >
                    ✕
                  </Button>
                </Stack>
              </li>
            );
          })}
        </ol>
      ) : (
        <Text variant="caption" color="muted">
          No fallbacks. The run fails if the primary profile cannot execute.
        </Text>
      )}
      {available.length ? (
        <Select
          label="Add a fallback"
          value=""
          onChange={(event) => {
            if (event.target.value)
              onChange([...fallbackIds, event.target.value]);
          }}
          style={{ maxWidth: '20rem' }}
        >
          <option value="">Select a profile…</option>
          {available.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name}
            </option>
          ))}
        </Select>
      ) : (
        <Text
          variant="caption"
          color="muted"
          style={{ color: theme.color.text.muted }}
        >
          Every profile in this team is already in the chain.
        </Text>
      )}
    </Stack>
  );
}
