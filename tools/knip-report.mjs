import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

// Positions are presentation metadata, not identity: adding a line must not
// turn every existing finding below it into a regression.
export function normalize(report) {
  if (!report || !Array.isArray(report.issues)) {
    throw new Error('Expected a Knip 6 JSON report with an issues array');
  }
  const findings = new Map();
  for (const row of report.issues) {
    if (typeof row.file !== 'string') throw new Error('Missing finding file');
    for (const [type, items] of Object.entries(row)) {
      if (type === 'file' || type === 'owners') continue;
      if (!Array.isArray(items))
        throw new Error(`Invalid Knip category: ${type}`);
      for (const item of items) {
        const symbols = Array.isArray(item) ? item : [item];
        if (
          !symbols.length ||
          symbols.some((s) => typeof s.name !== 'string')
        ) {
          throw new Error(`Invalid Knip finding: ${type}`);
        }
        const names = symbols.map((s) => [s.namespace ?? '', s.name]).sort();
        const key = JSON.stringify([row.file, type, names]);
        findings.set(key, {
          key,
          file: row.file,
          type,
          name: names
            .map(([ns, name]) => (ns ? `${ns}.${name}` : name))
            .join(', '),
          line: symbols[0].line ?? 1,
        });
      }
    }
  }
  return [...findings.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export function compare(base, head) {
  const before = new Set(base.map((f) => f.key));
  const after = new Set(head.map((f) => f.key));
  return {
    added: head.filter((f) => !before.has(f.key)),
    resolved: base.filter((f) => !after.has(f.key)),
  };
}

const escapeMd = (s) =>
  String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('`', '&#96;')
    .replaceAll('|', '&#124;')
    .replaceAll('\r', ' ')
    .replaceAll('\n', ' ');
const code = (s) => `<code>${escapeMd(s)}</code>`;
const describe = (f) =>
  `${code(f.file)}:${f.line} — ${code(f.type)}: ${code(f.name)}`;
const runLink = () =>
  process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : '';
const artifactLink = (url) =>
  url
    ? `[Full JSON reports and diagnostics](${url}) (knip-report artifact).`
    : 'Full reports are in the output directory.';

export function summary(head, delta, url = '') {
  const lines = ['## Knip', ''];
  if (delta) {
    lines.push(
      `**${delta.added.length} new findings; ${delta.resolved.length} resolved.**`,
      '',
      'Compared with the PR base using the same Knip version and configuration. Findings are advisory during rollout.',
      '',
    );
    for (const finding of delta.added.slice(0, 30))
      lines.push(`- ${describe(finding)}`);
    if (delta.added.length > 30)
      lines.push(
        `- ${delta.added.length - 30} more new findings in the artifact.`,
      );
    if (!delta.added.length) lines.push('No new findings.');
  } else {
    lines.push(
      `**${head.length} existing findings.**`,
      '',
      'Existing debt is tracked by the weekly Knip cleanup issue.',
    );
  }
  lines.push(
    '',
    artifactLink(url),
    '',
    'Verify entrypoints and runtime packaging before removing code or dependencies.',
  );
  return lines.join('\n') + '\n';
}

const escapeCommand = (s) =>
  String(s)
    .replaceAll('%', '%25')
    .replaceAll('\r', '%0D')
    .replaceAll('\n', '%0A');
export function annotation(finding) {
  const file = escapeCommand(finding.file)
    .replaceAll(':', '%3A')
    .replaceAll(',', '%2C');
  const line =
    Number.isInteger(finding.line) && finding.line > 0 ? finding.line : 1;
  return `::warning file=${file},line=${line},title=New Knip finding::${escapeCommand(`${finding.type}: ${finding.name}`)}`;
}

export function scan(cwd, bin, output, label) {
  const result = spawnSync(process.execPath, [bin, '--reporter', 'json'], {
    cwd,
    encoding: 'utf8',
    timeout: 180_000,
    maxBuffer: 32 * 1024 * 1024,
    env: {
      ...process.env,
      NO_COLOR: '1',
      FORCE_COLOR: '0',
      NX_DAEMON: 'false',
      NX_LOAD_DOT_ENV_FILES: 'false',
    },
  });
  writeFileSync(resolve(output, `${label}.json`), result.stdout ?? '');
  writeFileSync(
    resolve(output, `${label}.log`),
    (result.stderr ?? '') + (result.error ? `\n${result.error.message}` : ''),
  );
  if (result.error || ![0, 1].includes(result.status)) {
    throw new Error(
      `Knip ${label} analysis failed (exit ${result.status}); see ${label}.log`,
    );
  }
  try {
    return normalize(JSON.parse(result.stdout));
  } catch (error) {
    throw new Error(
      `Knip ${label} produced an invalid report: ${error.message}`,
    );
  }
}

export const backlogMarker = '<!-- knip-backlog -->';
const backlogEnd = '<!-- /knip-backlog -->';
export function backlog(findings, url = '') {
  const hash = createHash('sha256')
    .update(JSON.stringify(findings.map((f) => f.key).sort()))
    .digest('hex');
  const groups = Map.groupBy(findings, (f) => {
    const parts = f.file.split('/');
    return ['apps', 'libs', 'packages'].includes(parts[0])
      ? parts.slice(0, 2).join('/')
      : parts[0] === 'tools' || parts[0] === 'docs'
        ? parts[0]
        : '(root)';
  });
  const lines = [
    backlogMarker,
    `<!-- knip-fingerprint:${hash} -->`,
    '## Existing Knip findings',
    '',
    `${findings.length} findings. Updated weekly only when the finding set changes. Owner: @getlarge (repository CODEOWNER).`,
    '',
    'For each workspace: verify reachability, correct discovery where needed, then remove confirmed dead code/dependencies. Check emitted bundles and packed installs before removing runtime dependencies.',
    '',
    artifactLink(url),
    '',
  ];
  for (const [workspace, items] of [...groups].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const counts = Map.groupBy(items, (f) => f.type);
    lines.push(
      `- [ ] ${code(workspace)}: ${items.length} findings (${[...counts].map(([type, fs]) => `${type}: ${fs.length}`).join(', ')})`,
    );
    lines.push('<details><summary>First findings to investigate</summary>', '');
    for (const finding of items.slice(0, 5))
      lines.push(`- ${describe(finding)}`);
    lines.push('', '</details>', '');
  }
  lines.push(backlogEnd);
  return { hash, body: lines.join('\n') };
}

// Invoked only by the default-branch scheduled workflow, never by PR code.
export async function publishBacklog(github, repo, findings, url) {
  const next = backlog(findings, url);
  const issues = await github.paginate(github.rest.issues.listForRepo, {
    ...repo,
    state: 'all',
    per_page: 100,
  });
  const existing = issues.find(
    (issue) => !issue.pull_request && issue.body?.includes(backlogMarker),
  );
  if (!existing) {
    if (!findings.length) return;
    return github.rest.issues.create({
      ...repo,
      title: 'Knip cleanup backlog',
      assignees: ['getlarge'],
      body: next.body,
    });
  }
  if (existing.body.includes(`<!-- knip-fingerprint:${next.hash} -->`)) return;
  const start = existing.body.indexOf(backlogMarker);
  const end = existing.body.indexOf(backlogEnd, start);
  if (end < 0)
    throw new Error(
      'Knip backlog end marker missing; preserve the issue for manual repair',
    );
  const body =
    existing.body.slice(0, start) +
    next.body +
    existing.body.slice(end + backlogEnd.length);
  return github.rest.issues.update({
    ...repo,
    issue_number: existing.number,
    body,
    state: findings.length ? 'open' : 'closed',
  });
}

function main() {
  const { values } = parseArgs({
    options: {
      out: { type: 'string' },
      'base-dir': { type: 'string' },
    },
  });
  if (!values.out)
    throw new Error(
      'Usage: node tools/knip-report.mjs --out <directory> [--base-dir <installed checkout>]',
    );
  const output = resolve(values.out);
  mkdirSync(output, { recursive: true });
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const bin = resolve(root, 'node_modules/knip/bin/knip.js');
  let body;
  try {
    const head = scan(root, bin, output, 'head');
    const base = values['base-dir']
      ? scan(resolve(values['base-dir']), bin, output, 'base')
      : null;
    const delta = base ? compare(base, head) : null;
    writeFileSync(
      resolve(output, 'findings.json'),
      JSON.stringify({ head, delta }, null, 2) + '\n',
    );
    body = summary(head, delta, runLink());
    if (process.env.GITHUB_ACTIONS && delta) {
      for (const finding of delta.added.slice(0, 10))
        process.stdout.write(annotation(finding) + '\n');
    }
  } catch (error) {
    body = `## Knip analysis failed\n\n${escapeMd(error.message)}\n\nNo regression verdict is available. ${artifactLink(runLink())}\n`;
    process.exitCode = 2;
  }
  writeFileSync(resolve(output, 'summary.md'), body);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, body);
  process.stdout.write(body);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main();
