/**
 * The one remote check that a team, project and diary are usable, shared by
 * location saves and run starts, so both report the same codes:
 * 400 `project_unavailable`/`diary_unavailable` when the credential cannot see
 * the target, 503 `project_check_unavailable` when the server could not be
 * asked in time. A 503 is logged with its cause; a 400 is the user's to fix.
 */
import { MoltNetError } from '@themoltnet/sdk';

import { safeErrorContext } from '../safe-error-context.js';
import type { CatalogueProject } from './catalogue.js';
import { AgentServerHttpError } from './http-error.js';
import { TeamCredentialError } from './team-credentials.js';

/**
 * Budget for a native request that performs remote checks before it writes or
 * spawns. It must stay below Desktop's 15 s control request timeout
 * (`REQUEST_TIMEOUT` in agent-desktop control.rs), or Desktop reports a
 * transport failure while the operation may still complete.
 */
export const NATIVE_REQUEST_BUDGET_MS = 10_000;

export interface ProjectTarget {
  teamId: string;
  projectId: string | null;
  diaryId?: string;
}

/** Reads run under the caller's signal; a 401/403/404 means "not visible". */
export interface ProjectTargetReader {
  readProject(
    teamId: string,
    projectId: string,
    signal: AbortSignal,
  ): Promise<CatalogueProject | null>;
  readDiary(
    teamId: string,
    diaryId: string,
    signal: AbortSignal,
  ): Promise<{ id: string; teamId: string } | null>;
}

export interface ProjectCheckLogger {
  warn(context: Record<string, unknown>, message: string): void;
}

export async function verifyProjectTarget(
  reader: ProjectTargetReader,
  target: ProjectTarget,
  options: { signal: AbortSignal; logger?: ProjectCheckLogger },
): Promise<{ project: CatalogueProject | null }> {
  const { signal, logger } = options;
  let project: CatalogueProject | null = null;
  let diary: { id: string; teamId: string } | null = null;
  try {
    await untilAborted(signal, async () => {
      if (target.projectId)
        project = await reader.readProject(
          target.teamId,
          target.projectId,
          signal,
        );
      if (target.diaryId)
        diary = await reader.readDiary(target.teamId, target.diaryId, signal);
    });
  } catch (error) {
    if (!signal.aborted) {
      if (error instanceof TeamCredentialError) throw error;
      if (notVisible(error)) throw projectUnavailable();
    }
    logger?.warn(
      {
        ...safeErrorContext(error),
        teamId: target.teamId,
        ...(target.projectId ? { projectId: target.projectId } : {}),
        ...(target.diaryId ? { diaryId: target.diaryId } : {}),
        code: signal.aborted
          ? 'agent_server_project_check_aborted'
          : 'agent_server_project_check_failed',
      },
      'AgentServer project check failed',
    );
    throw checkUnavailable(error, signal.aborted);
  }
  const found = project as CatalogueProject | null;
  if (
    target.projectId &&
    (!found ||
      found.id !== target.projectId ||
      found.teamId !== target.teamId ||
      found.archived)
  )
    throw projectUnavailable();
  const foundDiary = diary as { id: string; teamId: string } | null;
  if (
    target.diaryId &&
    (!foundDiary ||
      foundDiary.id !== target.diaryId ||
      foundDiary.teamId !== target.teamId)
  )
    throw new AgentServerHttpError(
      400,
      'diary_unavailable',
      'Choose a diary belonging to this team',
    );
  return { project: found };
}

/** Null when the credential cannot see the resource; other failures propagate. */
export async function visibleOrNull<T>(read: () => Promise<T>) {
  try {
    return await read();
  } catch (error) {
    if (notVisible(error)) return null;
    throw error;
  }
}

/**
 * Settles when `work` does or `signal` aborts. The SDK's team, project and
 * diary reads take no signal, so an in-flight GET may finish in the background;
 * readers check the signal between steps so nothing further starts.
 */
export async function untilAborted<T>(
  signal: AbortSignal,
  work: () => Promise<T>,
): Promise<T> {
  signal.throwIfAborted();
  const aborted = new Promise<never>((_, reject) => {
    signal.addEventListener(
      'abort',
      () => {
        reject(new Error('Project check was aborted'));
      },
      { once: true },
    );
  });
  return Promise.race([work(), aborted]);
}

export function checkUnavailable(
  cause: unknown,
  timedOut: boolean,
): AgentServerHttpError {
  return new AgentServerHttpError(
    503,
    'project_check_unavailable',
    timedOut
      ? 'The request could not be completed in time, so nothing was changed. Retry in a moment.'
      : 'The server could not confirm this project. Retry in a moment.',
    { cause },
  );
}

export function projectUnavailable(): AgentServerHttpError {
  return new AgentServerHttpError(
    400,
    'project_unavailable',
    'Verify team access and choose an available project',
  );
}

function notVisible(error: unknown): boolean {
  return (
    error instanceof MoltNetError &&
    [401, 403, 404].includes(error.statusCode ?? 0)
  );
}
