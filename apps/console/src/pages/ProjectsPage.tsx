import {
  createProject,
  type GetProjectResponse,
  listDiaries,
  listProjects,
  updateProject,
} from '@moltnet/api-client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Input,
  Select,
  Stack,
  Text,
  useTheme,
} from '@themoltnet/design-system';
import { useEffect, useRef, useState } from 'react';

import { getApiClient } from '../api.js';
import { canManageTeam } from '../team/permissions.js';
import { useTeam } from '../team/useTeam.js';

export function ProjectsPage() {
  const { selectedTeam } = useTeam();
  return (
    <TeamProjects
      key={selectedTeam?.id ?? 'none'}
      teamId={selectedTeam?.id}
      canManage={canManageTeam(selectedTeam?.role)}
    />
  );
}
function TeamProjects({
  teamId,
  canManage,
}: {
  teamId?: string;
  canManage: boolean;
}) {
  const theme = useTheme();
  const cache = useQueryClient();
  const [includeArchived, setIncludeArchived] = useState(false);
  const [offset, setOffset] = useState(0);
  const [editing, setEditing] = useState<GetProjectResponse | 'new' | null>(
    null,
  );
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [diaryId, setDiaryId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const focusTarget = useRef<HTMLElement | null>(null);
  const restoreFocus = useRef(false);
  useEffect(() => {
    if (busy || !restoreFocus.current) return;
    restoreFocus.current = false;
    const target = focusTarget.current?.isConnected
      ? focusTarget.current
      : root.current?.querySelector<HTMLButtonElement>('button');
    target?.focus();
  }, [busy, editing]);
  useEffect(() => {
    if (editing)
      root.current?.querySelector<HTMLInputElement>('#project-name')?.focus();
  }, [editing]);
  function closeEditor() {
    restoreFocus.current = true;
    setEditing(null);
  }
  const diaries = useQuery({
    queryKey: ['project-diary-catalogue', teamId],
    enabled: Boolean(teamId),
    queryFn: async ({ signal }) => {
      const result = await listDiaries({
        client: getApiClient(),
        headers: { 'x-moltnet-team-id': teamId! },
        signal,
      });
      if (!result.data) throw new Error('Diaries could not be loaded.');
      return result.data.items;
    },
  });
  const query = useQuery({
    queryKey: ['projects', teamId, includeArchived, offset],
    enabled: Boolean(teamId),
    queryFn: async () => {
      const result = await listProjects({
        client: getApiClient(),
        path: { id: teamId! },
        query: { includeArchived, limit: 50, offset },
        headers: { 'x-moltnet-team-id': teamId! },
      });
      if (!result.data) throw new Error('Projects could not be loaded.');
      return result.data;
    },
  });
  const nextOffset = query.data?.nextOffset ?? null;
  function edit(project: GetProjectResponse | 'new', target: HTMLElement) {
    focusTarget.current = target;
    setEditing(project);
    setName(project === 'new' ? '' : project.name);
    setDescription(project === 'new' ? '' : (project.description ?? ''));
    setDiaryId(project === 'new' ? '' : (project.defaultDiaryId ?? ''));
    setError(null);
  }
  async function save(archive?: GetProjectResponse) {
    if (!teamId || !canManage || (!archive && !editing)) return;
    if (!archive && !name.trim()) {
      setError('Enter a project name.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const options = {
        client: getApiClient(),
        headers: { 'x-moltnet-team-id': teamId },
      };
      const body = {
        name: name.trim(),
        description: description.trim() || null,
        defaultDiaryId: diaryId || null,
      };
      const changes =
        editing && editing !== 'new'
          ? {
              ...(body.name !== editing.name ? { name: body.name } : {}),
              ...(body.description !== editing.description
                ? { description: body.description }
                : {}),
              ...(body.defaultDiaryId !== editing.defaultDiaryId
                ? { defaultDiaryId: body.defaultDiaryId }
                : {}),
            }
          : body;
      if (!archive && editing !== 'new' && Object.keys(changes).length === 0) {
        closeEditor();
        return;
      }
      const result = archive
        ? await updateProject({
            ...options,
            path: { id: teamId, projectId: archive.id },
            body: { archived: !archive.archived },
          })
        : editing === 'new'
          ? await createProject({ ...options, path: { id: teamId }, body })
          : await updateProject({
              ...options,
              path: { id: teamId, projectId: editing!.id },
              body: changes,
            });
      if (!result.data)
        throw new Error(
          'Project could not be saved. Check your team permissions and try again.',
        );
      if (!archive) closeEditor();
      else restoreFocus.current = true;
      await cache.invalidateQueries({ queryKey: ['projects', teamId] });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Project could not be saved. Try again.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div ref={root}>
      <Stack gap={6}>
        <Stack
          direction="row"
          justify="space-between"
          align="center"
          wrap
          gap={4}
        >
          <Stack gap={1}>
            <Text variant="h2" as="h1">
              Projects
            </Text>
            <Text color="muted">
              Shared projects for your team. Choose local folders in Desktop or
              the CLI.
            </Text>
          </Stack>
          {teamId && canManage && (
            <Button
              onClick={(event) => edit('new', event.currentTarget)}
              disabled={busy}
            >
              Create project
            </Button>
          )}
        </Stack>
        {!teamId ? (
          <Text color="muted">Select a team to browse its projects.</Text>
        ) : (
          <>
            <label>
              <input
                type="checkbox"
                checked={includeArchived}
                onChange={(event) => {
                  setIncludeArchived(event.target.checked);
                  setOffset(0);
                }}
              />{' '}
              Show archived projects
            </label>
            {error && (
              <div role="alert">
                <Text style={{ color: theme.color.error.DEFAULT }}>
                  {error}
                </Text>
              </div>
            )}
            {editing && (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void save();
                }}
              >
                <Stack gap={4} style={{ maxWidth: '40rem' }}>
                  <Text variant="h3" as="h2">
                    {editing === 'new' ? 'New project' : `Edit ${editing.name}`}
                  </Text>
                  <Input
                    id="project-name"
                    label="Project name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    required
                    maxLength={255}
                  />
                  <Input
                    label="Description"
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    maxLength={10000}
                  />
                  <Select
                    label="Default diary"
                    value={diaryId}
                    onChange={(event) => setDiaryId(event.target.value)}
                    disabled={diaries.isLoading}
                    hint="New tasks can use this diary as their starting selection."
                  >
                    <option value="">Choose per task</option>
                    {diaryId &&
                      !diaries.data?.some((diary) => diary.id === diaryId) && (
                        <option value={diaryId}>
                          Unavailable default diary
                        </option>
                      )}
                    {diaries.data?.map((diary) => (
                      <option key={diary.id} value={diary.id}>
                        {diary.name}
                      </option>
                    ))}
                  </Select>
                  {diaries.error && (
                    <div role="alert">
                      <Text>Diaries could not be loaded.</Text>
                      <Button
                        variant="secondary"
                        onClick={() => void diaries.refetch()}
                      >
                        Retry diaries
                      </Button>
                    </div>
                  )}
                  <Stack direction="row" gap={3}>
                    <Button type="submit" disabled={busy}>
                      {busy ? 'Saving…' : 'Save project'}
                    </Button>
                    <Button
                      variant="ghost"
                      type="button"
                      onClick={closeEditor}
                      disabled={busy}
                    >
                      Cancel
                    </Button>
                  </Stack>
                </Stack>
              </form>
            )}
            {query.isLoading ? (
              <div role="status">
                <Text>Loading projects…</Text>
              </div>
            ) : query.error ? (
              <Stack gap={3}>
                <div role="alert">
                  <Text>Projects could not be loaded.</Text>
                </div>
                <Button
                  variant="secondary"
                  onClick={() => void query.refetch()}
                >
                  Retry
                </Button>
              </Stack>
            ) : query.data?.items.length === 0 ? (
              <Text color="muted">
                {offset > 0
                  ? 'No projects on this page.'
                  : 'No projects in this team yet.'}
              </Text>
            ) : (
              <Stack gap={0}>
                {query.data?.items.map((project) => (
                  <Stack
                    key={project.id}
                    direction="row"
                    justify="space-between"
                    align="center"
                    wrap
                    gap={4}
                    style={{
                      paddingBlock: theme.spacing[4],
                      borderBottom: `1px solid ${theme.color.border.DEFAULT}`,
                    }}
                  >
                    <Stack
                      gap={1}
                      style={{
                        minWidth: 0,
                        overflowWrap: 'anywhere',
                        flex: '1 1 16rem',
                      }}
                    >
                      <Text variant="h3" as="h2">
                        {project.name}
                      </Text>
                      {project.description && (
                        <Text color="muted">{project.description}</Text>
                      )}
                      <Text variant="caption" color="muted">
                        {project.archived ? 'Archived' : 'Active'} ·{' '}
                        {project.defaultDiaryId
                          ? (diaries.data?.find(
                              (diary) => diary.id === project.defaultDiaryId,
                            )?.name ?? 'Default diary unavailable')
                          : 'Diary chosen per task'}
                      </Text>
                    </Stack>
                    {canManage && (
                      <Stack direction="row" gap={2}>
                        <Button
                          variant="ghost"
                          aria-label={`Edit ${project.name}`}
                          onClick={(event) =>
                            edit(project, event.currentTarget)
                          }
                          disabled={busy}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          aria-label={`${project.archived ? 'Restore' : 'Archive'} ${project.name}`}
                          onClick={(event) => {
                            focusTarget.current = event.currentTarget;
                            void save(project);
                          }}
                          disabled={busy}
                        >
                          {project.archived ? 'Restore' : 'Archive'}
                        </Button>
                      </Stack>
                    )}
                  </Stack>
                ))}
              </Stack>
            )}
            {(offset > 0 || nextOffset !== null) && (
              <nav aria-label="Project pages">
                <Stack direction="row" gap={3} wrap>
                  <Button
                    variant="secondary"
                    disabled={offset === 0 || query.isFetching}
                    onClick={() => setOffset(Math.max(0, offset - 50))}
                  >
                    Previous projects
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={nextOffset === null || query.isFetching}
                    onClick={() => {
                      if (nextOffset !== null) setOffset(nextOffset);
                    }}
                  >
                    Next projects
                  </Button>
                </Stack>
              </nav>
            )}
          </>
        )}
      </Stack>
    </div>
  );
}
