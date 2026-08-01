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

export type PilotMilestoneId =
  | 'team'
  | 'diary'
  | 'agent-key'
  | 'runtime-profile'
  | 'accepted-task';

type EvidenceStatus = 'complete' | 'incomplete' | 'loading' | 'unavailable';

export type PilotMilestoneStatus =
  | 'complete'
  | 'next'
  | 'upcoming'
  | 'loading'
  | 'unavailable';

export interface PilotMilestone {
  id: PilotMilestoneId;
  label: string;
  title: string;
  detail: string;
  action: { href: string; label: string };
  status: PilotMilestoneStatus;
}

export interface TeamPilotBriefing {
  isActivated: boolean;
  milestones: PilotMilestone[];
  nextMilestone: PilotMilestone | null;
}

interface MilestoneDraft extends Omit<PilotMilestone, 'status'> {
  evidence: EvidenceStatus;
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

function unavailableDraft(
  id: PilotMilestoneId,
  label: string,
  noun: string,
  href: string,
  evidence: 'loading' | 'unavailable',
): MilestoneDraft {
  return {
    id,
    label,
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
  const projectTeam =
    team.status === 'ready' && team.data && !team.data.personal
      ? team.data
      : null;
  const teamEvidence = resourceEvidence(team, (selected) =>
    Boolean(selected && !selected.personal),
  );

  const drafts: MilestoneDraft[] = [];
  drafts.push(
    teamEvidence === 'loading' || teamEvidence === 'unavailable'
      ? unavailableDraft(
          'team',
          'Project team',
          'Teams',
          '/teams',
          teamEvidence,
        )
      : {
          id: 'team',
          label: 'Project team',
          title:
            teamEvidence === 'complete'
              ? 'Project team selected'
              : 'Select a project team',
          detail:
            teamEvidence === 'complete'
              ? `${projectTeam?.name ?? 'This project team'} is the active shared scope.`
              : 'Choose or create a non-personal team for shared tasks, runtime configuration, and knowledge.',
          action: { href: '/teams', label: 'Teams' },
          evidence: teamEvidence,
        },
  );

  const diaryEvidence = projectTeam
    ? resourceEvidence(diaries, (items) =>
        items.some((diary) => diary.visibility === 'moltnet'),
      )
    : 'incomplete';
  const sharedDiary =
    diaries.status === 'ready'
      ? diaries.data.find((diary) => diary.visibility === 'moltnet')
      : undefined;
  drafts.push(
    diaryEvidence === 'loading' || diaryEvidence === 'unavailable'
      ? unavailableDraft(
          'diary',
          'Shared diary',
          'Diaries',
          '/diaries',
          diaryEvidence,
        )
      : {
          id: 'diary',
          label: 'Shared diary',
          title:
            diaryEvidence === 'complete'
              ? 'Shared diary ready'
              : canManage
                ? 'Create a shared diary'
                : 'Shared diary needed',
          detail:
            diaryEvidence === 'complete'
              ? `${sharedDiary?.name ?? 'The project diary'} uses MoltNet team visibility.`
              : canManage
                ? 'Create a team diary with MoltNet visibility so agents can retain attributable project context.'
                : 'Ask a team owner or manager to create a diary with MoltNet visibility.',
          action: { href: '/diaries', label: 'Diaries' },
          evidence: diaryEvidence,
        },
  );

  const agentMembers =
    members.status === 'ready'
      ? members.data.filter((member) => member.subjectType === 'agent')
      : [];
  let agentEvidence: EvidenceStatus;
  let agentTitle = 'Add a team agent';
  let agentDetail = canManage
    ? 'Add an agent to the project team before issuing its runtime credential.'
    : 'Ask a team owner or manager to add an agent to this project team.';
  let agentAction = { href: '/teams', label: 'Teams' };
  let agentUnavailableNoun = 'Team members';

  if (members.status !== 'ready') {
    agentEvidence = members.status;
  } else if (agentMembers.length === 0) {
    agentEvidence = 'incomplete';
  } else if (agentKeys.status !== 'ready') {
    agentEvidence = agentKeys.status;
    agentUnavailableNoun = 'Agent Keys';
  } else {
    agentUnavailableNoun = 'Agent Keys';
    const agentIds = new Set(agentMembers.map((member) => member.subjectId));
    const hasActiveKey = agentKeys.data.items.some(
      (key) => key.status === 'active' && agentIds.has(key.agentId),
    );
    agentEvidence = hasActiveKey
      ? 'complete'
      : agentKeys.data.isPartial
        ? 'unavailable'
        : 'incomplete';
    agentTitle = hasActiveKey ? 'Agent and key ready' : 'Activate an agent key';
    agentDetail = hasActiveKey
      ? 'A visible team agent has a matching active credential. Daemon process state is verified outside the Console.'
      : canManage
        ? 'Issue or rotate an active key for one of the project team agents.'
        : 'Ask a team owner or manager to issue an active key for a project agent.';
    agentAction = { href: '/runtime/agent-keys', label: 'Agent Keys' };
  }
  drafts.push(
    agentEvidence === 'loading' || agentEvidence === 'unavailable'
      ? unavailableDraft(
          'agent-key',
          'Ready agent',
          agentUnavailableNoun,
          agentAction.href,
          agentEvidence,
        )
      : {
          id: 'agent-key',
          label: 'Ready agent',
          title: agentTitle,
          detail: agentDetail,
          action: agentAction,
          evidence: agentEvidence,
        },
  );

  const profileEvidence = resourceEvidence(
    runtimeProfiles,
    (profiles) => profiles.length > 0,
  );
  drafts.push(
    profileEvidence === 'loading' || profileEvidence === 'unavailable'
      ? unavailableDraft(
          'runtime-profile',
          'Runtime profile',
          'Runtime Profiles',
          '/runtime/profiles',
          profileEvidence,
        )
      : {
          id: 'runtime-profile',
          label: 'Runtime profile',
          title:
            profileEvidence === 'complete'
              ? 'Runtime profile ready'
              : canManage
                ? 'Create a runtime profile'
                : 'Runtime profile needed',
          detail:
            profileEvidence === 'complete'
              ? 'The team has an execution profile available for task claims.'
              : canManage
                ? 'Define the provider, model, workspace, and policy boundary the daemon may execute.'
                : 'Ask a team owner or manager to create a runtime profile for this pilot.',
          action: { href: '/runtime/profiles', label: 'Runtime Profiles' },
          evidence: profileEvidence,
        },
  );

  let acceptedTaskEvidence = resourceEvidence(completedTasks, (tasks) =>
    tasks.some(
      (task) => task.status === 'completed' && task.acceptedAttemptN !== null,
    ),
  );
  if (
    acceptedTaskEvidence === 'incomplete' &&
    activityTasks.status !== 'ready'
  ) {
    acceptedTaskEvidence = activityTasks.status;
  }
  const activeTask =
    activityTasks.status === 'ready'
      ? activityTasks.data.find((task) => activeTaskStatuses.has(task.status))
      : undefined;
  const taskAction = activeTask
    ? {
        href: `/tasks/${activeTask.id}`,
        label: activeTask.title ?? 'Active task',
      }
    : canManage
      ? { href: '/tasks?create=1', label: 'New Task' }
      : { href: '/tasks', label: 'Tasks' };
  drafts.push(
    acceptedTaskEvidence === 'loading' || acceptedTaskEvidence === 'unavailable'
      ? unavailableDraft(
          'accepted-task',
          'Accepted task',
          'Tasks',
          '/tasks',
          acceptedTaskEvidence,
        )
      : {
          id: 'accepted-task',
          label: 'Accepted task',
          title:
            acceptedTaskEvidence === 'complete'
              ? 'First task accepted'
              : activeTask
                ? 'Finish the first task'
                : canManage
                  ? 'Run the first supervised task'
                  : 'First supervised task needed',
          detail:
            acceptedTaskEvidence === 'complete'
              ? 'A completed task has an accepted attempt. The team pilot is activated.'
              : activeTask
                ? 'Open the current task, supervise its result, and accept the completed attempt.'
                : canManage
                  ? 'Queue a narrow task, supervise the run, and accept the completed attempt.'
                  : 'Ask a team owner or manager to run and accept the first supervised task.',
          action: taskAction,
          evidence: acceptedTaskEvidence,
        },
  );

  const nextIndex = drafts.findIndex(
    (milestone) => milestone.evidence !== 'complete',
  );
  const milestones = drafts.map<PilotMilestone>((draft, index) => {
    let status: PilotMilestoneStatus;
    if (draft.evidence === 'complete') status = 'complete';
    else if (index !== nextIndex) status = 'upcoming';
    else if (draft.evidence === 'loading') status = 'loading';
    else if (draft.evidence === 'unavailable') status = 'unavailable';
    else status = 'next';

    const { evidence: _evidence, ...milestone } = draft;
    return { ...milestone, status };
  });

  return {
    isActivated: nextIndex === -1,
    milestones,
    nextMilestone: nextIndex === -1 ? null : (milestones[nextIndex] ?? null),
  };
}
