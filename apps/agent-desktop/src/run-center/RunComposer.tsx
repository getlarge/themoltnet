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

import { verificationUnavailable } from './credential-health.js';
import { relativeTime } from './format.js';
import {
  projectErrorBlocks,
  ProjectErrorNotice,
} from './ProjectErrorNotice.js';
import { type ProjectContext, workspaceLabel } from './ProjectsView.js';
import { projectActions } from './run-center-bridge.js';
import type {
  AgentServerCatalogueProfile,
  DesktopRun,
  ProjectLocation,
  RunCenterActions,
  RunCenterData,
  StartRunInput,
} from './types.js';
import { useComposerCatalogue } from './useComposerCatalogue.js';

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
  onProjects?: (context: ProjectContext) => void;
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
  onProjects,
}: RunComposerProps) {
  // Everything the composer offers comes from the server: identities from the
  // status surface, teams and profiles from the identity-scoped catalogue.
  const agents = data.status?.agents ?? [];
  const taskTypeOptions = TASK_TYPE_OPTIONS;
  const [savedPresetId, setSavedPresetId] = useState(presetId);
  const preset =
    data.presets.find((candidate) => candidate.id === savedPresetId) ?? null;

  const [agent, setAgent] = useState(
    previousRun?.agent ??
      preset?.agent ??
      data.status?.selectedIdentity ??
      agents[0]?.agentName ??
      '',
  );
  const [teamId, setTeamId] = useState(
    previousRun?.teamId ?? preset?.teamId ?? '',
  );
  const [locationRevision, setLocationRevision] = useState(0);
  const projects = actions.projects ?? projectActions;
  // Run again replays what was requested, never what it resolved to, so a
  // location's current folder, strategy and diary apply to the new run.
  const [projectId, setProjectId] = useState(
    (previousRun ? previousRun.projectId : preset?.projectId) ?? '',
  );
  const [locationName, setLocationName] = useState(
    (previousRun ? previousRun.location : preset?.location) ?? '',
  );
  const [source, setSource] = useState(
    (previousRun ? previousRun.source : preset?.source) ?? '',
  );
  const [strategy, setStrategy] = useState<StartRunInput['strategy']>(
    previousRun ? previousRun.strategy : preset?.strategy,
  );
  const [diaryId, setDiaryId] = useState(
    previousRun?.diaryId ??
      (preset?.version === 2 ? preset.diaryId : null) ??
      '',
  );
  const [locations, setLocations] = useState<ProjectLocation[]>([]);
  const [locationsLoading, setLocationsLoading] = useState(false);
  const [locationsError, setLocationsError] = useState<string | null>(null);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [choosingFolder, setChoosingFolder] = useState(false);
  const clearProject = () => {
    setProjectId('');
    setLocationName('');
    setSource('');
    setStrategy(undefined);
    setDiaryId('');
  };
  useEffect(() => {
    if (!active) return;
    let current = true;
    setLocations([]);
    setLocationsError(null);
    setLocationsLoading(Boolean(projectId));
    if (!projectId) return;
    void projects.list().then(
      (value) => {
        if (!current) return;
        const choices = value.locations.filter(
          (entry) => entry.teamId === teamId && entry.projectId === projectId,
        );
        setLocations(choices);
        setLocationsLoading(false);
        setLocationName(
          (selected) =>
            selected ||
            choices.find((entry) => entry.default)?.name ||
            (choices.length === 1 ? choices[0].name : ''),
        );
      },
      () => {
        if (current) {
          setLocationsLoading(false);
          setLocationsError(
            'Local locations could not be loaded. Retry before starting.',
          );
        }
      },
    );
    return () => {
      current = false;
    };
  }, [projects, projectId, teamId, active, locationRevision]);
  const chooseFolder = async () => {
    setChoosingFolder(true);
    setFolderError(null);
    try {
      const folder = await projects.chooseFolder();
      if (folder !== null) {
        setSource(folder);
        // A folder only needs a strategy switch when none would use it; an
        // inherited Git worktree must stay isolated.
        if (effectiveStrategy === 'none') setStrategy('existing');
      }
    } catch (error) {
      setFolderError(
        typeof error === 'string'
          ? error
          : error instanceof Error
            ? error.message
            : 'The folder could not be selected. Try again.',
      );
    } finally {
      setChoosingFolder(false);
    }
  };
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
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    catalogue,
    loading: catalogueLoading,
    error: catalogueError,
    retry,
  } = useComposerCatalogue(agent, active, actions.catalogue);
  const teams = catalogue?.teams ?? [];
  useEffect(() => {
    if (catalogue)
      setTeamId((selected) => selected || catalogue.defaultTeamId || '');
  }, [catalogue]);
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
  const sharedProjects = (catalogue?.projects ?? []).filter(
    (entry) => entry.teamId === teamId,
  );
  const project = sharedProjects.find((entry) => entry.id === projectId);
  const location = locations.find((entry) => entry.name === locationName);
  const projectError = catalogue?.projectErrors?.find(
    (entry) => entry.teamId === teamId,
  );
  const selectedTeamDiary =
    diaryId ||
    location?.diaryId ||
    project?.defaultDiaryId ||
    (!projectId ? team?.defaultDiaryId : null);
  // Sent as the request: only a diary the user chose. Location, project and
  // team defaults are resolved by the daemon at start, so Run again picks up
  // their current values.
  const requestedDiary = diaryId || null;
  const effectiveStrategy =
    strategy ?? location?.strategy ?? primary?.defaultWorkspaceMode ?? 'none';
  const effectiveSource =
    effectiveStrategy === 'none' ? null : source || location?.effectiveSource;
  const projectSelection = {
    // null is explicit General work, which the daemon resolves and records.
    projectId: projectId || null,
    ...(projectId && locationName ? { location: locationName } : {}),
    ...(source && strategy !== 'none' ? { source } : {}),
    ...(strategy ? { strategy } : {}),
  };
  const replayOptions = previousRun
    ? {
        correlationId: previousRun.correlationId,
        diaryIds: previousRun.diaryIds,
        pollIntervalMs: previousRun.pollIntervalMs,
        maxPollIntervalMs: previousRun.maxPollIntervalMs,
        waitForFirstTaskSec: previousRun.waitForFirstTaskSec,
        waitAfterTaskSec: previousRun.waitAfterTaskSec,
      }
    : {};

  const boundElsewhere = Boolean(team && !team.available);
  const verificationFailed = verificationUnavailable(team ? [team] : teams);

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
  if (catalogue && primaryId && !primary)
    problems.push(
      'Selected runtime profile is no longer available. Choose another profile.',
    );
  if (
    catalogue &&
    fallbackIds.some((id) => !profiles.some((profile) => profile.id === id))
  )
    problems.push(
      'A fallback profile is no longer available. Remove or replace it in Advanced.',
    );
  if (taskTypes.length === 0) problems.push('Choose at least one task type.');
  if (boundElsewhere)
    problems.push(
      team?.blockers[0]?.message ?? 'Team access needs verification.',
    );

  if (projectId && projectError?.code === 'forbidden')
    problems.push(
      'This team credential cannot list projects. Renew it in Identity and teams, or choose General work.',
    );
  else if (
    projectId &&
    (projectErrorBlocks(projectError) || (catalogue && !project))
  )
    problems.push(
      'The selected project is unavailable. Retry discovery or choose General work.',
    );
  if (projectId && locationsLoading) problems.push('Loading local locations…');
  if (projectId && locationsError) problems.push(locationsError);
  if (projectId && !location) problems.push('Choose or add a local location.');
  if (location && !location.readiness.ready)
    problems.push(
      location.readiness.message ??
        'This location needs attention. Manage its settings before starting.',
    );
  if (effectiveStrategy === 'isolated-directory')
    problems.push(
      'Isolated directory preparation is unavailable. Choose a supported workspace behavior.',
    );
  if (diaryId && team && !team.diaries.some((entry) => entry.id === diaryId))
    problems.push('The selected diary is unavailable. Choose another diary.');
  else if (
    !diaryId &&
    location?.diaryId &&
    team &&
    !team.diaries.some((entry) => entry.id === location.diaryId)
  )
    problems.push(
      "This location's diary is unavailable. Choose a diary or update the location.",
    );
  else if (
    !diaryId &&
    !location?.diaryId &&
    project?.defaultDiaryId &&
    team &&
    !team.diaries.some((entry) => entry.id === project.defaultDiaryId)
  )
    problems.push(
      "This project's default diary is unavailable. Choose a diary for this run.",
    );
  if (effectiveStrategy !== 'none' && !effectiveSource && strategy)
    problems.push('Choose a folder for this workspace behavior.');
  if (choosingFolder) problems.push('Finish choosing a folder.');

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
        mode: previousRun?.mode ?? 'poll',
        ...projectSelection,
        ...replayOptions,
        ...(requestedDiary ? { diaryId: requestedDiary } : {}),
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
    setSaveFailed(false);
    try {
      const saved = await actions.savePreset({
        id: preset?.id ?? null,
        name: presetName.trim(),
        agent,
        teamId,
        diaryId: diaryId || null,
        ...projectSelection,
        profileIds: [primaryId, ...fallbackIds],
        taskTypes,
      });
      setSavedPresetId(saved.id);
      setSaveMessage('Preset saved.');
    } catch (error) {
      setSaveFailed(true);
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
                setTeamId('');
                clearProject();
                setPrimaryId('');
                setFallbackIds([]);
              }}
              hint={
                selectedAgent?.fingerprint
                  ? `Agent key ${selectedAgent.fingerprint}`
                  : undefined
              }
            >
              <option value="">Choose an identity</option>
              {agent && !selectedAgent ? (
                <option value={agent} disabled>
                  {agent} — unavailable
                </option>
              ) : null}
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
                clearProject();
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
              {teamId && !team ? (
                <option value={teamId} disabled>
                  {teamId} — unavailable
                </option>
              ) : null}
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
              <Button variant="secondary" onClick={retry}>
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
            <InlineNotice
              tone="warning"
              title={
                verificationFailed
                  ? 'Team access could not be verified'
                  : 'Team access needs attention'
              }
            >
              {team?.blockers.map((blocker) => blocker.message).join(' ') ||
                (verificationFailed
                  ? 'Check connectivity and retry team verification.'
                  : 'Enroll this identity into a team before starting a run.')}
              {verificationFailed ? (
                <Button variant="secondary" onClick={retry}>
                  Retry catalogue
                </Button>
              ) : (
                <Button variant="ghost" onClick={onTeams}>
                  Enroll or renew team access
                </Button>
              )}
            </InlineNotice>
          ) : null}

          <Divider style={{ margin: 0 }} />

          <Stack gap={3}>
            <Select
              label="Project"
              value={projectId}
              onChange={(event) => {
                clearProject();
                setProjectId(event.target.value);
              }}
            >
              <option value="">General work</option>
              {projectId && !project ? (
                <option value={projectId}>
                  Selected project — unavailable
                </option>
              ) : null}
              {sharedProjects.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </Select>
            {projectError ? (
              <ProjectErrorNotice
                error={projectError}
                onRetry={retry}
                onTeams={onTeams}
              />
            ) : null}
            {projectId ? (
              <>
                <Select
                  label="Local location"
                  value={locationName}
                  onChange={(event) => {
                    setLocationName(event.target.value);
                    setSource('');
                    setStrategy(undefined);
                    setDiaryId('');
                  }}
                >
                  <option value="">Choose a location</option>
                  {locationName && !location ? (
                    <option value={locationName}>
                      {locationName} — unavailable
                    </option>
                  ) : null}
                  {locations.map((entry) => (
                    <option key={entry.name} value={entry.name}>
                      {entry.name}
                      {entry.default ? ' — default' : ''}
                      {entry.readiness.ready ? '' : ' — needs attention'}
                    </option>
                  ))}
                </Select>
                {locationsLoading ? (
                  <div role="status">
                    <Text>Loading local locations…</Text>
                  </div>
                ) : null}
                {locationsError ? (
                  <InlineNotice
                    tone="error"
                    title="Local locations unavailable"
                  >
                    {locationsError}
                    <Button
                      variant="secondary"
                      onClick={() => {
                        projects.invalidate?.();
                        setLocationRevision((value) => value + 1);
                      }}
                    >
                      Retry locations
                    </Button>
                  </InlineNotice>
                ) : null}
                {!locationsLoading &&
                !locationsError &&
                locations.length === 0 ? (
                  <InlineNotice tone="info" title="No local location yet">
                    Add a local location for this project before starting a run,
                    or refresh the list if you just saved one.
                    <Stack direction="row" gap={2} wrap>
                      <Button
                        variant="secondary"
                        onClick={() => {
                          projects.invalidate?.();
                          setLocationRevision((value) => value + 1);
                        }}
                      >
                        Refresh locations
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() =>
                          onProjects?.({ identity: agent, teamId, projectId })
                        }
                      >
                        Add local location
                      </Button>
                    </Stack>
                  </InlineNotice>
                ) : null}
                {location && !location.readiness.ready ? (
                  <InlineNotice tone="warning" title="Location needs attention">
                    {location.readiness.message}
                  </InlineNotice>
                ) : null}
                <Button
                  variant="secondary"
                  onClick={() =>
                    onProjects?.({ identity: agent, teamId, projectId })
                  }
                >
                  Manage local locations
                </Button>
              </>
            ) : (
              <Text variant="caption" color="secondary">
                Claims General work for this team. Project tasks stay with their
                project.
              </Text>
            )}
            <Select
              label="Run diary"
              value={diaryId}
              onChange={(event) => setDiaryId(event.target.value)}
            >
              <option value="">Use the selected work's default</option>
              {diaryId &&
              !team?.diaries.some((entry) => entry.id === diaryId) ? (
                <option value={diaryId}>Selected diary — unavailable</option>
              ) : null}
              {team?.diaries.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </Select>
          </Stack>
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
              {primaryId && !primary ? (
                <option value={primaryId} disabled>
                  {primaryId} — {catalogueLoading ? 'checking' : 'unavailable'}
                </option>
              ) : null}
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
            <Text weight="semibold">Workspace for this run</Text>
            <Text variant="caption" color="secondary">
              These overrides change this run only. Use Save preset or Update
              preset to keep them in a preset.
            </Text>
            <Select
              label="Workspace behavior"
              value={strategy ?? ''}
              onChange={(event) => {
                const value = event.target.value as StartRunInput['strategy'];
                setStrategy(value || undefined);
                if (value === 'none') setSource('');
              }}
            >
              <option value="">Use location or profile default</option>
              <option value="existing">Work here</option>
              <option value="git-worktree">
                Prepare an isolated Git workspace
              </option>
              <option value="none">No workspace</option>
              {strategy === 'isolated-directory' ? (
                <option value="isolated-directory">
                  Isolated directory (unavailable)
                </option>
              ) : null}
            </Select>
            <Input
              label="Run folder override"
              value={source}
              readOnly
              placeholder="Use the selected location"
            />
            <Stack direction="row" gap={2} wrap>
              <Button
                variant="secondary"
                disabled={choosingFolder}
                onClick={() => void chooseFolder()}
              >
                Choose folder for this run
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setSource('');
                  setStrategy(undefined);
                }}
              >
                Reset workspace overrides
              </Button>
            </Stack>
            {folderError ? (
              <InlineNotice tone="error" title="Folder unavailable">
                {folderError}
              </InlineNotice>
            ) : null}
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

      <ControlSurface padding="md" as="section">
        <Stack gap={3}>
          <Text as="h2" variant="h4">
            Effective run settings
          </Text>
          <DescriptionList
            ariaLabel="Effective run settings"
            items={[
              {
                label: 'Project',
                value: projectId
                  ? (project?.name ?? projectId)
                  : 'General work',
              },
              {
                label: 'Diary',
                value:
                  team?.diaries.find((entry) => entry.id === selectedTeamDiary)
                    ?.name ??
                  selectedTeamDiary ??
                  'No diary selected',
              },
              {
                label: 'Folder',
                value:
                  effectiveSource ??
                  (effectiveStrategy === 'none'
                    ? 'No workspace'
                    : 'Prepared for this run'),
                mono: true,
              },
              { label: 'Workspace', value: workspaceLabel(effectiveStrategy) },
            ]}
          />
        </Stack>
      </ControlSurface>
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
            <InlineNotice tone={saveFailed ? 'error' : 'success'}>
              {saveMessage}
            </InlineNotice>
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
              disabled={saving}
              onClick={() => {
                setSaving(true);
                setSaveMessage(null);
                void actions
                  .deletePreset(preset.id)
                  .then(onDone)
                  .catch((error: unknown) => {
                    setSaveFailed(true);
                    setSaveMessage(
                      error instanceof Error
                        ? error.message
                        : 'The preset could not be deleted.',
                    );
                  })
                  .finally(() => setSaving(false));
              }}
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
