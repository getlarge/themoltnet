import {
  Badge,
  Button,
  ControlSurface,
  DescriptionList,
  InlineNotice,
  Input,
  Select,
  Stack,
  Text,
} from '@themoltnet/design-system';
import { useEffect, useState } from 'react';

import { desktopBridge } from '../bridge.js';
import {
  projectErrorBlocks,
  ProjectErrorNotice,
} from './ProjectErrorNotice.js';
import type {
  AgentServerCatalogue,
  ProjectActions,
  ProjectLocation,
  RunCenterActions,
  RunCenterData,
} from './types.js';
import { useCatalogue } from './useCatalogue.js';

export interface ProjectContext {
  identity: string;
  teamId: string;
  projectId?: string;
}
const message = (error: unknown) =>
  typeof error === 'string'
    ? error
    : error instanceof Error
      ? error.message
      : 'The operation could not be completed. Try again.';
export function workspaceLabel(strategy: string): string {
  return strategy === 'existing'
    ? 'Work here'
    : strategy === 'git-worktree'
      ? 'Prepare an isolated Git workspace'
      : strategy === 'none'
        ? 'No workspace'
        : strategy === 'profile-default'
          ? 'Profile default'
          : 'Preparation unavailable';
}

export function ProjectsView({
  data,
  actions,
  projects,
  initialSelection,
  onTeams,
  onServer,
}: {
  data: RunCenterData;
  actions: RunCenterActions;
  projects: ProjectActions;
  initialSelection?: ProjectContext;
  onTeams?: () => void;
  onServer?: () => void;
}) {
  const [selectedIdentity, setIdentity] = useState<string | undefined>(
    initialSelection?.identity ??
      data.status?.selectedIdentity ??
      data.status?.agents[0]?.agentName,
  );
  const identity =
    selectedIdentity ??
    data.status?.selectedIdentity ??
    data.status?.agents[0]?.agentName ??
    '';
  const [teamId, setTeamId] = useState(initialSelection?.teamId ?? '');
  const [projectId, setProjectId] = useState(initialSelection?.projectId ?? '');
  const [locations, setLocations] = useState<ProjectLocation[]>([]);
  const [locationsLoading, setLocationsLoading] = useState(true);
  const [locationsError, setLocationsError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    tone: 'info' | 'error';
    text: string;
  } | null>(null);
  const [revision, setRevision] = useState(0);
  const [editing, setEditing] = useState<ProjectLocation | null | undefined>();
  const [removing, setRemoving] = useState<string | null>(null);
  // Hidden until known: a Console link that can only fail is noise.
  const [consoleAvailable, setConsoleAvailable] = useState(false);
  useEffect(() => {
    let current = true;
    desktopBridge.consoleAvailable().then(
      (available) => {
        if (current) setConsoleAvailable(available);
      },
      () => {
        if (current) setConsoleAvailable(false);
      },
    );
    return () => {
      current = false;
    };
  }, []);
  const serverReady = ['running', 'update_available'].includes(
    data.server.state,
  );
  const {
    catalogue,
    loading,
    error: catalogueError,
    retry: retryCatalogue,
  } = useCatalogue(serverReady ? identity : '', { read: actions.catalogue });
  useEffect(() => {
    if (!catalogue) return;
    setTeamId((selected) => selected || catalogue.defaultTeamId || '');
  }, [catalogue]);
  useEffect(() => {
    let current = true;
    setLocationsError(null);
    setLocationsLoading(serverReady);
    if (!serverReady) {
      setLocations([]);
      return;
    }
    void projects.list().then(
      (value) => {
        if (current) {
          setLocations(value.locations);
          setLocationsLoading(false);
        }
      },
      () => {
        if (current) {
          setLocations([]);
          setLocationsLoading(false);
          setLocationsError(
            'Local locations could not be loaded. Retry before making changes.',
          );
        }
      },
    );
    return () => {
      current = false;
    };
  }, [projects, revision, serverReady]);
  useEffect(() => {
    setProjectId(
      (selected) =>
        selected ||
        catalogue?.projects.find((entry) => entry.teamId === teamId)?.id ||
        '',
    );
  }, [catalogue, teamId]);
  const teams = catalogue?.teams ?? [];
  const team = teams.find((entry) => entry.teamId === teamId);
  // With nothing selectable, explain the first team's blocker instead of
  // asking for a selection that cannot succeed.
  const unavailableTeam =
    team ?? (teams.some((entry) => entry.available) ? undefined : teams[0]);
  const availableProjects = (catalogue?.projects ?? []).filter(
    (entry) => entry.teamId === teamId,
  );
  const project = availableProjects.find((entry) => entry.id === projectId);
  const projectError = catalogue?.projectErrors.find(
    (entry) => entry.teamId === teamId,
  );
  const local = locations.filter(
    (entry) => entry.teamId === teamId && entry.projectId === projectId,
  );
  const refresh = () => {
    // Locations are still local state; the catalogue lives in the cache.
    setRevision((value) => value + 1);
    retryCatalogue();
  };
  const remove = async (name: string) => {
    setRemoving(name);
    setFeedback(null);
    try {
      await projects.remove(name);
      setLocations((current) => current.filter((entry) => entry.name !== name));
      // An open form for this location would otherwise re-create it on save.
      setEditing((current) => (current?.name === name ? undefined : current));
      setFeedback({
        tone: 'info',
        text: 'Location removed. Its folder is unchanged.',
      });
    } catch (error) {
      setFeedback({ tone: 'error', text: message(error) });
    } finally {
      setRemoving(null);
    }
  };
  return (
    <Stack gap={6}>
      <Stack gap={2}>
        <Text as="h1" variant="h4">
          Projects
        </Text>
        <Text color="secondary">
          Shared work and the places you work on this computer.
        </Text>
      </Stack>
      {!serverReady ? (
        <InlineNotice tone="warning" title="The Agent Server is not running">
          Start the server to discover projects and local locations.
          <Button onClick={onServer}>Open Server</Button>
        </InlineNotice>
      ) : null}
      <ControlSurface padding="md" as="section">
        <Stack gap={4}>
          <Select
            label="Identity"
            value={identity}
            onChange={(event) => {
              setIdentity(event.target.value);
              setTeamId('');
              setProjectId('');
              setEditing(undefined);
            }}
          >
            <option value="">Choose an identity</option>
            {data.status?.agents.map((entry) => (
              <option key={entry.agentName} value={entry.agentName}>
                {entry.agentName}
              </option>
            ))}
          </Select>
          {!identity ? (
            <InlineNotice
              tone="info"
              title="Choose an identity to discover projects"
            >
              <Button variant="secondary" onClick={onTeams}>
                Identity and teams
              </Button>
            </InlineNotice>
          ) : null}
          {loading ? (
            <div role="status">
              <Text>Loading projects and team access…</Text>
            </div>
          ) : null}
          {catalogueError ? (
            <InlineNotice tone="error" title="Catalogue unavailable">
              {catalogueError}
              <Button variant="secondary" onClick={refresh}>
                Retry discovery
              </Button>
            </InlineNotice>
          ) : null}
          {catalogue ? (
            <>
              <Select
                label="Team"
                value={teamId}
                onChange={(event) => {
                  const next = event.target.value;
                  setTeamId(next);
                  setProjectId(
                    catalogue.projects.find((entry) => entry.teamId === next)
                      ?.id ?? '',
                  );
                  setEditing(undefined);
                }}
              >
                <option value="">Choose a team</option>
                {teams.map((entry) => (
                  <option key={entry.teamId} value={entry.teamId}>
                    {entry.teamName}
                  </option>
                ))}
              </Select>
              {!team?.available ? (
                <InlineNotice
                  tone="warning"
                  title="Team access needs attention"
                >
                  {(unavailableTeam?.blockers ?? [])
                    .map((blocker) => blocker.message)
                    .join(' ') || 'Select an available team for this identity.'}
                  <Button variant="secondary" onClick={onTeams}>
                    Identity and teams
                  </Button>
                </InlineNotice>
              ) : null}
              {projectError ? (
                <ProjectErrorNotice
                  error={projectError}
                  onRetry={refresh}
                  onTeams={onTeams}
                />
              ) : null}
              {projectErrorBlocks(projectError) ? null : team?.available &&
                !availableProjects.length ? (
                <InlineNotice tone="info" title="No shared projects">
                  Create a project in Console, then refresh discovery.
                  {consoleAvailable ? (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        void desktopBridge
                          .openConsole()
                          .catch((error: unknown) =>
                            setFeedback({
                              tone: 'error',
                              text: message(error),
                            }),
                          );
                      }}
                    >
                      Open Console
                    </Button>
                  ) : null}
                  <Button variant="ghost" onClick={refresh}>
                    Refresh projects
                  </Button>
                </InlineNotice>
              ) : null}
              {availableProjects.length ? (
                <Select
                  label="Project"
                  value={projectId}
                  onChange={(event) => {
                    setProjectId(event.target.value);
                    setEditing(undefined);
                    setFeedback(null);
                  }}
                >
                  <option value="">Choose a project</option>
                  {projectId && !project ? (
                    <option value={projectId}>Unavailable project</option>
                  ) : null}
                  {availableProjects.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
                </Select>
              ) : null}
            </>
          ) : null}
        </Stack>
      </ControlSurface>
      {feedback ? (
        <div role={feedback.tone === 'error' ? 'alert' : 'status'}>
          <InlineNotice tone={feedback.tone} title="Local locations">
            {feedback.text}
          </InlineNotice>
        </div>
      ) : null}
      {projectId && catalogue ? (
        <>
          <ControlSurface padding="md" as="section">
            <Stack gap={3}>
              <Text as="h2" variant="h4">
                Shared with the team
              </Text>
              {project ? (
                <>
                  <Text weight="semibold">{project.name}</Text>
                  {project.description ? (
                    <Text color="secondary">{project.description}</Text>
                  ) : null}
                  <DescriptionList
                    items={[
                      { label: 'Team', value: team?.teamName ?? teamId },
                      {
                        label: 'Default diary',
                        value:
                          team?.diaries.find(
                            (entry) => entry.id === project.defaultDiaryId,
                          )?.name ?? 'Not set',
                      },
                    ]}
                  />
                </>
              ) : (
                <Text color="secondary">
                  This project is unavailable to the selected identity. Its
                  local registrations can still be removed.
                </Text>
              )}
              {consoleAvailable ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    void desktopBridge
                      .openConsole()
                      .catch((error: unknown) =>
                        setFeedback({ tone: 'error', text: message(error) }),
                      );
                  }}
                >
                  Manage in Console
                </Button>
              ) : (
                <Text color="secondary">
                  Manage this project in your deployment&apos;s Console.
                </Text>
              )}
            </Stack>
          </ControlSurface>
          <ControlSurface padding="md" as="section">
            <Stack gap={4}>
              <Stack
                direction="row"
                justify="space-between"
                align="center"
                wrap
                gap={3}
              >
                <Text as="h2" variant="h4">
                  On this computer
                </Text>
                <Button
                  size="sm"
                  disabled={
                    !project ||
                    !team?.available ||
                    locationsLoading ||
                    Boolean(locationsError)
                  }
                  onClick={() => setEditing(null)}
                >
                  Add local location
                </Button>
              </Stack>
              <Text variant="caption" color="secondary">
                Locations store folder and workspace defaults. Credentials
                belong to your identity and team.
              </Text>
              {locationsLoading ? (
                <div role="status">
                  <Text>Loading local locations…</Text>
                </div>
              ) : null}
              {locationsError ? (
                <InlineNotice tone="error" title="Local locations unavailable">
                  {locationsError}
                  <Button variant="secondary" onClick={refresh}>
                    Retry locations
                  </Button>
                </InlineNotice>
              ) : null}
              {!locationsLoading && !locationsError && !local.length ? (
                <Text color="secondary">
                  No local locations yet. Add a folder to work on this project.
                </Text>
              ) : null}
              {local.map((entry) => (
                <div key={entry.name}>
                  <Stack gap={2}>
                    <Stack
                      direction="row"
                      justify="space-between"
                      align="center"
                      wrap
                      gap={3}
                    >
                      <Text as="h3" weight="semibold">
                        {entry.name}
                      </Text>
                      {entry.default ? <Badge>Default location</Badge> : null}
                    </Stack>
                    <Text
                      mono
                      variant="caption"
                      style={{ overflowWrap: 'anywhere' }}
                    >
                      {entry.effectiveSource ?? 'No source folder'}
                    </Text>
                    <Text variant="caption" color="secondary">
                      {workspaceLabel(entry.strategy)}
                    </Text>
                    {!entry.readiness.ready ? (
                      <InlineNotice
                        tone="warning"
                        title="Location needs attention"
                      >
                        {entry.readiness.message}
                      </InlineNotice>
                    ) : null}
                    <Stack direction="row" wrap gap={2}>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={!project || !team?.available}
                        aria-label={`Edit ${entry.name}`}
                        onClick={() => setEditing(entry)}
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Remove ${entry.name}`}
                        disabled={removing !== null}
                        onClick={() => void remove(entry.name)}
                      >
                        {removing === entry.name ? 'Removing…' : 'Remove'}
                      </Button>
                    </Stack>
                  </Stack>
                </div>
              ))}
              <Text variant="caption" color="muted">
                Removing a location removes its registration only. Files stay in
                the folder.
              </Text>
              {editing !== undefined && project && team ? (
                <LocationForm
                  key={`${project.id}/${editing?.name ?? 'new'}`}
                  identity={identity}
                  project={project}
                  diaries={team.diaries}
                  initial={editing}
                  projects={projects}
                  onCancel={() => setEditing(undefined)}
                  onSaved={(saved) => {
                    setLocations((current) => [
                      ...current
                        .filter((entry) => entry.name !== saved.name)
                        .map((entry) =>
                          saved.default &&
                          entry.projectId === saved.projectId &&
                          entry.teamId === saved.teamId
                            ? { ...entry, default: false }
                            : entry,
                        ),
                      saved,
                    ]);
                    setEditing(undefined);
                    setFeedback({
                      tone: 'info',
                      text: 'Location saved. Existing runs keep their captured selection.',
                    });
                  }}
                />
              ) : null}
            </Stack>
          </ControlSurface>
        </>
      ) : null}
    </Stack>
  );
}

function LocationForm({
  identity,
  project,
  diaries,
  initial,
  projects,
  onCancel,
  onSaved,
}: {
  identity: string;
  project: AgentServerCatalogue['projects'][number];
  diaries: { id: string; name: string }[];
  initial: ProjectLocation | null;
  projects: ProjectActions;
  onCancel: () => void;
  onSaved: (location: ProjectLocation) => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [source, setSource] = useState(initial?.effectiveSource ?? '');
  const [strategy, setStrategy] = useState(initial?.strategy ?? 'existing');
  const [diaryId, setDiaryId] = useState(initial?.diaryId ?? '');
  const [isDefault, setDefault] = useState(initial?.default ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const choose = async () => {
    setBusy(true);
    setError(null);
    try {
      const folder = await projects.chooseFolder();
      if (folder !== null) setSource(folder);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    // Kept visible for stored locations but never saved; the button is disabled.
    if (strategy === 'isolated-directory') return;
    setBusy(true);
    setError(null);
    try {
      onSaved(
        await projects.save({
          identity,
          name: name.trim(),
          teamId: project.teamId,
          projectId: project.id,
          strategy,
          default: isDefault,
          ...(strategy !== 'none' ? { source } : {}),
          ...(diaryId ? { diaryId } : {}),
        }),
      );
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <Stack gap={4}>
        <Text as="h3" weight="semibold">
          {initial ? 'Edit local location' : 'New local location'}
        </Text>
        <Input
          label="Location name"
          value={name}
          readOnly={Boolean(initial)}
          disabled={busy}
          onChange={(event) => setName(event.target.value)}
          required
        />
        <Select
          label="Workspace default"
          value={strategy}
          disabled={busy}
          onChange={(event) =>
            setStrategy(event.target.value as ProjectLocation['strategy'])
          }
        >
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
        {strategy !== 'none' ? (
          <>
            <Input label="Folder" value={source} readOnly required />
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => void choose()}
            >
              Choose folder
            </Button>
          </>
        ) : null}
        <Select
          label="Diary override"
          value={diaryId}
          disabled={busy}
          onChange={(event) => setDiaryId(event.target.value)}
        >
          <option value="">Use the project's default diary</option>
          {diaries.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </Select>
        <label>
          <input
            type="checkbox"
            checked={isDefault}
            disabled={busy}
            onChange={(event) => setDefault(event.target.checked)}
          />{' '}
          Use as the default location for this project
        </label>
        {error ? (
          <div role="alert">
            <InlineNotice tone="error" title="Location could not be saved">
              {error}
            </InlineNotice>
          </div>
        ) : null}
        <Stack direction="row" gap={2} wrap>
          <Button
            type="submit"
            disabled={
              busy ||
              !name.trim() ||
              (strategy !== 'none' && !source) ||
              strategy === 'isolated-directory'
            }
          >
            {busy ? 'Working…' : 'Save location'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={onCancel}
          >
            Cancel
          </Button>
        </Stack>
      </Stack>
    </form>
  );
}
