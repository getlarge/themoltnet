#!/usr/bin/env -S npx tsx
/* eslint-disable no-console */

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { resolveRepoRoot } from '@moltnet/context-evals/pipeline-shared';

import { gitDiff, gitFileExistsAtRef, isTestFile } from './gh-client.js';
import { extractTouchedTestNames } from './task-extractor.js';
import { outputIndicatesNoTestsRun } from './verify.js';

interface StoredTask {
  task_id: string;
  fixture_ref: string;
  gold_fix_ref: string;
  problem_statement: string;
  changed_files: string[];
  fail_to_pass: string[];
  pass_to_pass: string[];
}

interface StoredStatus {
  pr: number;
  status: string;
  skipReason?: string;
  redCheck?: {
    passed: boolean;
    commands: Array<{
      command: string;
      passed: boolean;
      output: string;
      durationMs: number;
    }>;
  };
}

interface ChangedTestFileInfo {
  path: string;
  status: 'NEW' | 'MODIFIED';
  addedTestNames: string[];
}

interface TriageEntry {
  pr: number;
  taskId: string;
  failingCommand: string;
  skipReason: string;
  diagnosis: string;
  noTestsRanSignal: boolean;
  changedTestFiles: ChangedTestFileInfo[];
}

const { values } = parseArgs({
  options: {
    prs: { type: 'string', short: 'p' },
    help: { type: 'boolean', short: 'h', default: false },
  },
  strict: true,
});

if (values.help) {
  console.log(`
Usage: pnpm --filter @moltnet/tools tasksmith:triage-fixture-green [options]

Builds a fixture_already_green triage report from tasksmith candidate/status files.

Options:
  --prs, -p <numbers>   Optional comma-separated PR numbers to include
  -h, --help            Show this help
`);
  process.exit(0);
}

function detectCommandIssues(command: string, output: string): string[] {
  const issues: string[] = [];

  if (/pnpm --filter \S+(?: run)? test$/.test(command)) {
    issues.push('whole_package');
  }
  if (
    /pnpm --filter \S+(?: run)? test(?:\s+(?:__tests__|src|test)\/[^\s'"]+)?\s*$/.test(
      command,
    )
  ) {
    issues.push('whole_file_or_broad_file');
  }
  if (outputIndicatesNoTestsRun(output)) {
    issues.push('no_tests_ran');
  }
  if (
    /(?:^|\s)(?:setup|config\.test|public\.test|crypto-tools|diary-distill)(?:\s|$)/.test(
      command,
    )
  ) {
    issues.push('basename_filter');
  }
  if (/\s-t\s|--testNamePattern|--grep/.test(command)) {
    issues.push('name_filter');
  }

  return issues;
}

function buildDiagnosis(
  command: string,
  output: string,
  changedTestFiles: ChangedTestFileInfo[],
): string {
  const issues = detectCommandIssues(command, output);

  if (issues.includes('no_tests_ran')) return 'no_tests_ran';
  if (issues.includes('whole_package')) return 'whole_package';

  const hasModified = changedTestFiles.some(
    (file) => file.status === 'MODIFIED',
  );
  const hasAddedTests = changedTestFiles.some(
    (file) => file.addedTestNames.length > 0,
  );

  if (hasModified && hasAddedTests && !issues.includes('name_filter')) {
    return 'modified_file_missing_new_test_names';
  }

  if (issues.includes('basename_filter')) return 'basename_filter';
  if (issues.includes('whole_file_or_broad_file') && hasModified) {
    return 'whole_file_modified';
  }
  if (issues.includes('name_filter') && hasModified) {
    return 'wrong_name_filter';
  }
  if (changedTestFiles.every((file) => file.status === 'NEW')) {
    return 'likely_bad_candidate_or_existing_behavior';
  }

  return 'needs_manual_review';
}

function buildMarkdown(entries: TriageEntry[]): string {
  const lines = [
    '# Fixture Already Green Triage',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    '| PR | Diagnosis | Failing Command | Changed Test Files |',
    '| --- | --- | --- | --- |',
  ];

  for (const entry of entries) {
    const files = entry.changedTestFiles
      .map((file) => {
        const names =
          file.addedTestNames.length > 0
            ? ` added: ${file.addedTestNames.join('; ')}`
            : '';
        return `${file.path} [${file.status}]${names}`;
      })
      .join('<br>');

    lines.push(
      `| ${entry.pr} | ${entry.diagnosis} | \`${entry.failingCommand.replaceAll('|', '\\|')}\` | ${files} |`,
    );
  }

  return lines.join('\n') + '\n';
}

const repoRoot = await resolveRepoRoot();
const statusDir = resolve(repoRoot, 'tasksmith', 'candidates', 'status');
const tasksDir = resolve(repoRoot, 'tasksmith', 'candidates', 'tasks');
const reportsDir = resolve(repoRoot, 'tasksmith', 'reports');

const prFilter = values.prs
  ? new Set(
      values.prs
        .split(',')
        .map((n) => parseInt(n.trim(), 10))
        .filter((n) => Number.isFinite(n)),
    )
  : null;

const statusFiles = (await readdir(statusDir))
  .filter((file) => file.endsWith('.json'))
  .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

const entries: TriageEntry[] = [];

for (const statusFile of statusFiles) {
  const statusPath = resolve(statusDir, statusFile);
  const status = JSON.parse(await readFile(statusPath, 'utf8')) as StoredStatus;
  if (status.status !== 'fixture_already_green') continue;
  if (prFilter && !prFilter.has(status.pr)) continue;

  const taskPath = resolve(tasksDir, `${status.pr}.json`);
  const task = JSON.parse(await readFile(taskPath, 'utf8')) as StoredTask;

  const failedCommand =
    status.redCheck?.commands.find((command) => command.passed)?.command ??
    status.redCheck?.commands[0]?.command ??
    '';
  const failedOutput =
    status.redCheck?.commands.find((command) => command.passed)?.output ??
    status.redCheck?.commands[0]?.output ??
    '';

  const changedTestFiles: ChangedTestFileInfo[] = [];
  for (const file of task.changed_files.filter(isTestFile)) {
    const existedOnFixture = await gitFileExistsAtRef(task.fixture_ref, file);
    const diff = existedOnFixture
      ? await gitDiff(task.fixture_ref, task.gold_fix_ref, file)
      : '';
    changedTestFiles.push({
      path: file,
      status: existedOnFixture ? 'MODIFIED' : 'NEW',
      addedTestNames: existedOnFixture ? extractTouchedTestNames(diff) : [],
    });
  }

  entries.push({
    pr: status.pr,
    taskId: task.task_id,
    failingCommand: failedCommand,
    skipReason: status.skipReason ?? '',
    diagnosis: buildDiagnosis(failedCommand, failedOutput, changedTestFiles),
    noTestsRanSignal: outputIndicatesNoTestsRun(failedOutput),
    changedTestFiles,
  });
}

await mkdir(reportsDir, { recursive: true });
const jsonPath = resolve(reportsDir, 'fixture-already-green.json');
const mdPath = resolve(reportsDir, 'fixture-already-green.md');

await writeFile(jsonPath, JSON.stringify(entries, null, 2));
await writeFile(mdPath, buildMarkdown(entries));

console.log(
  `[triage] Wrote ${entries.length} entries to ${basename(jsonPath)} and ${basename(mdPath)}`,
);
