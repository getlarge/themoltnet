// Fails when a tracked file breaks the workspace test conventions
// (docs/contribute/testing.md):
//
// - test files use the `*.spec.<ext>` suffix, never `*.test.<ext>`;
// - outside `*-e2e` projects, tests and their support code live in the
//   project's root `__tests__/` folder, so `src/` holds production code only.
//
// Usage: node tools/src/check-test-conventions.ts

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import process from 'node:process';

const SCANNED = /^(?:apps|libs|packages)\/[^/]+\/|^tools\//;
const EXEMPT_ROOTS = new Set(['libs/cpp-sdk']);
const CODE = /\.[cm]?[jt]sx?$/;
const DECLARATION = /\.d\.[cm]?ts$/;
const TEST_FRAMEWORK_IMPORT =
  /from\s+['"](?:vitest|@testing-library\/[^'"]+|@playwright\/test|node:test)['"]/;

export interface Violation {
  file: string;
  rule: string;
}

export function projectRoot(file: string): string | undefined {
  if (file.startsWith('tools/')) return 'tools';
  const match = /^((?:apps|libs|packages)\/[^/]+)\//.exec(file);
  return match?.[1];
}

export function findViolations(
  files: string[],
  read: (file: string) => string,
): Violation[] {
  const violations: Violation[] = [];

  for (const file of files) {
    if (!SCANNED.test(file)) continue;
    const root = projectRoot(file);
    if (!root || EXEMPT_ROOTS.has(root)) continue;
    if (!CODE.test(file) || DECLARATION.test(file)) continue;

    const rel = file.slice(root.length + 1);
    const segments = rel.split('/');
    const e2e = root.endsWith('-e2e');
    const isTest = /\.spec\.[cm]?[jt]sx?$/.test(rel);

    if (/\.test\.[cm]?[jt]sx?$/.test(rel)) {
      violations.push({ file, rule: 'use the .spec suffix, not .test' });
      continue;
    }
    if (/\.e2e\.[cm]?[jt]sx?$/.test(rel)) {
      violations.push({ file, rule: 'use the .e2e.spec suffix' });
      continue;
    }
    if (e2e) continue;

    if (
      segments.slice(1, -1).includes('__tests__') ||
      segments[0] === 'tests'
    ) {
      violations.push({
        file,
        rule: 'only the project-root __tests__/ folder may hold tests',
      });
    } else if (isTest && segments[0] !== '__tests__') {
      violations.push({ file, rule: 'move the test under __tests__/' });
    } else if (
      segments[0] === 'src' &&
      TEST_FRAMEWORK_IMPORT.test(read(file))
    ) {
      violations.push({
        file,
        rule: 'test support code belongs in __tests__/, not src/',
      });
    }
  }

  return violations;
}

function main() {
  const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
    .split('\0')
    // Skip index entries deleted in the working tree (staged moves).
    .filter((file) => file && existsSync(file));
  const violations = findViolations(files, (file) =>
    readFileSync(file, 'utf8'),
  );
  if (violations.length === 0) {
    process.stdout.write('Test conventions: OK\n');
    return;
  }
  for (const { file, rule } of violations) {
    process.stderr.write(`${file}: ${rule}\n`);
  }
  process.stderr.write(
    `\n${violations.length} file(s) break the test conventions. See docs/contribute/testing.md.\n`,
  );
  process.exitCode = 1;
}

if (import.meta.main) {
  main();
}
