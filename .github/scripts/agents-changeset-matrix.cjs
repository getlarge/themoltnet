// Compute Nx Cloud agent matrix sizes from the affected slice.
//
// Inputs (env): NX_BASE, NX_HEAD (set by the caller; nx-set-shas in CI).
// Outputs (GitHub Actions outputs):
//   medium-matrix : JSON {agent: [1..N]} for the linux-medium pool
//   large-matrix  : JSON {agent: [1..N]} for the linux-large pool
//   tier          : "small" | "medium" | "large"
//   affected-count, total-count, percent
//
// Tiers map % of affected projects → (medium, large) agent counts:
//   small  : 0–32%  → (1, 0)   small PRs don't need large agents
//   medium : 33–66% → (2, 1)
//   large  : 67–100% → (3, 2)
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
  { name: 'small', max: 32, medium: 1, large: 0 },
  { name: 'medium', max: 66, medium: 2, large: 1 },
  { name: 'large', max: 100, medium: 3, large: 2 },
];

function pickTier(percent) {
  return tiers.find((t) => percent <= t.max) ?? tiers[tiers.length - 1];
}

function main() {
  const total = nxJson('show projects');
  let affected;
  try {
    affected = nxJson('show projects --affected');
  } catch (err) {
    // First-run / no base SHA: treat as no affected projects → no agents.
    process.stderr.write(`[agents-matrix] affected probe failed: ${err.message}\n`);
    affected = [];
  }

  const totalCount = total.length;
  const affectedCount = affected.length;
  const percent = totalCount === 0 ? 0 : (affectedCount / totalCount) * 100;
  // Zero affected: skip the pipeline entirely. Anything between 1 and tier.max
  // gets the configured agent counts.
  const tier =
    affectedCount === 0
      ? { name: 'none', medium: 0, large: 0 }
      : pickTier(percent);

  const mediumIds = range(1, tier.medium);
  const largeIds = range(1, tier.large);

  const out = {
    'affected-count': affectedCount,
    'total-count': totalCount,
    percent: percent.toFixed(1),
    tier: tier.name,
    'medium-count': tier.medium,
    'large-count': tier.large,
    'medium-matrix': JSON.stringify({ agent: mediumIds }),
    'large-matrix': JSON.stringify({ agent: largeIds }),
    // Surface a flag the orchestrator/agents can gate on: when 0 agents in
    // both pools, skip the DTE pipeline entirely (full cache hit / nothing
    // to do).
    'has-agents': mediumIds.length + largeIds.length > 0 ? 'true' : 'false',
  };

  const githubOutput = process.env.GITHUB_OUTPUT;
  if (githubOutput) {
    const lines = Object.entries(out)
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');
    fs.appendFileSync(githubOutput, `${lines}\n`);
  }

  // Always log to stderr for run inspection.
  process.stderr.write(`[agents-matrix] ${JSON.stringify(out)}\n`);
}

main();
