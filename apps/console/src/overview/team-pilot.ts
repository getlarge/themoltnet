export type PilotResource<T> =
  | { status: 'ready'; data: T }
  | { status: 'loading' }
  | { status: 'unavailable' };

export interface PilotTeam {
  id: string;
  name: string;
  personal: boolean;
}

export interface PilotDiary {
  id: string;
  name: string;
  visibility: 'private' | 'moltnet' | 'public';
}

export interface PilotMember {
  subjectId: string;
  subjectType: 'agent' | 'human';
}

export interface PilotAgentKey {
  agentId: string;
  status: 'active' | 'revoked' | 'expired';
}

export interface PilotTask {
  acceptedAttemptN: number | null;
  id: string;
  status: string;
  title?: string | null;
}

/**
 * The three journey steps owned by `docs/start` (agent job journey design,
 * decision 7). The Console computes live state for each step and links to the
 * docs page that explains it; the journey copy itself lives in the docs.
 */
export type PilotStepId = 'identity' | 'job' | 'record';

type EvidenceStatus = 'complete' | 'incomplete' | 'loading' | 'unavailable';

export type PilotStepStatus =
  | 'complete'
  | 'next'
  | 'upcoming'
  | 'loading'
  | 'unavailable';

interface PilotLink {
  href: string;
  label: string;
}

export interface PilotStep {
  id: PilotStepId;
  /** The journey step name, identical in the docs and the Console. */
  label: string;
  /** The current state of the step, derived from live evidence. */
  title: string;
  detail: string;
  /** Docs path relative to the docs origin, e.g. `/start/agent-identity`. */
  docsPath: string;
  /** In-Console action for the current state. */
  action: PilotLink;
  status: PilotStepStatus;
}

export interface TeamPilotBriefing {
  isActivated: boolean;
  steps: PilotStep[];
  nextStep: PilotStep | null;
  /** The completed task whose record is the payoff of step 3. */
  recordTask: { id: string; title: string | null } | null;
}

interface CheckDraft {
  title: string;
  detail: string;
  action: PilotLink;
  evidence: EvidenceStatus;
}

interface StepDefinition {
  id: PilotStepId;
  label: string;
  docsPath: string;
}

interface BuildTeamPilotInput {
  team: PilotResource<PilotTeam | null>;
  diaries: PilotResource<PilotDiary[]>;
  members: PilotResource<PilotMember[]>;
  agentKeys: PilotResource<{
    items: PilotAgentKey[];
    isPartial: boolean;
  }>;
  runtimeProfiles: PilotResource<unknown[]>;
  completedTasks: PilotResource<PilotTask[]>;
  activityTasks: PilotResource<PilotTask[]>;
  canManage: boolean;
}

const STEP_DEFINITIONS = {
  identity: {
    id: 'identity',
    label: 'Give an agent its own identity',
    docsPath: '/start/agent-identity',
  },
  job: {
    id: 'job',
    label: "Give it a job it can't overstep",
    docsPath: '/start/first-task',
  },
  record: {
    id: 'record',
    label: 'Read what it did',
    docsPath: '/start/read-the-record',
  },
} as const satisfies Record<PilotStepId, StepDefinition>;

const activeTaskStatuses = new Set([
  'waiting',
  'queued',
  'dispatched',
  'running',
]);

function resourceEvidence<T>(
  resource: PilotResource<T>,
  predicate: (data: T) => boolean,
): EvidenceStatus {
  if (resource.status !== 'ready') return resource.status;
  return predicate(resource.data) ? 'complete' : 'incomplete';
}

function unknownCheck(
  noun: string,
  href: string,
  evidence: 'loading' | 'unavailable',
): CheckDraft {
  return {
    title:
      evidence === 'loading'
        ? `Checking ${noun.toLowerCase()}…`
        : `${noun} unavailable`,
    detail:
      evidence === 'loading'
        ? `The Console is still verifying ${noun.toLowerCase()} for this team.`
        : `The Console could not verify ${noun.toLowerCase()}. Treat the state as unknown and retry before changing setup.`,
    action: { href, label: noun },
    evidence,
  };
}

/** The first prerequisite that is not complete decides the step's state. */
function currentCheck(checks: CheckDraft[], done: CheckDraft): CheckDraft {
  return checks.find((check) => check.evidence !== 'complete') ?? done;
}

function teamCheck(
  team: BuildTeamPilotInput['team'],
): CheckDraft & { projectTeam: PilotTeam | null } {
  const projectTeam =
    team.status === 'ready' && team.data && !team.data.personal
      ? team.data
      : null;
  const evidence = resourceEvidence(team, (selected) =>
    Boolean(selected && !selected.personal),
  );
  if (evidence === 'loading' || evidence === 'unavailable') {
    return { ...unknownCheck('Teams', '/teams', evidence), projectTeam };
  }
  return {
    title:
      evidence === 'complete'
        ? 'Project team selected'
        : 'Select a project team',
    detail:
      evidence === 'complete'
        ? `${projectTeam?.name ?? 'This project team'} is the active shared scope.`
        : 'Choose or create a non-personal team for shared tasks, runtime configuration, and knowledge.',
    action: { href: '/teams', label: 'Teams' },
    evidence,
    projectTeam,
  };
}

