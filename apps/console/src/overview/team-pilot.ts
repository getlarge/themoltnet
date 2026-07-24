import type { TaskStatus } from '@moltnet/api-client';

import { statusToLane } from '../tasks/status.js';

export interface PilotTeam {
  id: string;
  name: string;
  personal: boolean;
}

export interface PilotDiary {
  id: string;
  name: string;
}

export interface PilotMember {
  displayName: string;
  role: 'owner' | 'manager' | 'member';
  subjectType: 'agent' | 'human';
}

export interface PilotTask {
  status: TaskStatus;
}

export type PilotPhaseStatus =
  | 'not_started'
  | 'ready'
  | 'in_progress'
  | 'needs_attention'
  | 'unavailable'
  | 'complete';

export interface PilotPhase {
  id: 'workspace' | 'agent' | 'task';
  label: string;
  title: string;
  detail: string;
  action: { href: string; label: string };
  status: PilotPhaseStatus;
}

export interface TeamPilotBriefing {
  activeTaskCount: number;
  agentMember: PilotMember | null;
  completedTaskCount: number;
  failedTaskCount: number;
  phases: PilotPhase[];
  queuedTaskCount: number;
  summary: string;
  waitingTaskCount: number;
}

interface TaskCounts {
  active: number;
  completed: number;
  failed: number;
  queued: number;
  waiting: number;
}

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return count === 1 ? singular : plural;
}

function taskVerb(count: number) {
  return count === 1 ? 'is' : 'are';
}

function countTasks(tasks: PilotTask[]): TaskCounts {
  const counts: TaskCounts = {
    active: 0,
    completed: 0,
    failed: 0,
    queued: 0,
    waiting: 0,
  };

  for (const task of tasks) {
    const lane = statusToLane(task.status);
    if (lane === 'active') counts.active += 1;
    if (lane === 'done') counts.completed += 1;
    if (lane === 'failed' || lane === 'closed') counts.failed += 1;
    if (task.status === 'queued') counts.queued += 1;
    if (task.status === 'waiting') counts.waiting += 1;
  }

  return counts;
}

function buildWorkspacePhase(
  team: PilotTeam | null,
  diaries: PilotDiary[] | null,
): PilotPhase {
  if (!team) {
    return {
      id: 'workspace',
      label: 'Project workspace',
      title: 'Create a project workspace',
      detail:
        'Choose or create a non-personal team, then give the project a shared diary.',
      action: { href: '/teams', label: 'Choose a project team' },
      status: 'not_started',
    };
  }

  if (diaries === null) {
    return {
      id: 'workspace',
      label: 'Project workspace',
      title: 'Diary status unavailable',
      detail: `${team.name} is selected, but the Console could not load its diaries.`,
      action: { href: '/diaries', label: 'Open diaries' },
      status: 'unavailable',
    };
  }

  if (diaries.length === 0) {
    return {
      id: 'workspace',
      label: 'Project workspace',
      title: 'Create the shared diary',
      detail: `${team.name} is selected. Add the project diary before inviting an agent.`,
      action: { href: '/diaries', label: 'Create diary' },
      status: 'ready',
    };
  }

  return {
    id: 'workspace',
    label: 'Project workspace',
    title: 'Project workspace ready',
    detail: `${team.name} has ${diaries.length} project ${pluralize(diaries.length, 'diary', 'diaries')} available.`,
    action: { href: '/diaries', label: 'Open diaries' },
    status: 'complete',
  };
}

function buildAgentPhase({
  agentMember,
  docsUrl,
  membersAvailable,
  workspaceComplete,
}: {
  agentMember: PilotMember | null;
  docsUrl: string;
  membersAvailable: boolean;
  workspaceComplete: boolean;
}): PilotPhase {
  if (!membersAvailable) {
    return {
      id: 'agent',
      label: 'Team agent',
      title: 'Team member status unavailable',
      detail:
        'The Console could not load team members. Open the team to confirm agent access.',
      action: { href: '/teams', label: 'Open team members' },
      status: 'unavailable',
    };
  }

  if (agentMember) {
    const conventionalAccess =
      agentMember.role === 'owner' || agentMember.role === 'manager';
    return {
      id: 'agent',
      label: 'Team agent',
      title: 'Team agent ready',
      detail: conventionalAccess
        ? `${agentMember.displayName} has ${agentMember.role} access. Start agent-daemon before expecting queued tasks to run.`
        : `${agentMember.displayName} is a team member. Confirm a manager or owner role, or a diary writer grant, before expecting task claims.`,
      action: { href: '/teams', label: 'Review team members' },
      status: 'complete',
    };
  }

  return {
    id: 'agent',
    label: 'Team agent',
    title: 'Ready a team agent',
    detail:
      'Initialize an agent and add it to this project. Manager or owner membership is the conventional claim path; diary writer grants can also authorize claims.',
    action: {
      href: `${docsUrl.replace(/\/$/, '')}/start/install-and-initialize`,
      label: 'Set up an agent',
    },
    status: workspaceComplete ? 'ready' : 'not_started',
  };
}

