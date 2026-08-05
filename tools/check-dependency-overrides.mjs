#!/usr/bin/env node
/**
 * Verifies that every `pnpm.overrides` entry and every `pnpm.auditConfig.
 * ignoreGhsas` entry is still earning its place.
 *
 * A security override is a permanent, global, invisible pin. It gets added the
 * day an advisory lands and then outlives its reason: once the packages that
 * pulled in the vulnerable version catch up on their own, the entry keeps
 * pinning a floor nobody needs, and `pnpm audit` cannot tell the difference —
 * a clean audit looks identical whether an override is load-bearing or inert.
 * Left alone the block only grows. When this check was written, 23 of the 34
 * entries were already dead weight.
 *
 * The test is a counterfactual: resolve the workspace again with the overrides
 * removed and see what actually comes back. Anything that reappears justifies
 * its override; anything that does not is inert and should be deleted.
 *
 * Both resolutions happen against copies of the manifests in a temp directory,
 * so the working tree — including pnpm-lock.yaml — is never touched.
 *
 * Usage: node tools/check-dependency-overrides.mjs [--json] [--markdown <path>]
 */

import { execFile } from 'node:child_process';
import console from 'node:console';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Files a resolution needs: the lockfile, workspace config, and manifests. */
const ROOT_FILES = ['pnpm-workspace.yaml', 'pnpm-lock.yaml', '.npmrc'];

/**
 * `pnpm audit` exits non-zero when it finds anything, which is the normal case
 * here — we are asking *what* it finds, not whether the tree is clean.
 */
async function runPnpm(args, cwd) {
  try {
    const { stdout } = await execFileAsync('pnpm', args, {
      cwd,
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, NX_LOAD_DOT_ENV_FILES: 'false' },
    });
    return stdout;
  } catch (error) {
    if (typeof error.stdout === 'string' && error.stdout.length > 0) {
      return error.stdout;
    }
    throw error;
  }
}

/**
 * Resolves an override key to the package it targets.
 *
 * Keys may carry a version selector and a parent path: `foo`, `foo@2`,
 * `@scope/foo@2`, `parent>foo`, `parent@1>@scope/foo@2`. The target is the last
 * `>` segment with any trailing version range removed — taking care not to
 * mistake a scope's leading `@` for a range separator.
 *
 * The `>` split ignores `>=`, so a key that carries a comparator range
 * (`undici@>=7.29.0`) is not mistaken for a parent path and truncated to
 * nothing — which would make the package look advisory-free and report a
 * load-bearing override as dead.
 */
export function overrideTarget(key) {
  const last = key
    .split(/>(?!=)/)
    .pop()
    .trim();
  if (last.startsWith('@')) {
    const slash = last.indexOf('/');
    if (slash === -1) return last;
    const at = last.indexOf('@', slash + 1);
    return at === -1 ? last : last.slice(0, at);
  }
  const at = last.indexOf('@');
  return at === -1 ? last : last.slice(0, at);
}

/** Package names carrying at least one advisory in this audit report. */
function vulnerablePackages(report) {
  return new Set(
    Object.values(report.advisories ?? {}).map((a) => a.module_name),
  );
}

/**
 * Counts how many distinct versions of each package a lockfile resolves.
 *
 * An override that no longer holds back an advisory may still be collapsing a
 * package to a single version, which is why "no live advisory" is not on its
 * own a reason to delete one: dropping the `minimatch` pin here fanned the tree
 * from 2 versions to 12. Reporting both signals keeps that trade-off visible
 * instead of letting a security-shaped check quietly cost a dedupe.
 */
function countVersions(lockfileText) {
  const counts = new Map();
  for (const line of lockfileText.split('\n')) {
    const match = /^ {2}((?:@[^/@]+\/)?[^@\s]+)@[0-9][^:]*:\s*$/.exec(line);
    if (!match) continue;
    counts.set(match[1], (counts.get(match[1]) ?? 0) + 1);
  }
  return counts;
}

async function listWorkspaceManifests() {
  const { stdout } = await execFileAsync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '*package.json'],
    { cwd: REPO_ROOT, maxBuffer: 16 * 1024 * 1024 },
  );
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.includes('node_modules/'));
}

