import { describe, expect, it } from 'vitest';

import {
  buildTeamPilotBriefing,
  type PilotResource,
} from '../src/overview/team-pilot.js';

const ready = <T>(data: T): PilotResource<T> => ({ status: 'ready', data });

function pilotInput(): Parameters<typeof buildTeamPilotBriefing>[0] {
  return {
    team: ready({ id: 'team-1', name: 'Pilot', personal: false }),
    diaries: ready([
      {
        id: 'diary-1',
        name: 'Pilot diary',
        visibility: 'moltnet' as const,
      },
    ]),
    members: ready([
      {
        subjectId: 'agent-1',
        subjectType: 'agent' as const,
      },
    ]),
    agentKeys: ready({
      items: [
        {
          agentId: 'agent-1',
          status: 'active' as const,
        },
      ],
      isPartial: false,
    }),
    runtimeProfiles: ready([{ id: 'profile-1' }]),
    completedTasks: ready([]),
    activityTasks: ready([]),
    canManage: true,
  };
}

describe('buildTeamPilotBriefing', () => {
  it('starts with Teams when no project team exists', () => {
    const input = pilotInput();
    input.team = ready(null);

    const briefing = buildTeamPilotBriefing(input);

    expect(briefing.nextMilestone).toMatchObject({
      id: 'team',
      status: 'next',
      action: { href: '/teams', label: 'Teams' },
    });
  });

  it('treats a selected personal team as incomplete', () => {
    const input = pilotInput();
    input.team = ready({ id: 'personal', name: 'Personal', personal: true });

    const briefing = buildTeamPilotBriefing(input);

    expect(briefing.nextMilestone?.id).toBe('team');
    expect(briefing.nextMilestone?.title).toBe('Select a project team');
  });

  it.each(['private', 'public'] as const)(
    'does not accept a %s diary as the shared diary milestone',
    (visibility) => {
      const input = pilotInput();
      input.diaries = ready([
        { id: 'diary-1', name: 'Wrong visibility', visibility },
      ]);

      const briefing = buildTeamPilotBriefing(input);

      expect(briefing.nextMilestone).toMatchObject({
        id: 'diary',
        title: 'Create a shared diary',
        action: { label: 'Diaries' },
      });
    },
  );

  it('advances to Teams when the project has no agent member', () => {
    const input = pilotInput();
    input.members = ready([]);

    const briefing = buildTeamPilotBriefing(input);

    expect(briefing.nextMilestone).toMatchObject({
      id: 'agent-key',
      title: 'Add a team agent',
      action: { href: '/teams', label: 'Teams' },
    });
  });

  it('requires an active key belonging to a visible team agent', () => {
    const input = pilotInput();
    input.agentKeys = ready({
      items: [
        { agentId: 'agent-1', status: 'revoked' },
        { agentId: 'other-agent', status: 'active' },
      ],
      isPartial: false,
    });

    const briefing = buildTeamPilotBriefing(input);

    expect(briefing.nextMilestone).toMatchObject({
      id: 'agent-key',
      title: 'Activate an agent key',
      action: { label: 'Agent Keys' },
    });
  });

  it('treats a partial unmatched key page as unavailable', () => {
    const input = pilotInput();
    input.agentKeys = ready({ items: [], isPartial: true });

    const briefing = buildTeamPilotBriefing(input);

    expect(briefing.nextMilestone).toMatchObject({
      id: 'agent-key',
      status: 'unavailable',
      title: 'Agent Keys unavailable',
    });
  });

  it('identifies unavailable team membership without blaming agent keys', () => {
    const input = pilotInput();
    input.members = { status: 'unavailable' };

    const briefing = buildTeamPilotBriefing(input);

    expect(briefing.nextMilestone).toMatchObject({
      id: 'agent-key',
      status: 'unavailable',
      title: 'Team members unavailable',
      action: { href: '/teams', label: 'Team members' },
    });
  });

  it('advances to Runtime Profiles when no profile exists', () => {
    const input = pilotInput();
    input.runtimeProfiles = ready([]);

    const briefing = buildTeamPilotBriefing(input);

    expect(briefing.nextMilestone).toMatchObject({
      id: 'runtime-profile',
      title: 'Create a runtime profile',
      action: { label: 'Runtime Profiles' },
    });
  });

  it('links to the active task when the first run is underway', () => {
    const input = pilotInput();
    input.activityTasks = ready([
      {
        acceptedAttemptN: null,
        id: 'task-1',
        status: 'running',
        title: 'Pilot task',
      },
    ]);

    const briefing = buildTeamPilotBriefing(input);

    expect(briefing.nextMilestone).toMatchObject({
      id: 'accepted-task',
      title: 'Finish the first task',
      action: { href: '/tasks/task-1', label: 'Pilot task' },
    });
  });

  it('does not activate for a completed task without an accepted attempt', () => {
    const input = pilotInput();
    input.completedTasks = ready([
      { acceptedAttemptN: null, id: 'task-1', status: 'completed' },
    ]);

    const briefing = buildTeamPilotBriefing(input);

    expect(briefing.isActivated).toBe(false);
    expect(briefing.nextMilestone?.id).toBe('accepted-task');
  });

  it('removes the briefing after an accepted completed task', () => {
    const input = pilotInput();
    input.completedTasks = ready([
      { acceptedAttemptN: 2, id: 'task-1', status: 'completed' },
    ]);

    const briefing = buildTeamPilotBriefing(input);

    expect(briefing.isActivated).toBe(true);
    expect(briefing.nextMilestone).toBeNull();
    expect(
      briefing.milestones.every((step) => step.status === 'complete'),
    ).toBe(true);
  });

  it('shows failed evidence as unavailable instead of incomplete', () => {
    const input = pilotInput();
    input.diaries = { status: 'unavailable' };

    const briefing = buildTeamPilotBriefing(input);

    expect(briefing.nextMilestone).toMatchObject({
      id: 'diary',
      status: 'unavailable',
      title: 'Diaries unavailable',
    });
    expect(briefing.nextMilestone?.detail).not.toMatch(/create/i);
  });

  it('keeps loading evidence unknown instead of treating it as empty', () => {
    const input = pilotInput();
    input.runtimeProfiles = { status: 'loading' };

    const briefing = buildTeamPilotBriefing(input);

    expect(briefing.nextMilestone).toMatchObject({
      id: 'runtime-profile',
      status: 'loading',
      title: 'Checking runtime profiles…',
    });
  });

  it('keeps setup actions read-only for members', () => {
    const input = pilotInput();
    input.canManage = false;
    input.runtimeProfiles = ready([]);

    const briefing = buildTeamPilotBriefing(input);

    expect(briefing.nextMilestone).toMatchObject({
      id: 'runtime-profile',
      title: 'Runtime profile needed',
      action: { href: '/runtime/profiles', label: 'Runtime Profiles' },
    });
    expect(briefing.nextMilestone?.detail).toMatch(/owner or manager/i);
  });
});