function buildTaskPhase({
  agentComplete,
  counts,
  projectTeam,
  tasksAvailable,
}: {
  agentComplete: boolean;
  counts: TaskCounts;
  projectTeam: boolean;
  tasksAvailable: boolean;
}): PilotPhase {
  if (!projectTeam) {
    return {
      id: 'task',
      label: 'Supervised task',
      title: 'Run a first supervised task',
      detail:
        'Create the project workspace and ready an agent before queueing the first task.',
      action: { href: '/tasks', label: 'Open tasks' },
      status: 'not_started',
    };
  }

  if (!tasksAvailable) {
    return {
      id: 'task',
      label: 'Supervised task',
      title: 'Task status unavailable',
      detail:
        'The Console could not load task activity. Open the task board to inspect the current state.',
      action: { href: '/tasks', label: 'Open tasks' },
      status: 'unavailable',
    };
  }

  if (counts.completed > 0) {
    return {
      id: 'task',
      label: 'Supervised task',
      title: 'First supervised task complete',
      detail: `${counts.completed} completed ${pluralize(counts.completed, 'task')} in this team. Review the output and its diary trail.`,
      action: { href: '/tasks', label: 'Review tasks' },
      status: 'complete',
    };
  }

  if (counts.active > 0) {
    return {
      id: 'task',
      label: 'Supervised task',
      title: 'Supervised task in progress',
      detail: `${counts.active} ${pluralize(counts.active, 'task')} ${taskVerb(counts.active)} claimed or running. Review the live task view for progress.`,
      action: { href: '/tasks', label: 'Watch task progress' },
      status: 'in_progress',
    };
  }

  if (counts.queued > 0) {
    return {
      id: 'task',
      label: 'Supervised task',
      title: 'Task waiting for an agent',
      detail: `${counts.queued} queued ${pluralize(counts.queued, 'task')} ${taskVerb(counts.queued)} waiting. Keep an authorized agent-daemon running to claim work.`,
      action: { href: '/tasks', label: 'Open task queue' },
      status: 'ready',
    };
  }

  if (counts.waiting > 0) {
    return {
      id: 'task',
      label: 'Supervised task',
      title: 'Task waiting on a condition',
      detail: `${counts.waiting} ${pluralize(counts.waiting, 'task')} ${taskVerb(counts.waiting)} blocked by an unmet claim condition. Review task dependencies before starting another daemon.`,
      action: { href: '/tasks', label: 'Review task conditions' },
      status: 'needs_attention',
    };
  }

  if (counts.failed > 0) {
    return {
      id: 'task',
      label: 'Supervised task',
      title: 'First task needs review',
      detail: `${counts.failed} ${pluralize(counts.failed, 'task')} ended without completing. Review the failure, cancellation, or expiry before retrying.`,
      action: { href: '/tasks', label: 'Review task outcome' },
      status: 'needs_attention',
    };
  }

  return {
    id: 'task',
    label: 'Supervised task',
    title: 'Run a first supervised task',
    detail:
      'Write a narrow brief, queue it against the shared diary, and supervise the result.',
    action: { href: '/tasks', label: 'Create a task' },
    status: agentComplete ? 'ready' : 'not_started',
  };
}

function buildSummary(phases: PilotPhase[], counts: TaskCounts) {
  const [workspace, agent, task] = phases;
  if (phases.some((phase) => phase.status === 'unavailable')) {
    return 'Some pilot status is unavailable; continue with the phases that loaded.';
  }
  if (workspace?.status !== 'complete') {
    return 'Start by creating a project workspace.';
  }
  if (agent?.status !== 'complete') {
    return 'Next, ready a team agent for this project.';
  }
  if (task?.status === 'complete') return 'Your team-pilot loop is complete.';
  if (task?.status === 'in_progress') {
    return 'Your first supervised task is in progress.';
  }
  if (task?.status === 'needs_attention') {
    return 'Review the first task before continuing the pilot.';
  }
  if (task?.status === 'ready' && counts.queued > 0) {
    return 'Your task is queued; keep an authorized agent daemon running.';
  }
  return 'Queue a narrow first task and supervise its result.';
}

export function buildTeamPilotBriefing({
  team,
  diaries,
  members,
  tasks,
  docsUrl,
}: {
  team: PilotTeam | null;
  diaries: PilotDiary[] | null;
  members: PilotMember[] | null;
  tasks: PilotTask[] | null;
  docsUrl: string;
}): TeamPilotBriefing {
  const projectTeam = team && !team.personal ? team : null;
  const projectTasks = projectTeam && tasks ? tasks : [];
  const counts = countTasks(projectTasks);
  const agentMember = projectTeam
    ? (members?.find((member) => member.subjectType === 'agent') ?? null)
    : null;

  const workspace = buildWorkspacePhase(
    projectTeam,
    projectTeam ? diaries : [],
  );
  const agent = buildAgentPhase({
    agentMember,
    docsUrl,
    membersAvailable: !projectTeam || members !== null,
    workspaceComplete: workspace.status === 'complete',
  });
  const task = buildTaskPhase({
    agentComplete: agent.status === 'complete',
    counts,
    projectTeam: Boolean(projectTeam),
    tasksAvailable: !projectTeam || tasks !== null,
  });
  const phases = [workspace, agent, task];

  return {
    activeTaskCount: counts.active,
    agentMember,
    completedTaskCount: counts.completed,
    failedTaskCount: counts.failed,
    phases,
    queuedTaskCount: counts.queued,
    summary: buildSummary(phases, counts),
    waitingTaskCount: counts.waiting,
  };
}