function diaryCheck(
  diaries: BuildTeamPilotInput['diaries'],
  hasProjectTeam: boolean,
  canManage: boolean,
): CheckDraft {
  const evidence = hasProjectTeam
    ? resourceEvidence(diaries, (items) =>
        items.some((diary) => diary.visibility === 'moltnet'),
      )
    : 'incomplete';
  if (evidence === 'loading' || evidence === 'unavailable') {
    return unknownCheck('Diaries', '/diaries', evidence);
  }
  const sharedDiary =
    diaries.status === 'ready'
      ? diaries.data.find((diary) => diary.visibility === 'moltnet')
      : undefined;
  return {
    title:
      evidence === 'complete'
        ? 'Shared diary ready'
        : canManage
          ? 'Create a shared diary'
          : 'Shared diary needed',
    detail:
      evidence === 'complete'
        ? `${sharedDiary?.name ?? 'The project diary'} uses MoltNet team visibility.`
        : canManage
          ? 'Create a team diary with MoltNet visibility so agents can retain attributable project context.'
          : 'Ask a team owner or manager to create a diary with MoltNet visibility.',
    action: { href: '/diaries', label: 'Diaries' },
    evidence,
  };
}

function agentCheck(
  members: BuildTeamPilotInput['members'],
  agentKeys: BuildTeamPilotInput['agentKeys'],
  canManage: boolean,
): CheckDraft {
  if (members.status !== 'ready') {
    return unknownCheck('Team members', '/teams', members.status);
  }
  const agentMembers = members.data.filter(
    (member) => member.subjectType === 'agent',
  );
  if (agentMembers.length === 0) {
    return {
      title: 'Add a team agent',
      detail: canManage
        ? 'Add an agent to the project team. It acts under its own name and key, not yours.'
        : 'Ask a team owner or manager to add an agent to this project team.',
      action: { href: '/teams', label: 'Teams' },
      evidence: 'incomplete',
    };
  }
  if (agentKeys.status !== 'ready') {
    return unknownCheck('Agent Keys', '/runtime/agent-keys', agentKeys.status);
  }

  const agentIds = new Set(agentMembers.map((member) => member.subjectId));
  const hasActiveKey = agentKeys.data.items.some(
    (key) => key.status === 'active' && agentIds.has(key.agentId),
  );
  if (!hasActiveKey && agentKeys.data.isPartial) {
    return unknownCheck('Agent Keys', '/runtime/agent-keys', 'unavailable');
  }
  return {
    title: hasActiveKey ? 'Agent and key ready' : 'Activate an agent key',
    detail: hasActiveKey
      ? 'A visible team agent has a matching active credential. Daemon process state is verified outside the Console.'
      : canManage
        ? 'Issue or rotate an active key for one of the project team agents.'
        : 'Ask a team owner or manager to issue an active key for a project agent.',
    action: { href: '/runtime/agent-keys', label: 'Agent Keys' },
    evidence: hasActiveKey ? 'complete' : 'incomplete',
  };
}

function profileCheck(
  runtimeProfiles: BuildTeamPilotInput['runtimeProfiles'],
  canManage: boolean,
): CheckDraft {
  const evidence = resourceEvidence(
    runtimeProfiles,
    (profiles) => profiles.length > 0,
  );
  if (evidence === 'loading' || evidence === 'unavailable') {
    return unknownCheck('Runtime Profiles', '/runtime/profiles', evidence);
  }
  return {
    title:
      evidence === 'complete'
        ? 'Runtime profile ready'
        : canManage
          ? 'Create a runtime profile'
          : 'Runtime profile needed',
    detail:
      evidence === 'complete'
        ? 'The team has a runtime profile that bounds what a claimed task may do.'
        : canManage
          ? 'Set the provider, model, workspace, and the tools the agent may use. In enforce mode the runtime refuses anything else.'
          : 'Ask a team owner or manager to create a runtime profile for this team.',
    action: { href: '/runtime/profiles', label: 'Runtime Profiles' },
    evidence,
  };
}

