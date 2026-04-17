import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import { judge, type JudgeResult } from './judge.ts';
import { fetchRenderedPack } from './pack.ts';
import { type AgentRunResult, runAgent } from './runAgent.ts';
import { loadScenario, type Scenario } from './scenarios.ts';

const RESULTS_ROOT = path.resolve(process.cwd(), 'results');

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}

function list(name: string, fallback: string[]): string[] {
  const v = process.env[name];
  return v
    ? v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : fallback;
}

type Row = {
  scenario: string;
  cold: number;
  warm: number;
  delta: number;
  coldOk: boolean;
  warmOk: boolean;
};

async function runOne(
  scenario: Scenario,
  pack: string,
  agentModel: string,
  judgeModel: string,
): Promise<Row> {
  const coldDir = path.join(RESULTS_ROOT, scenario.id, 'cold');
  const warmDir = path.join(RESULTS_ROOT, scenario.id, 'warm');

  console.log(`[${scenario.id}] running cold + warm in parallel…`);
  const [coldRun, warmRun] = await Promise.all([
    runAgent({ sandboxDir: coldDir, task: scenario.task, model: agentModel }),
    runAgent({
      sandboxDir: warmDir,
      task: scenario.task,
      extraContext: pack,
      model: agentModel,
    }),
  ]);

  console.log(`[${scenario.id}] judging…`);
  const [coldScore, warmScore] = await Promise.all([
    judge({
      criteria: scenario.criteria,
      workspaceDir: coldDir,
      model: judgeModel,
    }),
    judge({
      criteria: scenario.criteria,
      workspaceDir: warmDir,
      model: judgeModel,
    }),
  ]);

  await writeArtifacts(scenario.id, 'cold', coldRun, coldScore);
  await writeArtifacts(scenario.id, 'warm', warmRun, warmScore);

  return {
    scenario: scenario.id,
    cold: coldScore.pct,
    warm: warmScore.pct,
    delta: warmScore.pct - coldScore.pct,
    coldOk: coldRun.ok,
    warmOk: warmRun.ok,
  };
}

async function writeArtifacts(
  scenarioId: string,
  kind: 'cold' | 'warm',
  run: AgentRunResult,
  score: JudgeResult,
) {
  const file = path.join(RESULTS_ROOT, scenarioId, `${kind}.json`);
  await writeFile(file, JSON.stringify({ run, score }, null, 2), 'utf8');
}

function printTable(rows: Row[]) {
  const col = (s: string, w: number) => s.padEnd(w);
  const num = (n: number) => `${n.toFixed(1).padStart(5)}%`;
  const sign = (n: number) => (n >= 0 ? `+${n.toFixed(1)}` : n.toFixed(1));

  console.log('');
  console.log(col('Scenario', 40) + col('Cold', 10) + col('Warm', 10) + 'Δ');
  console.log('-'.repeat(70));
  for (const r of rows) {
    console.log(
      col(r.scenario, 40) +
        col(num(r.cold), 10) +
        col(num(r.warm), 10) +
        sign(r.delta),
    );
  }
  const avgDelta =
    rows.reduce((s, r) => s + r.delta, 0) / Math.max(1, rows.length);
  console.log('-'.repeat(70));
  console.log(col('average Δ', 60) + sign(avgDelta));
}

async function main() {
  const apiKey = required('ANTHROPIC_API_KEY');
  process.env.ANTHROPIC_API_KEY = apiKey;

  const credentials = required('MOLTNET_CREDENTIALS');
  const packId = required('MOLTNET_RENDERED_PACK_ID');
  const agentModel = process.env.AGENT_MODEL ?? 'claude-opus-4-7';
  const judgeModel = process.env.JUDGE_MODEL ?? 'claude-opus-4-7';
  const scenarioIds = list('SCENARIOS', [
    'auth-middleware-early-return',
    'repository-tenant-scope-bypass',
    'e2e-raw-fetch-vs-api-client',
  ]);

  console.log(`agent model: ${agentModel}`);
  console.log(`judge model: ${judgeModel}`);
  console.log(`scenarios:   ${scenarioIds.join(', ')}`);
  console.log(`pack:        ${packId}`);
  console.log('');

  console.log('fetching rendered pack from MoltNet…');
  const pack = await fetchRenderedPack({ packId, credentials });
  console.log(`pack loaded: ${pack.length} chars`);

  const scenarios = await Promise.all(scenarioIds.map(loadScenario));

  const rows: Row[] = [];
  for (const s of scenarios) {
    rows.push(await runOne(s, pack, agentModel, judgeModel));
  }

  printTable(rows);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
