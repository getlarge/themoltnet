import { inlineContext } from '@themoltnet/tasks-orchestrator';
import { FakeTasks } from '@themoltnet/tasks-orchestrator/testing';
import { describe, expect, it, type Mock, vi } from 'vitest';

import {
  type ArtifactStore,
  type ContentRadarInput,
  DOSSIER_ARTIFACT_KIND,
  type Watchlist,
  WIREFRAME_ARTIFACT_KIND,
} from './types.js';
import { watchlistSha256 } from './watchlist.js';
import { runContentRadar } from './workflow.js';

const WATCHLIST: Watchlist = {
  version: 1,
  repos: [
    {
      slug: 'themoltnet',
      repository: 'getlarge/themoltnet',
      sinceDays: 30,
      diaryId: '6e4d9948-8ec5-4f59-b82a-3acbc4bbc396',
    },
  ],
  segments: [
    {
      slug: 'agent-runtimes',
      title: 'Agent runtimes',
      organisations: ['Anthropic'],
      queries: ['headless agents'],
      sinceDays: 21,
    },
  ],
  editorialFocus: 'agents moving from local and interactive to headless.',
};

function input(overrides: Partial<ContentRadarInput> = {}): ContentRadarInput {
  return {
    teamId: '11111111-1111-4111-8111-111111111111',
    diaryId: '22222222-2222-4222-8222-222222222222',
    correlationId: '33333333-3333-4333-8333-333333333333',
    maxDrafts: 2,
    pollIntervalSec: 0,
    watchlistManifest: {
      watchlist: WATCHLIST,
      sha256: watchlistSha256(WATCHLIST),
      artifact: {
        cid: 'bafy-watchlist',
        title: 'content-radar-watchlist.v1.json',
        contentType: 'application/json',
        sizeBytes: 512,
      },
    },
    ...overrides,
  };
}

function artifactStore(): { artifacts: ArtifactStore; stage: Mock } {
  const stage = vi.fn((bytes: Uint8Array) =>
    Promise.resolve({
      cid: 'bafy-ledger',
      contentType: 'application/json',
      sizeBytes: bytes.byteLength,
    }),
  );
  return { artifacts: { stage } as ArtifactStore, stage };
}

const WORK_OUTPUT = {
  summary: JSON.stringify({
    version: 1,
    repo: 'themoltnet',
    signals: [
      {
        kind: 'pull_request',
        title: 'Server-gated joins',
        reference: 'PR #1498',
        summary: 'Downstream claims gate on N upstream completions.',
        evidence: 'libs/tasks-orchestrator/src/join.ts',
      },
    ],
  }),
};

const MARKET_OUTPUT = {
  summary: JSON.stringify({
    version: 1,
    segment: 'agent-runtimes',
    signals: [
      {
        organisation: 'Anthropic',
        title: 'Remote agent sessions',
        url: 'https://example.com/remote-agents',
        summary: 'Agents run off the developer laptop.',
      },
    ],
  }),
};

const PLAN_OUTPUT = {
  summary: JSON.stringify({
    version: 1,
    tracks: [
      {
        id: 'promises-not-commands',
        title: 'Promises, not commands',
        thesis: 'You cannot assign work to an autonomous agent.',
        format: 'article',
        workSignalIds: ['work:themoltnet:01'],
        marketSignalIds: ['market:agent-runtimes:01'],
        rationale: 'The market shipped what the join primitive assumed.',
        confidence: 'high',
      },
    ],
  }),
};

const DRAFT_OUTPUT = {
  summary: JSON.stringify({
    version: 1,
    trackId: 'promises-not-commands',
    slug: 'promises-not-commands',
    workingTitle: 'Promises, not commands',
    description: 'Why a task system for agents looks like this.',
    tags: ['ai-agents'],
    claims: [
      {
        signalId: 'work:themoltnet:01',
        claim: 'The join is server-enforced.',
      },
    ],
    openQuestions: ['Which series does this belong to?'],
  }),
  artifacts: [
    {
      kind: DOSSIER_ARTIFACT_KIND,
      title: 'dossier.md',
      cid: 'bafy-dossier',
      sizeBytes: 4096,
    },
    {
      kind: WIREFRAME_ARTIFACT_KIND,
      title: 'wireframe.md',
      cid: 'bafy-wireframe',
      sizeBytes: 2048,
    },
  ],
};

