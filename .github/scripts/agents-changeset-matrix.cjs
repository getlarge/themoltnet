// Compute Nx Cloud agent matrix size from the affected slice.
//
// Inputs (env): NX_BASE, NX_HEAD (set by the caller; nx-set-shas in CI).
// Outputs (GitHub Actions outputs):
//   matrix          : JSON {agent: [1..N]} for the agents pool
//   tier            : "none" | "small" | "medium" | "large"
//   has-agents      : "true" | "false"
//   affected-count, total-count, percent
//
// Tiers map % of affected projects → agent count:
//   none   : 0 affected   → 0 agents (skip DTE entirely)
//   small  : 1–32%        → 2 agents
//   medium : 33–66%       → 3 agents
//   large  : 67–100%      → 4 agents
//
// Agents are 1-indexed contiguous ranges. The matrix shape is
// `{agent: [1, 2, 3]}` — GitHub Actions expands to one job per element.

const { execSync } = require('node:child_process');
const fs = require('node:fs');

function nxJson(args) {
  // Invoke the local nx binary directly to avoid pnpm's stdout warnings
  // polluting JSON output. node_modules/.bin/nx is the workspace nx.
  const out = execSync(`./node_modules/.bin/nx ${args} --json`, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  return JSON.parse(out.trim());
}

function range(start, end) {
  if (end < start) return [];
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

const tiers = [
  // A single DTE agent leaves long-running affected slices underutilized.
  { name: 'small', max: 32, agents: 2 },
  { name: 'medium', max: 66, agents: 3 },
  { name: 'large', max: 100, agents: 4 },
];

function pickTier(percent) {
  return tiers.find((t) => percent <= t.max) ?? tiers[tiers.length - 1];
}

function computeMatrixOutputs(totalCount, affectedCount) {
  const percent = totalCount === 0 ? 0 : (affectedCount / totalCount) * 100;
  const tier =
    affectedCount === 0 ? { name: 'none', agents: 0 } : pickTier(percent);
  const agentIds = range(1, tier.agents);

  return {
    'affected-count': affectedCount,
    'total-count': totalCount,
    percent: percent.toFixed(1),
    tier: tier.name,
    'agent-count': tier.agents,
    matrix: JSON.stringify({ agent: agentIds }),
    'has-agents': agentIds.length > 0 ? 'true' : 'false',
  };
}

function main() {
  const total = nxJson('show projects');
  let affected;
  try {
    affected = nxJson('show projects --affected');
  } catch (err) {
    process.stderr.write(
      `[agents-matrix] affected probe failed: ${err.message}\n`,
    );
    affected = [];
  }

  const totalCount = total.length;
  const affectedCount = affected.length;
  const out = computeMatrixOutputs(totalCount, affectedCount);

  const githubOutput = process.env.GITHUB_OUTPUT;
  if (githubOutput) {
    const lines = Object.entries(out)
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');
    fs.appendFileSync(githubOutput, `${lines}\n`);
  }

  process.stderr.write(`[agents-matrix] ${JSON.stringify(out)}\n`);
}

if (require.main === module) {
  main();
}
