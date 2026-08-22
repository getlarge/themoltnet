/* eslint-disable no-console */
import { benchmarkDistribution } from './benchmark-stats.js';
import {
  evaluateBenchmarkGate,
  isLoopbackEndpoint,
} from './keto-claim-benchmark.js';

type Tuple = {
  namespace: string;
  object: string;
  relation: string;
  subject_set: { namespace: string; object: string; relation: string };
};
type Target = {
  name: 'baseline' | 'candidate';
  read: string;
  write: string;
  revision: string;
};
type Scenario =
  | 'owner'
  | 'manager'
  | 'executor'
  | 'member'
  | 'task-writer'
  | 'task-manager'
  | 'denied';

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, ...rest] = arg.split('=');
    return [key, rest.join('=') || 'true'];
  }),
);
const numberArg = (name: string, fallback: number) =>
  Number.parseInt(args.get(name) ?? String(fallback), 10);
const teams = numberArg('--teams', 100);
const identities = numberArg('--identities-per-team', 100);
const tasks = numberArg('--tasks-per-team', 100);
const rounds = numberArg('--rounds', 5);
const samples = numberArg('--samples', 1000);
if (identities < 7) throw new Error('--identities-per-team must be at least 7');

const targets: Target[] = [
  {
    name: 'baseline',
    read: args.get('--baseline-read-url') ?? 'http://127.0.0.1:4466',
    write: args.get('--baseline-write-url') ?? 'http://127.0.0.1:4467',
    revision: args.get('--baseline-opl-revision') ?? 'executor-transition',
  },
  {
    name: 'candidate',
    read: args.get('--candidate-read-url') ?? 'http://127.0.0.1:4566',
    write: args.get('--candidate-write-url') ?? 'http://127.0.0.1:4567',
    revision: args.get('--candidate-opl-revision') ?? 'executor-final',
  },
];
if (!args.has('--allow-non-loopback')) {
  for (const target of targets) {
    for (const endpoint of [target.read, target.write]) {
      if (!isLoopbackEndpoint(endpoint)) {
        throw new Error(
          `Refusing non-loopback endpoint ${endpoint}; pass --allow-non-loopback to override`,
        );
      }
    }
  }
}

const prefix = `bench-claim-${process.pid}`;
const tuples = buildFixtures(prefix, teams, identities, tasks);
const scenarios = [
  'owner',
  'manager',
  'executor',
  'member',
  'task-writer',
  'task-manager',
  'denied',
] as const;
const results: Record<string, unknown> = {};

try {
  for (const target of targets) await patch(target, 'insert', tuples);
  for (const target of targets) {
    results[target.name] = {
      ketoVersion: await ketoVersion(target.read),
      oplRevision: target.revision,
      scenarios: Object.fromEntries(
        scenarios.map((scenario) => [scenario, []]),
      ),
    };
  }

  // Measure both isolated Keto processes at the same time in each round so
  // host warm-up and transient Docker load cannot favor the process that ran
  // first. Each target still receives the requested per-target concurrency.
  for (const scenario of scenarios) {
    for (const concurrency of [1, 32]) {
      for (let round = 0; round < rounds; round++) {
        await Promise.all(
          targets.map(async (target) => {
            scenarioRuns(results[target.name], scenario).push(
              await runRound(
                target,
                scenario,
                concurrency,
                round,
                samples,
                prefix,
                teams,
                identities,
                tasks,
              ),
            );
          }),
        );
      }
    }
  }

  const gates: Record<string, unknown> = {};
  let passed = true;
  for (const scenario of scenarios) {
    const baselineRuns = scenarioRuns(results.baseline, scenario);
    const candidateRuns = scenarioRuns(results.candidate, scenario);
    const gate = evaluateBenchmarkGate({
      baselineP95: baselineRuns
        .filter((run) => run.concurrency === 1)
        .map((run) => run.p95),
      candidateP95: candidateRuns
        .filter((run) => run.concurrency === 1)
        .map((run) => run.p95),
      baselineThroughput32: baselineRuns
        .filter((run) => run.concurrency === 32)
        .map((run) => run.throughput),
      candidateThroughput32: candidateRuns
        .filter((run) => run.concurrency === 32)
        .map((run) => run.throughput),
    });
    gates[scenario] = gate;
    passed &&= gate.passed;
  }
  console.log(
    JSON.stringify(
      {
        fixture: {
          teams,
          identitiesPerTeam: identities,
          tasksPerTeam: tasks,
          rounds,
          samples,
          concurrency: [1, 32],
        },
        results,
        gates,
        passed,
      },
      null,
      2,
    ),
  );
  if (!passed) process.exitCode = 1;
} finally {
  await Promise.allSettled(
    targets.map((target) => patch(target, 'delete', tuples)),
  );
}

