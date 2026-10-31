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
  it('maps live state onto the three journey steps and their docs pages', () => {
    const input = pilotInput();

    const briefing = buildTeamPilotBriefing(input);

    expect(
      briefing.steps.map(({ id, label, docsPath }) => ({
        id,
        label,
        docsPath,
      })),
    ).toEqual([
      {
        id: 'identity',
        label: 'Give an agent its own identity',
        docsPath: '/start/agent-identity',
      },
      {
        id: 'job',
        label: "Give it a job it can't overstep",
        docsPath: '/start/first-task',
      },
      {
        id: 'record',
        label: 'Read what it did',
        docsPath: '/start/read-the-record',
      },
    ]);
  });

  it('starts step 1 with Teams when no project team exists', () => {
    const input = pilotInput();
    input.team = ready(null);

    const briefing = buildTeamPilotBriefing(input);

    expect(briefing.nextStep).toMatchObject({
      id: 'identity',
      status: 'next',
      title: 'Select a project team',
      action: { href: '/teams', label: 'Teams' },
    });
  });

  it('treats a selected personal team as incomplete', () => {
    const input = pilotInput();
    input.team = ready({ id: 'personal', name: 'Personal', personal: true });

    const briefing = buildTeamPilotBriefing(input);

    expect(briefing.nextStep?.id).toBe('identity');
    expect(briefing.nextStep?.title).toBe('Select a project team');
  });

  it.each(['private', 'public'] as const)(
    'does not count a %s diary as the step 2 shared diary',
    (visibility) => {
      const input = pilotInput();
      input.diaries = ready([
        { id: 'diary-1', name: 'Wrong visibility', visibility },
      ]);

      const briefing = buildTeamPilotBriefing(input);

      expect(briefing.steps[0]?.status).toBe('complete');
      expect(briefing.nextStep).toMatchObject({
        id: 'job',
        title: 'Create a shared diary',
        action: { label: 'Diaries' },
      });
    },
  );

  it('keeps step 1 on Teams when the project has no agent member', () => {
    const input = pilotInput();
    input.members = ready([]);

    const briefing = buildTeamPilotBriefing(input);

    expect(briefing.nextStep).toMatchObject({
      id: 'identity',
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

    expect(briefing.nextStep).toMatchObject({
      id: 'identity',
      title: 'Activate an agent key',
      action: { label: 'Agent Keys' },
    });
  });

  it('treats a partial unmatched key page as unavailable', () => {
    const input = pilotInput();
    input.agentKeys = ready({ items: [], isPartial: true });

    const briefing = buildTeamPilotBriefing(input);

    expect(briefing.nextStep).toMatchObject({
      id: 'identity',
      status: 'unavailable',
      title: 'Agent Keys unavailable',
    });
  });

  it('identifies unavailable team membership without blaming agent keys', () => {
    const input = pilotInput();
    input.members = { status: 'unavailable' };

    const briefing = buildTeamPilotBriefing(input);

    expect(briefing.nextStep).toMatchObject({
      id: 'identity',
      status: 'unavailable',
      title: 'Team members unavailable',
      action: { href: '/teams', label: 'Team members' },
    });
  });

  it('completes step 1 and starts step 2 at Runtime Profiles when no profile exists', () => {
    const input = pilotInput();
    input.runtimeProfiles = ready([]);

    const briefing = buildTeamPilotBriefing(input);

    expect(briefing.steps[0]?.status).toBe('complete');
    expect(briefing.nextStep).toMatchObject({
      id: 'job',
      title: 'Create a runtime profile',
      action: { label: 'Runtime Profiles' },
    });
  });

  it('keeps step 2 open until a task exists', () => {
    const input = pilotInput();

    const briefing = buildTeamPilotBriefing(input);

    expect(briefing.nextStep).toMatchObject({
      id: 'job',
      status: 'next',
      title: 'Create the first task',
      action: { href: '/tasks?create=1', label: 'New Task' },
    });
    expect(briefing.steps[2]?.status).toBe('upcoming');
  });

  it('moves to step 3 and links the active task while the first run is underway', () => {
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

    expect(briefing.steps[1]?.status).toBe('complete');
    expect(briefing.nextStep).toMatchObject({
      id: 'record',
      title: 'Follow the first task',
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
    expect(briefing.nextStep?.id).toBe('record');
    expect(briefing.recordTask).toBeNull();
  });

  it('completes all three steps and exposes the record of the completed task', () => {
    const input = pilotInput();
    input.completedTasks = ready([
      {
        acceptedAttemptN: 2,
        id: 'task-1',
        status: 'completed',
        title: 'First job',
      },
    ]);

    const briefing = buildTeamPilotBriefing(input);

    expect(briefing.isActivated).toBe(true);
    expect(briefing.nextStep).toBeNull();
    expect(briefing.steps.every((step) => step.status === 'complete')).toBe(
      true,
    );
    expect(briefing.recordTask).toEqual({ id: 'task-1', title: 'First job' });
    expect(briefing.steps[2]?.action).toEqual({
      href: '/tasks/task-1',
      label: 'See what your agent did',
    });
  });

  it('never describes a human acceptance step', () => {
    const input = pilotInput();
    input.activityTasks = ready([
      { acceptedAttemptN: null, id: 'task-1', status: 'running' },
    ]);

    const briefing = buildTeamPilotBriefing(input);

    for (const step of briefing.steps) {
      expect(`${step.title} ${step.detail}`).not.toMatch(
        /accept|approv|supervis/i,
      );
    }
  });

  it('shows failed diary evidence on step 2 as unavailable instead of incomplete', () => {
    const input = pilotInput();
    input.diaries = { status: 'unavailable' };

    const briefing = buildTeamPilotBriefing(input);

    expect(briefing.steps[0]?.status).toBe('complete');
    expect(briefing.nextStep).toMatchObject({
      id: 'job',
      status: 'unavailable',
      title: 'Diaries unavailable',
    });
    expect(briefing.nextStep?.detail).not.toMatch(/create/i);
  });

  it('keeps loading evidence unknown instead of treating it as empty', () => {
    const input = pilotInput();
    input.runtimeProfiles = { status: 'loading' };

    const briefing = buildTeamPilotBriefing(input);

    expect(briefing.nextStep).toMatchObject({
      id: 'job',
      status: 'loading',
      title: 'Checking runtime profiles…',
    });
  });

  it('keeps setup actions read-only for members', () => {
    const input = pilotInput();
    input.canManage = false;
    input.runtimeProfiles = ready([]);

    const briefing = buildTeamPilotBriefing(input);

    expect(briefing.nextStep).toMatchObject({
      id: 'job',
      title: 'Runtime profile needed',
      action: { href: '/runtime/profiles', label: 'Runtime Profiles' },
    });
    expect(briefing.nextStep?.detail).toMatch(/owner or manager/i);
  });
});
