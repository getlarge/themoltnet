import type { TaskStatus } from '@moltnet/api-client';

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
  | 'complete';

export interface PilotPhase {
  id: 'workspace' | 'agent' | 'task';
  title: string;
  detail: string;
  action: { href: string; label: string };
  status: PilotPhaseStatus;
}

export interface TeamPilotBriefing {
  activeTaskCount: number;
  completedTaskCount: number;
  managerAgent: PilotMember | null;
  phases: PilotPhase[];
  queuedTaskCount: number;
  summary: string;
}

const ACTIVE_TASK_STATUSES: TaskStatus[] = ['dispatched', 'running'];
const QUEUED_TASK_STATUSES: TaskStatus[] = ['waiting', 'queued'];

export function buildTeamPilotBriefing({
  team,
  diaries,
  members,
  tasks,
}: {
  team: PilotTeam | null;
  diaries: PilotDiary[];
  members: PilotMember[];
  tasks: PilotTask[];
}): TeamPilotBriefing {
  const projectTeam = team && !team.personal ? team : null;
  const sharedDiary = projectTeam ? (diaries[0] ?? null) : null;
  const managerAgent = projectTeam
    ? (members.find(
        (member) => member.subjectType === 'agent' && member.role === 'manager',
      ) ?? null)
    : null;
  const queuedTaskCount = tasks.filter((task) =>
    QUEUED_TASK_STATUSES.includes(task.status),
  ).length;
  const activeTaskCount = tasks.filter((task) =>
    ACTIVE_TASK_STATUSES.includes(task.status),
  ).length;
  const completedTaskCount = tasks.filter(
    (task) => task.status === 'completed',
  ).length;

  const workspaceComplete = Boolean(projectTeam && sharedDiary);
  const agentComplete = Boolean(managerAgent);
  const hasCompletedTask = completedTaskCount > 0;
  const taskInProgress = activeTaskCount > 0;
  const taskQueued = queuedTaskCount > 0;

  const workspace: PilotPhase = projectTeam
    ? sharedDiary
      ? {
          id: 'workspace',
          title: 'Project workspace ready',
          detail: `${projectTeam.name} has the shared diary ${sharedDiary.name}.`,
          action: { href: '/diaries', label: 'Open diaries' },
          status: 'complete',
        }
      : {
          id: 'workspace',
          title: 'Create the shared diary',
          detail: `${projectTeam.name} is selected. Add the project diary before inviting an agent.`,
          action: { href: '/diaries', label: 'Create diary' },
          status: 'ready',
        }
    : {
        id: 'workspace',
        title: 'Create a project workspace',
        detail:
          'Choose or create a non-personal team, then give the project a shared diary.',
        action: { href: '/teams', label: 'Choose a project team' },
        status: 'not_started',
      };

  const agent: PilotPhase = managerAgent
    ? {
        id: 'agent',
        title: 'Manager agent ready',
        detail: `${managerAgent.displayName} can claim work for this team. Start agent-daemon before expecting queued tasks to run.`,
        action: { href: '/teams', label: 'Review team members' },
        status: 'complete',
      }
    : {
        id: 'agent',
        title: 'Ready a manager agent',
        detail:
          'Initialize an agent, add it to this project team as a manager, and configure its diary context.',
        action: {
          href: 'https://docs.themolt.net/start/install-and-initialize',
          label: 'Set up an agent',
        },
        status: workspaceComplete ? 'ready' : 'not_started',
      };

  const task: PilotPhase = hasCompletedTask
    ? {
        id: 'task',
        title: 'First supervised task complete',
        detail: `${completedTaskCount} completed task${completedTaskCount === 1 ? '' : 's'} in this team. Review the output and its diary trail.`,
        action: { href: '/tasks', label: 'Review tasks' },
        status: 'complete',
      }
    : taskInProgress
      ? {
          id: 'task',
          title: 'Supervised task in progress',
          detail: `${activeTaskCount} task${activeTaskCount === 1 ? '' : 's'} ${activeTaskCount === 1 ? 'is' : 'are'} claimed or running. Review the live task view for progress.`,
          action: { href: '/tasks', label: 'Watch task progress' },
          status: 'in_progress',
        }
      : taskQueued
        ? {
            id: 'task',
            title: 'Task waiting for an agent',
            detail: `${queuedTaskCount} queued task${queuedTaskCount === 1 ? '' : 's'} ${queuedTaskCount === 1 ? 'is' : 'are'} waiting. A manager agent still needs a running agent-daemon to claim work.`,
            action: { href: '/tasks', label: 'Open task queue' },
            status: 'ready',
          }
        : {
            id: 'task',
            title: 'Run a first supervised task',
            detail:
              'Write a narrow brief, queue it against the shared diary, and watch it after the manager agent claims it.',
            action: { href: '/tasks', label: 'Create a task' },
            status: agentComplete ? 'ready' : 'not_started',
          };

  const summary = !workspaceComplete
    ? 'Start by creating a project workspace.'
    : !agentComplete
      ? 'Next, ready a manager agent for this team.'
      : hasCompletedTask
        ? 'Your team-pilot loop is complete.'
        : taskInProgress
          ? 'Your first supervised task is in progress.'
          : taskQueued
            ? 'Your task is queued; keep a manager agent daemon running to claim it.'
            : 'Queue a narrow first task and supervise its result.';

  return {
    activeTaskCount,
    completedTaskCount,
    managerAgent,
    phases: [workspace, agent, task],
    queuedTaskCount,
    summary,
  };
}
