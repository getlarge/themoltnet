import { type GetProjectResponse } from '@moltnet/api-client';
import {
  createProjectMutation,
  listDiariesOptions,
  listProjectsOptions,
  listProjectsQueryKey,
  updateProjectMutation,
} from '@moltnet/api-client/query';
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  Button,
  EmptyState,
  InlineNotice,
  Input,
  PageHeader,
  Select,
  Stack,
  Text,
  useTheme,
} from '@themoltnet/design-system';
import { useEffect, useRef, useState } from 'react';

import { getApiClient } from '../api.js';
import { getApiErrorDetail } from '../api-error.js';
import { canManageTeam, TEAM_HEADER } from '../team/permissions.js';
import { useTeam } from '../team/useTeam.js';

const PAGE_SIZE = 50;

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
  const create = useMutation(createProjectMutation());
  const update = useMutation(updateProjectMutation());
  const archiveMutation = useMutation(updateProjectMutation());
  const busy = create.isPending || update.isPending;
  const archivePending = useRef(new Set<string>());
  const [archiving, setArchiving] = useState(new Set<string>());
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const submitting = useRef(false);
  const [nameError, setNameError] = useState<string>();
  const [error, setError] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const focusTarget = useRef<HTMLElement | null>(null);
  const restoreFocus = useRef(false);
  useEffect(() => {
    if (editing)
      root.current?.querySelector<HTMLInputElement>('#project-name')?.focus();
  }, [editing]);
  function closeEditor() {
    restoreFocus.current = true;
    setEditing(null);
    setError(null);
    setNameError(undefined);
  }
  const requestOptions = {
    client: getApiClient(),
    headers: { [TEAM_HEADER]: teamId ?? '' },
  };
  const diaries = useQuery({
    ...listDiariesOptions(requestOptions),
    enabled: Boolean(teamId),
  });
  const query = useQuery({
    ...listProjectsOptions({
      ...requestOptions,
      query: { includeArchived, limit: PAGE_SIZE, offset },
    }),
    enabled: Boolean(teamId),
    placeholderData: keepPreviousData,
  });
  useEffect(() => {
    if (busy || !restoreFocus.current) return;
    restoreFocus.current = false;
    const target =
      editing && (error || nameError)
        ? root.current?.querySelector<HTMLInputElement>('#project-name')
        : focusTarget.current?.isConnected
          ? focusTarget.current
          : root.current?.querySelector<HTMLElement>('#projects-list-heading');
    target?.focus();
  }, [busy, editing, error, nameError, query.data, archiving]);
  const nextOffset = query.data?.nextOffset ?? null;
  function edit(project: GetProjectResponse | 'new', target: HTMLElement) {
    focusTarget.current = target;
    setEditing(project);
    setName(project === 'new' ? '' : project.name);
    setDescription(project === 'new' ? '' : (project.description ?? ''));
    setDiaryId(project === 'new' ? '' : (project.defaultDiaryId ?? ''));
    setError(null);
    setNameError(undefined);
  }
  async function save() {
    if (submitting.current || !teamId || !canManage || !editing) return;
    if (!name.trim()) {
      setNameError('Enter a project name.');
      root.current?.querySelector<HTMLInputElement>('#project-name')?.focus();
      return;
    }
    submitting.current = true;
    setError(null);
    try {
      const options = {
        client: getApiClient(),
        headers: { [TEAM_HEADER]: teamId },
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
      if (editing !== 'new' && Object.keys(changes).length === 0) {
        closeEditor();
        return;
      }
      if (editing === 'new') await create.mutateAsync({ ...options, body });
      else
        await update.mutateAsync({
          ...options,
          path: { projectId: editing.id },
          body: changes,
        });
      setRowErrors({});
      closeEditor();
      await cache.invalidateQueries({
        queryKey: listProjectsQueryKey(requestOptions),
      });
    } catch (cause) {
      const detail = getApiErrorDetail(
        cause,
        'Project could not be saved. Try again.',
      );
      if (
        cause &&
        typeof cause === 'object' &&
        'status' in cause &&
        cause.status === 409
      )
        setNameError(detail);
      else setError(detail);
    } finally {
      submitting.current = false;
      restoreFocus.current = true;
    }
  }
  async function toggleArchive(
    project: GetProjectResponse,
    target: HTMLElement,
  ) {
    if (archivePending.current.has(project.id) || !teamId || !canManage) return;
    archivePending.current.add(project.id);
    setArchiving(new Set(archivePending.current));
    setRowErrors((current) => {
      const next = { ...current };
      delete next[project.id];
      return next;
    });
    try {
      await archiveMutation.mutateAsync({
        ...requestOptions,
        path: { projectId: project.id },
        body: { archived: !project.archived },
      });
      await cache.invalidateQueries({
        queryKey: listProjectsQueryKey(requestOptions),
      });
    } catch (cause) {
      setRowErrors((current) => ({
        ...current,
        [project.id]: getApiErrorDetail(
          cause,
          'Project could not be saved. Try again.',
        ),
      }));
    } finally {
      archivePending.current.delete(project.id);
      if (
        document.activeElement === target ||
        document.activeElement === document.body
      ) {
        focusTarget.current = target;
        restoreFocus.current = true;
      }
      setArchiving(new Set(archivePending.current));
    }
  }
  return (
    <div ref={root}>
      <Stack gap={6}>
        <PageHeader
          title="Projects"
          description="Shared projects for your team. Choose local folders in Desktop or the CLI."
          actions={
            teamId && canManage ? (
              <Button
                onClick={(event) => edit('new', event.currentTarget)}
                disabled={busy || Boolean(editing)}
              >
                Create project
              </Button>
            ) : undefined
          }
        />
        {!teamId ? (
          <Text color="muted">Select a team to browse its projects.</Text>
        ) : (
          <>
            <label>
              <input
                type="checkbox"
                checked={includeArchived}
                onChange={(event) => {
                  setRowErrors({});
                  setIncludeArchived(event.target.checked);
                  setOffset(0);
                  setError(null);
                }}
              />{' '}
              Show archived projects
            </label>
            {error && (
              <InlineNotice tone="error" title="Project action failed">
                {error}
              </InlineNotice>
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
                    error={nameError}
                    value={name}
                    onChange={(event) => {
                      setName(event.target.value);
                      setNameError(undefined);
                    }}
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
                    {/* Preserve an unreadable saved diary when editing other fields. */}
                    {diaryId &&
                      !diaries.data?.items.some(
                        (diary) => diary.id === diaryId,
                      ) && (
                        <option value={diaryId}>
                          {diaries.isLoading
                            ? 'Loading default diary…'
                            : diaries.error
                              ? 'Default diary could not be loaded'
                              : 'Unavailable default diary'}
                        </option>
                      )}
                    {diaries.data?.items.map((diary) => (
                      <option key={diary.id} value={diary.id}>
                        {diary.name}
                      </option>
                    ))}
                  </Select>
                  {diaries.error && (
                    <div role="alert">
                      <Text>
                        {getApiErrorDetail(
                          diaries.error,
                          'Diaries could not be loaded.',
                        )}
                      </Text>
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
            <Text variant="h3" as="h2" id="projects-list-heading" tabIndex={-1}>
              Project catalogue
            </Text>
            {query.error && (
              <InlineNotice
                tone="error"
                title="Projects could not be loaded"
                action={
                  <Button
                    variant="secondary"
                    onClick={() => void query.refetch()}
                  >
                    Retry
                  </Button>
                }
              >
                {getApiErrorDetail(
                  query.error,
                  'Projects could not be loaded.',
                )}
              </InlineNotice>
            )}
            {query.isLoading ? (
              <div role="status">
                <Text>Loading projects…</Text>
              </div>
            ) : query.data?.items.length === 0 ? (
              <EmptyState
                description="Projects organize shared team work."
                title={
                  offset > 0
                    ? 'No projects on this page.'
                    : 'No projects in this team yet.'
                }
              />
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
                      <Text variant="h3" as="h3">
                        {project.name}
                      </Text>
                      {rowErrors[project.id] && (
                        <InlineNotice
                          tone="error"
                          title="Project action failed"
                        >
                          {rowErrors[project.id]}
                        </InlineNotice>
                      )}
                      {project.description && (
                        <Text color="muted">{project.description}</Text>
                      )}
                      <Text variant="caption" color="muted">
                        {project.archived ? 'Archived' : 'Active'} ·{' '}
                        {project.defaultDiaryId
                          ? (diaries.data?.items.find(
                              (diary) => diary.id === project.defaultDiaryId,
                            )?.name ??
                            (diaries.isLoading
                              ? 'Loading default diary…'
                              : diaries.error
                                ? 'Default diary could not be loaded'
                                : 'Default diary unavailable'))
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
                          aria-disabled={archiving.has(project.id) && !editing}
                          disabled={Boolean(editing)}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          aria-label={`${project.archived ? 'Restore' : 'Archive'} ${project.name}`}
                          onClick={(event) => {
                            focusTarget.current = event.currentTarget;
                            void toggleArchive(project, event.currentTarget);
                          }}
                          aria-disabled={archiving.has(project.id) && !editing}
                          disabled={Boolean(editing)}
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
                    aria-disabled={offset === 0 || query.isPlaceholderData}
                    onClick={() => {
                      if (offset > 0 && !query.isPlaceholderData) {
                        setRowErrors({});
                        setOffset(Math.max(0, offset - PAGE_SIZE));
                        setError(null);
                      }
                    }}
                  >
                    Previous projects
                  </Button>
                  <Button
                    variant="secondary"
                    aria-disabled={
                      nextOffset === null || query.isPlaceholderData
                    }
                    onClick={() => {
                      if (nextOffset !== null && !query.isPlaceholderData) {
                        setRowErrors({});
                        setOffset(nextOffset);
                        setError(null);
                      }
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