function buildFixtures(
  prefixValue: string,
  teamCount: number,
  identityCount: number,
  taskCount: number,
): Tuple[] {
  const fixtures: Tuple[] = [];
  for (let team = 0; team < teamCount; team++) {
    const teamId = `${prefixValue}-team-${team}`;
    const agent = (index: number) => `${prefixValue}-agent-${team}-${index}`;
    for (const relation of ['owners', 'executors'] as const)
      fixtures.push(teamTuple(teamId, relation, agent(0)));
    for (const relation of ['managers', 'executors'] as const)
      fixtures.push(teamTuple(teamId, relation, agent(1)));
    fixtures.push(
      teamTuple(teamId, 'executors', agent(2)),
      teamTuple(teamId, 'members', agent(2)),
    );
    for (let identity = 3; identity < identityCount; identity++)
      fixtures.push(teamTuple(teamId, 'members', agent(identity)));
    for (let task = 0; task < taskCount; task++) {
      const taskId = `${prefixValue}-task-${team}-${task}`;
      fixtures.push({
        namespace: 'Task',
        object: taskId,
        relation: 'team',
        subject_set: { namespace: 'Team', object: teamId, relation: '' },
      });
      fixtures.push({
        namespace: 'Task',
        object: taskId,
        relation: 'writers',
        subject_set: {
          namespace: 'Agent',
          object: agent(identityCount - 2),
          relation: '',
        },
      });
      fixtures.push({
        namespace: 'Task',
        object: taskId,
        relation: 'managers',
        subject_set: {
          namespace: 'Agent',
          object: agent(identityCount - 1),
          relation: '',
        },
      });
    }
  }
  return fixtures;
}

function teamTuple(teamId: string, relation: string, agentId: string): Tuple {
  return {
    namespace: 'Team',
    object: teamId,
    relation,
    subject_set: { namespace: 'Agent', object: agentId, relation: '' },
  };
}

async function patch(
  target: Target,
  action: 'insert' | 'delete',
  values: Tuple[],
) {
  for (let offset = 0; offset < values.length; offset += 100) {
    const response = await fetch(`${target.write}/admin/relation-tuples`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(
        values
          .slice(offset, offset + 100)
          .map((relation_tuple) => ({ action, relation_tuple })),
      ),
    });
    if (!response.ok)
      throw new Error(
        `${target.name} fixture ${action} failed (${response.status}): ${await response.text()}`,
      );
  }
}

async function runRound(
  target: Target,
  scenario: Scenario,
  concurrency: number,
  round: number,
  count: number,
  prefixValue: string,
  teamCount: number,
  identityCount: number,
  taskCount: number,
) {
  const durations: number[] = [];
  let cursor = 0;
  const started = performance.now();
  const worker = async () => {
    while (true) {
      const sample = cursor++;
      if (sample >= count) return;
      const team = (sample + round * count) % teamCount;
      const task = (sample * 17 + round) % taskCount;
      const index = {
        owner: 0,
        manager: 1,
        executor: 2,
        member: 3,
        denied: identityCount - 3,
        'task-writer': identityCount - 2,
        'task-manager': identityCount - 1,
      }[scenario];
      const params = new URLSearchParams({
        namespace: 'Task',
        object: `${prefixValue}-task-${team}-${task}`,
        relation: 'claim',
        'subject_set.namespace': 'Agent',
        'subject_set.object': `${prefixValue}-agent-${team}-${index}`,
        'subject_set.relation': '',
      });
      const before = performance.now();
      const response = await fetch(
        `${target.read}/relation-tuples/check?${params}`,
      );
      // Keto represents a denied permission as 403 with
      // `{ "allowed": false }`; both outcomes are benchmark samples.
      if (!response.ok && response.status !== 403)
        throw new Error(`${target.name} check failed (${response.status})`);
      const result = (await response.json()) as { allowed: boolean };
      const expected =
        scenario === 'owner' ||
        scenario === 'manager' ||
        scenario === 'task-writer' ||
        scenario === 'task-manager' ||
        (target.name === 'candidate' && scenario === 'executor');
      if (result.allowed !== expected) {
        throw new Error(
          `${target.name} ${scenario} check returned allowed=${result.allowed}; expected ${expected}`,
        );
      }
      durations.push(performance.now() - before);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  const elapsed = performance.now() - started;
  const distribution = benchmarkDistribution(durations);
  if (!distribution) throw new Error('benchmark produced no samples');
  return {
    round: round + 1,
    concurrency,
    p50: distribution.p50,
    p95: distribution.p95,
    p99: distribution.p99,
    mean: distribution.mean,
    throughput: Math.round((count / elapsed) * 1_000 * 1_000) / 1_000,
  };
}

async function ketoVersion(readUrl: string): Promise<string> {
  try {
    const response = await fetch(`${readUrl}/version`);
    return response.ok
      ? (await response.text()).trim()
      : `unknown (${response.status})`;
  } catch {
    return 'unknown';
  }
}

type Run = { concurrency: number; p95: number; throughput: number };
function scenarioRuns(result: unknown, scenario: Scenario): Run[] {
  return (
    (result as { scenarios: Record<string, Run[]> }).scenarios[scenario] ?? []
  );
}
