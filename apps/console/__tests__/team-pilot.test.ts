import { describe, expect, it } from 'vitest';

import { buildTeamPilotBriefing } from '../src/overview/team-pilot.js';

describe('buildTeamPilotBriefing', () => {
  it('starts with a project workspace when only a personal team is selected', () => {
    const briefing = buildTeamPilotBriefing({
      team: { id: 'personal', name: 'Personal', personal: true },
      diaries: [],
      members: [],
      tasks: [],
    });

    expect(briefing.summary).toBe('Start by creating a project workspace.');
    expect(briefing.phases[0]).toMatchObject({
      status: 'not_started',
      action: { href: '/teams', label: 'Choose a project team' },
    });
    expect(briefing.phases[1]?.status).toBe('not_started');
  });

  it('makes the queued-task dependency on a running manager daemon explicit', () => {
    const briefing = buildTeamPilotBriefing({
      team: { id: 'project', name: 'Pilot', personal: false },
      diaries: [{ id: 'diary-1', name: 'Project memory' }],
      members: [{ displayName: 'Molt', role: 'manager', subjectType: 'agent' }],
      tasks: [{ status: 'queued' }],
    });

    expect(briefing.phases[1]).toMatchObject({ status: 'complete' });
    expect(briefing.phases[2]).toMatchObject({ status: 'ready' });
    expect(briefing.phases[2]?.detail).toMatch(/running agent-daemon/i);
  });

  it('reports a completed team pilot without hiding the task history', () => {
    const briefing = buildTeamPilotBriefing({
      team: { id: 'project', name: 'Pilot', personal: false },
      diaries: [{ id: 'diary-1', name: 'Project memory' }],
      members: [{ displayName: 'Molt', role: 'manager', subjectType: 'agent' }],
      tasks: [{ status: 'completed' }, { status: 'completed' }],
    });

    expect(briefing.summary).toBe('Your team-pilot loop is complete.');
    expect(briefing.phases[2]).toMatchObject({
      status: 'complete',
      action: { href: '/tasks', label: 'Review tasks' },
    });
  });
});