function taskCreatedCheck(
  activityTasks: BuildTeamPilotInput['activityTasks'],
  completedTasks: BuildTeamPilotInput['completedTasks'],
  canManage: boolean,
): CheckDraft {
  const hasCompleted =
    completedTasks.status === 'ready' && completedTasks.data.length > 0;
  const evidence: EvidenceStatus = hasCompleted
    ? 'complete'
    : resourceEvidence(activityTasks, (tasks) => tasks.length > 0);
  if (evidence === 'loading' || evidence === 'unavailable') {
    return unknownCheck('Tasks', '/tasks', evidence);
  }
  return {
    title:
      evidence === 'complete'
        ? 'First task created'
        : canManage
          ? 'Create the first task'
          : 'First task needed',
    detail:
      evidence === 'complete'
        ? 'The team has a task for its agent to claim.'
        : canManage
          ? 'Give the agent one small job with a clear definition of done.'
          : 'Ask a team owner or manager to create the first task.',
    action: canManage
      ? { href: '/tasks?create=1', label: 'New Task' }
      : { href: '/tasks', label: 'Tasks' },
    evidence,
  };
}

function recordCheck(
  activityTasks: BuildTeamPilotInput['activityTasks'],
  completedTasks: BuildTeamPilotInput['completedTasks'],
): CheckDraft & { recordTask: PilotTask | null } {
  const recordTask =
    completedTasks.status === 'ready'
      ? (completedTasks.data.find(
          (task) =>
            task.status === 'completed' && task.acceptedAttemptN !== null,
        ) ?? null)
      : null;
  if (recordTask) {
    return {
      title: 'See what your agent did',
      detail:
        'The task keeps every attempt, the policy it ran under, and its output, tied to the agent that produced it.',
      action: {
        href: `/tasks/${recordTask.id}`,
        label: 'See what your agent did',
      },
      evidence: 'complete',
      recordTask,
    };
  }

  let evidence = resourceEvidence(completedTasks, () => false);
  if (evidence === 'incomplete' && activityTasks.status !== 'ready') {
    evidence = activityTasks.status;
  }
  if (evidence === 'loading' || evidence === 'unavailable') {
    return { ...unknownCheck('Tasks', '/tasks', evidence), recordTask: null };
  }

  const activeTask =
    activityTasks.status === 'ready'
      ? activityTasks.data.find((task) => activeTaskStatuses.has(task.status))
      : undefined;
  if (activeTask) {
    return {
      title: 'Follow the first task',
      detail:
        'Open the task to follow each step while the agent works. The record stays on the task when it completes.',
      action: {
        href: `/tasks/${activeTask.id}`,
        label: activeTask.title ?? 'Active task',
      },
      evidence: 'incomplete',
      recordTask: null,
    };
  }
  return {
    title: 'No completed task yet',
    detail:
      'Open Tasks to see what happened to the last run. A failed attempt is on the record too.',
    action: { href: '/tasks', label: 'Tasks' },
    evidence: 'incomplete',
    recordTask: null,
  };
}

export function buildTeamPilotBriefing({
  team,
  diaries,
  members,
  agentKeys,
  runtimeProfiles,
  completedTasks,
  activityTasks,
  canManage,
}: BuildTeamPilotInput): TeamPilotBriefing {
  const teamState = teamCheck(team);
  const identity = currentCheck(
    [teamState, agentCheck(members, agentKeys, canManage)],
    {
      title: 'Agent identity ready',
      detail: 'A project agent has its own active key.',
      action: { href: '/runtime/agent-keys', label: 'Agent Keys' },
      evidence: 'complete',
    },
  );

  const job = currentCheck(
    [
      diaryCheck(diaries, teamState.projectTeam !== null, canManage),
      profileCheck(runtimeProfiles, canManage),
      taskCreatedCheck(activityTasks, completedTasks, canManage),
    ],
    {
      title: 'First job created',
      detail:
        'The team has a shared diary, a runtime profile, and a task for its agent.',
      action: { href: '/tasks', label: 'Tasks' },
      evidence: 'complete',
    },
  );

  const record = recordCheck(activityTasks, completedTasks);

  const drafts: Array<StepDefinition & CheckDraft> = [
    { ...STEP_DEFINITIONS.identity, ...identity },
    { ...STEP_DEFINITIONS.job, ...job },
    { ...STEP_DEFINITIONS.record, ...record },
  ];

  const nextIndex = drafts.findIndex((step) => step.evidence !== 'complete');
  const steps = drafts.map<PilotStep>((draft, index) => {
    let status: PilotStepStatus;
    if (draft.evidence === 'complete') status = 'complete';
    else if (index !== nextIndex) status = 'upcoming';
    else if (draft.evidence === 'loading') status = 'loading';
    else if (draft.evidence === 'unavailable') status = 'unavailable';
    else status = 'next';

    return {
      id: draft.id,
      label: draft.label,
      title: draft.title,
      detail: draft.detail,
      docsPath: draft.docsPath,
      action: draft.action,
      status,
    };
  });

  return {
    isActivated: nextIndex === -1,
    steps,
    nextStep: nextIndex === -1 ? null : (steps[nextIndex] ?? null),
    recordTask: record.recordTask
      ? { id: record.recordTask.id, title: record.recordTask.title ?? null }
      : null,
  };
}
