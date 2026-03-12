#!/usr/bin/env -S npx tsx

import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';

interface DatasetRow {
  instance_id: string;
  patch: string;
  FAIL_TO_PASS: string[];
  PASS_TO_PASS: string[];
  image_name: string;
  repo: string;
  problem_statement: string;
}

interface DatasetRowsResponse {
  rows: Array<{
    row: DatasetRow;
  }>;
}

interface RepoSummary {
  repo: string;
  count: number;
}

interface SampleWindow {
  offset: number;
  rows: DatasetRow[];
}

const HF_ROWS_URL = 'https://datasets-server.huggingface.co/rows';
const DEFAULT_DATASETS = ['SWE-bench/SWE-smith-ts', 'SWE-bench/SWE-smith-js'];

const { values } = parseArgs({
  options: {
    datasets: { type: 'string' },
    length: { type: 'string', default: '25' },
    offset: { type: 'string', default: '0' },
    offsets: { type: 'string' },
    out: { type: 'string', default: 'docs/research/swesmith-inspection.md' },
  },
  strict: false,
});
const repoRoot = execSync('git rev-parse --show-toplevel', {
  encoding: 'utf8',
}).trim();

const datasets =
  values.datasets && typeof values.datasets === 'string'
    ? values.datasets
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
    : DEFAULT_DATASETS;
const length =
  typeof values.length === 'string' ? Number.parseInt(values.length, 10) : 25;
const offset =
  typeof values.offset === 'string' ? Number.parseInt(values.offset, 10) : 0;
const offsets =
  typeof values.offsets === 'string'
    ? values.offsets
        .split(',')
        .map((value) => Number.parseInt(value.trim(), 10))
        .filter((value) => Number.isInteger(value) && value >= 0)
    : [offset];
const outPath =
  typeof values.out === 'string'
    ? resolve(repoRoot, values.out)
    : resolve(repoRoot, 'docs/research/swesmith-inspection.md');

function ensurePositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}

async function fetchDatasetRows(
  dataset: string,
  requestedOffset: number,
  requestedLength: number,
): Promise<DatasetRow[]> {
  const url = new URL(HF_ROWS_URL);
  url.searchParams.set('dataset', dataset);
  url.searchParams.set('config', 'default');
  url.searchParams.set('split', 'train');
  url.searchParams.set('offset', String(requestedOffset));
  url.searchParams.set('length', String(requestedLength));

  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch ${dataset}: ${response.status} ${response.statusText}`,
    );
  }

  const payload = (await response.json()) as DatasetRowsResponse;
  return payload.rows.map((entry) => entry.row);
}

function summarizeRepos(rows: DatasetRow[]): RepoSummary[] {
  const counts = new Map<string, number>();

  for (const row of rows) {
    counts.set(row.repo, (counts.get(row.repo) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([repo, count]) => ({ repo, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
}

function compactText(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 3)}...`;
}

function renderDatasetSection(
  dataset: string,
  windows: SampleWindow[],
  rows: DatasetRow[],
): string {
  const repoSummary = summarizeRepos(rows);
  const samples = windows.flatMap((window) =>
    window.rows.slice(0, 2).map((row) => ({
      offset: window.offset,
      row,
    })),
  );

  const repoLines =
    repoSummary.length === 0
      ? '- none'
      : repoSummary.map((item) => `- \`${item.repo}\`: ${item.count}`).join('\n');

  const sampleLines =
    samples.length === 0
      ? '- none'
      : samples
          .map(({ offset: sampleOffset, row }) =>
            [
              `### \`${row.instance_id}\``,
              `- offset: ${sampleOffset}`,
              `- repo: \`${row.repo}\``,
              `- fail_to_pass: ${row.FAIL_TO_PASS.length}`,
              `- pass_to_pass: ${row.PASS_TO_PASS.length}`,
              `- problem: ${compactText(row.problem_statement, 220)}`,
            ].join('\n'),
          )
          .join('\n\n');

  return [
    `## ${dataset}`,
    '',
    `Rows inspected: ${rows.length}`,
    `Offsets sampled: ${windows.map((window) => window.offset).join(', ')}`,
    '',
    'Top repos in sample:',
    repoLines,
    '',
    'Sample tasks:',
    sampleLines,
    '',
  ].join('\n');
}

async function main() {
  ensurePositiveInteger(length, 'length');
  for (const value of offsets) {
    ensurePositiveInteger(value, 'offset');
  }

  const sections: string[] = [];
  for (const dataset of datasets) {
    const windows: SampleWindow[] = [];
    for (const sampleOffset of offsets) {
      const rows = await fetchDatasetRows(dataset, sampleOffset, length);
      windows.push({ offset: sampleOffset, rows });
    }
    const allRows = windows.flatMap((window) => window.rows);
    sections.push(renderDatasetSection(dataset, windows, allRows));
  }

  const report = [
    '# SWE-smith Inspection',
    '',
    `Length per dataset: ${length}`,
    `Offsets: ${offsets.join(', ')}`,
    '',
    'Datasets inspected:',
    ...datasets.map((dataset) => `- \`${dataset}\``),
    '',
    ...sections,
  ].join('\n');

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, report, 'utf8');
  console.log(`Wrote ${outPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