describe('runContentRadar', () => {
  it('scans, sweeps, correlates, and drafts one dossier per track', async () => {
    // Arrange
    const tasks = new FakeTasks([
      WORK_OUTPUT,
      MARKET_OUTPUT,
      PLAN_OUTPUT,
      DRAFT_OUTPUT,
    ]);
    const { artifacts, stage } = artifactStore();

    // Act
    const output = await runContentRadar(input(), inlineContext, {
      tasks,
      artifacts,
    });

    // Assert
    expect(output.outcome).toBe('drafted');
    expect(output.ledger.work[0].id).toBe('work:themoltnet:01');
    expect(output.ledger.market[0].id).toBe('market:agent-runtimes:01');
    expect(output.plan.tracks).toHaveLength(1);
    expect(output.dossiers[0].dossierArtifact.cid).toBe('bafy-dossier');
    expect(output.diagnostics.tracksDrafted).toBe(1);
    expect(output.diagnostics.watchlistSha256).toBe(watchlistSha256(WATCHLIST));
    expect(stage).toHaveBeenCalledTimes(1);
  });

  it('gates correlation on every scan and sweep task', async () => {
    // Arrange
    const tasks = new FakeTasks([
      WORK_OUTPUT,
      MARKET_OUTPUT,
      PLAN_OUTPUT,
      DRAFT_OUTPUT,
    ]);

    // Act
    await runContentRadar(input(), inlineContext, {
      tasks,
      artifacts: artifactStore().artifacts,
    });

    // Assert — the correlate body is the third created task.
    const correlate = tasks.created[2] as {
      claimCondition?: { tasks?: string[] };
    };
    const upstream = tasks.created
      .slice(0, 2)
      .map(
        (_, index) =>
          `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      );
    expect(correlate.claimCondition).toBeDefined();
    expect(JSON.stringify(correlate.claimCondition)).toContain(upstream[0]);
    expect(JSON.stringify(correlate.claimCondition)).toContain(upstream[1]);
  });

  it('pins each phase to its routed runtime profile', async () => {
    // Arrange
    const tasks = new FakeTasks([
      WORK_OUTPUT,
      MARKET_OUTPUT,
      PLAN_OUTPUT,
      DRAFT_OUTPUT,
    ]);

    // Act
    await runContentRadar(
      input({
        profileRouting: {
          defaultProfileId: 'profile-default',
          scanProfileId: 'profile-scan',
          sweepProfileId: 'profile-sweep',
          draftProfileId: 'profile-draft',
        },
      }),
      inlineContext,
      { tasks, artifacts: artifactStore().artifacts },
    );

    // Assert
    const profiles = tasks.created.map(
      (body) =>
        (body as { allowedProfiles?: Array<{ profileId: string }> })
          .allowedProfiles?.[0]?.profileId,
    );
    expect(profiles).toEqual([
      'profile-scan',
      'profile-sweep',
      'profile-default',
      'profile-draft',
    ]);
  });

  it('stops before correlation when one evidence stream is empty', async () => {
    // Arrange — the sweep returns nothing, so no track can correlate.
    const emptySweep = {
      summary: JSON.stringify({
        version: 1,
        segment: 'agent-runtimes',
        signals: [],
      }),
    };
    const tasks = new FakeTasks([WORK_OUTPUT, emptySweep]);
    const { artifacts, stage } = artifactStore();

    // Act
    const output = await runContentRadar(input(), inlineContext, {
      tasks,
      artifacts,
    });

    // Assert
    expect(output.outcome).toBe('no_tracks');
    expect(output.plan.tracks).toEqual([]);
    expect(tasks.created).toHaveLength(2);
    expect(stage).not.toHaveBeenCalled();
  });

  it('fails the run when a draft cites a signal outside its track', async () => {
    // Arrange
    const stolenCitation = {
      ...DRAFT_OUTPUT,
      summary: JSON.stringify({
        ...JSON.parse(DRAFT_OUTPUT.summary),
        claims: [
          { signalId: 'market:agent-runtimes:99', claim: 'Invented source.' },
        ],
      }),
    };
    const tasks = new FakeTasks([
      WORK_OUTPUT,
      MARKET_OUTPUT,
      PLAN_OUTPUT,
      stolenCitation,
    ]);

    // Act / Assert
    await expect(
      runContentRadar(input(), inlineContext, {
        tasks,
        artifacts: artifactStore().artifacts,
      }),
    ).rejects.toThrow('is not a source assigned to track');
  });

  it('counts token usage across every phase', async () => {
    const tasks = new FakeTasks([
      WORK_OUTPUT,
      MARKET_OUTPUT,
      PLAN_OUTPUT,
      DRAFT_OUTPUT,
    ]);
    const output = await runContentRadar(input(), inlineContext, {
      tasks,
      artifacts: artifactStore().artifacts,
    });
    expect(output.diagnostics.cost.tasksCreated).toBe(4);
  });
});