/**
 * Builds a throwaway copy of the workspace containing only what dependency
 * resolution reads, with `mutate` applied to the root manifest.
 */
async function stageWorkspace(mutate) {
  const dir = await mkdtemp(join(tmpdir(), 'moltnet-override-check-'));

  for (const file of ROOT_FILES) {
    await cp(join(REPO_ROOT, file), join(dir, file)).catch(() => {});
  }

  for (const manifest of await listWorkspaceManifests()) {
    if (manifest === 'package.json') continue;
    const target = join(dir, manifest);
    await cp(join(REPO_ROOT, manifest), target, { recursive: false }).catch(
      async (error) => {
        if (error.code !== 'ENOENT') throw error;
        // Parent directory does not exist yet.
        await execFileAsync('mkdir', ['-p', dirname(target)]);
        await cp(join(REPO_ROOT, manifest), target);
      },
    );
  }

  const root = JSON.parse(
    await readFile(join(REPO_ROOT, 'package.json'), 'utf8'),
  );
  mutate(root);
  await writeFile(join(dir, 'package.json'), JSON.stringify(root, null, 2));
  return dir;
}

/** Strips the ignore list so suppressed advisories are visible to the check. */
function dropIgnores(manifest) {
  if (manifest.pnpm?.auditConfig) delete manifest.pnpm.auditConfig.ignoreGhsas;
}

