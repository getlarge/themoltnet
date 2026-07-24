import type { TaskStatus } from '@moltnet/api-client';
import { describe, expect, it } from 'vitest';

import {
  buildTeamPilotBriefing,
  type PilotMember,
  type PilotTask,
} from '../src/overview/team-pilot.js';

const docsUrl = 'https://docs.example.test';
const personalTeam = { id: 'personal', name: 'Personal', personal: true };
const projectTeam = { id: 'project', name: 'Pilot', personal: false };
const diary = { id: 'diary-1', name: 'Project memory' };
const managerAgent: PilotMember = {
  displayName: 'Molt',
  role: 'manager',
  subjectType: 'agent',
};

function build({
  team = projectTeam,
  diaries = [diary],
  members = [managerAgent],
  tasks = [],
}: {
  team?: typeof projectTeam | null;
  diaries?: (typeof diary)[] | null;
  members?: PilotMember[] | null;
  tasks?: PilotTask[] | null;
} = {}) {
  return buildTeamPilotBriefing({
    team,
    diaries,
    docsUrl,
    members,
    tasks,
  });
}

type BuildInput = NonNullable<Parameters<typeof build>[0]>;

describe('buildTeamPilotBriefing', () => {
  it.each<{
    name: string;
    input: BuildInput;
    statuses: string[];
    summary: string;
  }>([
    {
      name: 'personal team',
      input: {
        team: personalTeam,
        diaries: [diary],
        members: [managerAgent],
        tasks: [{ status: 'completed' satisfies TaskStatus }],
      },
      statuses: ['not_started', 'not_started', 'not_started'],
      summary: 'Start by creating a project workspace.',
    },
    {
      name: 'project team without a diary',
      input: { diaries: [], members: [], tasks: [] },
      statuses: ['ready', 'not_started', 'not_started'],
      summary: 'Start by creating a project workspace.',
    },
    {
      name: 'workspace without an agent',
      input: { members: [], tasks: [] },
      statuses: ['complete', 'ready', 'not_started'],
      summary: 'Next, ready a team agent for this project.',
    },
    {
      name: 'workspace and agent without a task',
      input: { tasks: [] },
      statuses: ['complete', 'complete', 'ready'],
      summary: 'Queue a narrow first task and supervise its result.',
    },
    {
      name: 'queued task',
      input: { tasks: [{ status: 'queued' satisfies TaskStatus }] },
      statuses: ['complete', 'complete', 'ready'],
      summary: 'Your task is queued; keep an authorized agent daemon running.',
    },
    {
      name: 'running task',
      input: { tasks: [{ status: 'running' satisfies TaskStatus }] },
      statuses: ['complete', 'complete', 'in_progress'],
      summary: 'Your first supervised task is in progress.',
    },
    {
      name: 'completed task',
      input: { tasks: [{ status: 'completed' satisfies TaskStatus }] },
      statuses: ['complete', 'complete', 'complete'],
      summary: 'Your team-pilot loop is complete.',
    },
  ])('$name moves the pilot through the expected phases', (testCase) => {
    const briefing = build(testCase.input);

    expect(briefing.phases.map((phase) => phase.status)).toEqual(
      testCase.statuses,
    );
    expect(briefing.summary).toBe(testCase.summary);
  });

  it.each<TaskStatus>(['failed', 'cancelled', 'expired'])(
    'surfaces a %s first task as needing review',
    (status) => {
      const briefing = build({ tasks: [{ status }] });

      expect(briefing.phases[2]).toMatchObject({
        status: 'needs_attention',
        title: 'First task needs review',
      });
      expect(briefing.failedTaskCount).toBe(1);
    },
  );

  it('uses claim-condition remediation for waiting tasks', () => {
    const briefing = build({ tasks: [{ status: 'waiting' }] });

    expect(briefing.phases[2]).toMatchObject({
      status: 'needs_attention',
      title: 'Task waiting on a condition',
    });
    expect(briefing.phases[2]?.detail).toMatch(/unmet claim condition/i);
    expect(briefing.phases[2]?.detail).not.toMatch(/running agent-daemon/i);
  });

  it.each([
    {
      statuses: ['queued', 'running'] satisfies TaskStatus[],
      expected: 'in_progress',
    },
    {
      statuses: ['queued', 'running', 'completed'] satisfies TaskStatus[],
      expected: 'complete',
    },
  ])(
    'applies completed then active then queued precedence for $statuses',
    ({ statuses, expected }) => {
      const briefing = build({
        tasks: statuses.map((status) => ({ status })),
      });

      expect(briefing.phases[2]?.status).toBe(expected);
    },
  );

  it.each([
    {
      name: 'owner agent',
      member: {
        displayName: 'Owner agent',
        role: 'owner',
        subjectType: 'agent',
      } satisfies PilotMember,
    },
    {
      name: 'member agent with possible diary grant',
      member: {
        displayName: 'Writer agent',
        role: 'member',
        subjectType: 'agent',
      } satisfies PilotMember,
    },
  ])('treats a visible $name as onboarding progress', ({ member }) => {
    const briefing = build({ members: [member] });

    expect(briefing.phases[1]).toMatchObject({
      status: 'complete',
      title: 'Team agent ready',
    });
  });

  it('does not mistake a human manager for an agent', () => {
    const briefing = build({
      members: [
        {
          displayName: 'Human lead',
          role: 'manager',
          subjectType: 'human',
        },
      ],
    });

    expect(briefing.phases[1]?.status).toBe('ready');
    expect(briefing.agentMember).toBeNull();
  });

  it('uses the configured docs base for agent setup', () => {
    const briefing = build({ members: [] });

    expect(briefing.phases[1]?.action.href).toBe(
      'https://docs.example.test/start/install-and-initialize',
    );
  });

  it('reports diary count instead of selecting an arbitrary shared diary', () => {
    const briefing = build({
      diaries: [diary, { id: 'diary-2', name: 'Decisions' }],
    });

    expect(briefing.phases[0]?.detail).toBe(
      'Pilot has 2 project diaries available.',
    );
  });

  it.each([
    {
      name: 'diaries',
      input: { diaries: null },
      phase: 0,
      title: 'Diary status unavailable',
    },
    {
      name: 'members',
      input: { members: null },
      phase: 1,
      title: 'Team member status unavailable',
    },
    {
      name: 'tasks',
      input: { tasks: null },
      phase: 2,
      title: 'Task status unavailable',
    },
  ])(
    'degrades only the $name phase when its data is unavailable',
    (testCase) => {
      const briefing = build(testCase.input);

      expect(briefing.phases[testCase.phase]).toMatchObject({
        status: 'unavailable',
        title: testCase.title,
      });
      expect(
        briefing.phases.filter((phase) => phase.status === 'unavailable'),
      ).toHaveLength(1);
    },
  );
});