async function auditWithoutOverrides() {
  const dir = await stageWorkspace((manifest) => {
    delete manifest.pnpm.overrides;
    dropIgnores(manifest);
  });
  try {
    // Re-resolve: without the overrides the lockfile no longer matches.
    await runPnpm(['install', '--lockfile-only', '--ignore-scripts'], dir);
    return {
      report: JSON.parse(await runPnpm(['audit', '--prod', '--json'], dir)),
      versions: countVersions(
        await readFile(join(dir, 'pnpm-lock.yaml'), 'utf8'),
      ),
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function auditAsShipped() {
  // Overrides are unchanged, so the committed lockfile still applies and no
  // resolution is needed.
  const dir = await stageWorkspace(dropIgnores);
  try {
    return {
      report: JSON.parse(await runPnpm(['audit', '--prod', '--json'], dir)),
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function formatMarkdown({ deadOverrides, staleIgnores, total, exempt }) {
  const marker = '<!-- override-hygiene -->';
  if (deadOverrides.length === 0 && staleIgnores.length === 0) {
    const security = total - exempt.length;
    return [
      marker,
      '## :white_check_mark: Override hygiene — every entry is justified',
      '',
      `${security} of ${total} \`pnpm.overrides\` entries hold back a live advisory.` +
        (exempt.length > 0
          ? ` The other ${exempt.length} are kept deliberately via \`dependencyOverridePolicy.keepUnused\`.`
          : ''),
    ].join('\n');
  }

  const lines = [marker, '## :broom: Override hygiene — entries to remove', ''];

  const inert = deadOverrides.filter((o) => o.dedupeCost === 0);
  const dedupeOnly = deadOverrides.filter((o) => o.dedupeCost > 0);

  if (inert.length > 0) {
    lines.push(
      `**Delete these ${inert.length}.** They hold back no advisory and collapse no versions —`,
      'the packages that needed them have caught up upstream:',
      '',
      '```json',
      ...inert.map(({ key, range }) => `"${key}": "${range}",`),
      '```',
      '',
    );
  }

  if (dedupeOnly.length > 0) {
    lines.push(
      `**Decide on these ${dedupeOnly.length}.** No advisory needs them any more, but each is still`,
      'collapsing the tree. Keep one by recording why in `dependencyOverridePolicy.keepUnused`,',
      'or delete it and accept the extra versions:',
      '',
      ...dedupeOnly.map(
        ({ key, target, dedupeCost }) =>
          `- \`${key}\` — dropping it adds ${dedupeCost} more \`${target}\` version(s)`,
      ),
      '',
    );
  }

  if (staleIgnores.length > 0) {
    lines.push(
      'These `ignoreGhsas` entries are no longer justified:',
      '',
      ...staleIgnores.map((i) => `- \`${i.ghsa}\` — ${i.reason}`),
      '',
    );
  }

  return lines.join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  const markdownIndex = args.indexOf('--markdown');
  const manifest = JSON.parse(
    await readFile(join(REPO_ROOT, 'package.json'), 'utf8'),
  );

  const overrides = manifest.pnpm?.overrides ?? {};
  const ignored = manifest.pnpm?.auditConfig?.ignoreGhsas ?? [];
  /**
   * Escape hatch for overrides kept for reasons an audit cannot see —
   * compatibility pins, forced dedupes. Each needs a written reason, so the
   * exemption is reviewable rather than a bare name.
   */
  const keepUnused = manifest.dependencyOverridePolicy?.keepUnused ?? {};

  const [withoutOverrides, asShipped] = await Promise.all([
    auditWithoutOverrides(),
    auditAsShipped(),
  ]);

  const shippedVersions = countVersions(
    await readFile(join(REPO_ROOT, 'pnpm-lock.yaml'), 'utf8'),
  );

  const justified = vulnerablePackages(withoutOverrides.report);
  const deadOverrides = Object.entries(overrides)
    .filter(([key]) => !justified.has(overrideTarget(key)))
    .filter(([key]) => !(key in keepUnused))
    .map(([key, range]) => {
      const target = overrideTarget(key);
      const pinned = shippedVersions.get(target) ?? 0;
      const unpinned = withoutOverrides.versions.get(target) ?? 0;
      return {
        key,
        range,
        target,
        // >0 means the entry is still collapsing versions even though it no
        // longer holds back an advisory: a reason to record it in keepUnused
        // rather than delete it.
        dedupeCost: Math.max(0, unpinned - pinned),
      };
    });

  // An ignored GHSA is justified only while it is both still reachable and
  // still unfixable; either changing means the entry should go.
  const shippedAdvisories = Object.values(asShipped.report.advisories ?? {});
  const staleIgnores = ignored.flatMap((ghsa) => {
    const advisory = shippedAdvisories.find(
      (a) => a.github_advisory_id === ghsa,
    );
    if (!advisory) {
      return [{ ghsa, reason: 'no longer present in the dependency tree' }];
    }
    if (advisory.patched_versions !== '<0.0.0') {
      return [
        {
          ghsa,
          reason: `now fixed in ${advisory.patched_versions} (${advisory.module_name}) — take the fix instead of ignoring it`,
        },
      ];
    }
    return [];
  });

  const result = {
    total: Object.keys(overrides).length,
    keptCount: Object.keys(overrides).length - deadOverrides.length,
    deadOverrides,
    staleIgnores,
    exempt: Object.keys(keepUnused),
  };

  if (markdownIndex !== -1 && args[markdownIndex + 1]) {
    await writeFile(args[markdownIndex + 1], formatMarkdown(result));
  }

  if (args.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(
      `Checked ${result.total} overrides against a no-override resolution.`,
    );
    for (const { key, range, target, dedupeCost } of deadOverrides) {
      const note =
        dedupeCost > 0
          ? `still dedupes ${target} (+${dedupeCost} versions without it) — keep with a reason, or accept the fan-out`
          : `${target} has no live advisory and no dedupe effect — delete`;
      console.log(`  DEAD  ${key}: ${range}\n          ${note}`);
    }
    for (const { ghsa, reason } of staleIgnores) {
      console.log(`  STALE ignoreGhsas ${ghsa} — ${reason}`);
    }
    if (result.exempt.length > 0) {
      console.log(
        `  Exempt via dependencyOverridePolicy.keepUnused: ${result.exempt.join(', ')}`,
      );
    }
    if (deadOverrides.length === 0 && staleIgnores.length === 0) {
      console.log('All entries are load-bearing.');
    }
  }

  if (deadOverrides.length > 0 || staleIgnores.length > 0) {
    console.error(
      `\n${deadOverrides.length} dead override(s), ${staleIgnores.length} stale ignore(s). ` +
        'Remove them, or record a reason in dependencyOverridePolicy.keepUnused.',
    );
    process.exitCode = 1;
  }
}

// Import-safe so overrideTarget can be unit-tested.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
