// Fails when a Node.js version pin disagrees with `.tool-versions`, the single
// source of truth for the Node.js toolchain (AGENTS.md, "Dependency
// Management"):
//
// - `.nvmrc` mirrors it for nvm/fnm users;
// - `sandbox.json` downloads the same musl build;
// - every `FROM node:` line in a tracked Dockerfile uses the same version;
// - workflows and local actions under `.github/` read `node-version-file`
//   instead of a literal `node-version`.
//
// Renovate updates these pins in one group, but each datasource clears the
// release-age gate separately, so a group branch can first carry only part of
// a bump. This check keeps such a partial branch red until the rest arrives.
//
// Usage: node tools/src/check-node-toolchain.ts

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import process from 'node:process';

export interface Violation {
  file: string;
  message: string;
}

const DOCKERFILE = /(?:^|\/)Dockerfile(?:\.[^/]+)?$|\.Dockerfile$/;
const FROM_NODE = /^[ \t]*FROM\s+(?:--platform=\S+\s+)?node:(\S+)/gim;
const WORKFLOW = /^\.github\/(?:workflows\/[^/]+|actions\/.+\/action)\.ya?ml$/;
const LITERAL_NODE_VERSION = /^[ \t]*node-version:[ \t]*(.+?)[ \t]*$/gm;
const SANDBOX_NODE = /node-v?(\d+\.\d+\.\d+)|release\/v(\d+\.\d+\.\d+)/g;

export function toolVersionsNode(content: string): string | undefined {
  const match = /^nodejs\s+(\S+)\s*$/m.exec(content);
  return match?.[1];
}

function lineOf(content: string, index: number): number {
  return content.slice(0, index).split('\n').length;
}

export function findViolations(
  files: string[],
  read: (file: string) => string,
): Violation[] {
  const expected = toolVersionsNode(read('.tool-versions'));
  if (!expected) {
    return [{ file: '.tool-versions', message: 'declares no nodejs version' }];
  }

  const violations: Violation[] = [];
  const tracked = new Set(files);

  if (tracked.has('.nvmrc')) {
    const nvmrc = read('.nvmrc').trim().replace(/^v/, '');
    if (nvmrc !== expected) {
      violations.push({
        file: '.nvmrc',
        message: `pins ${nvmrc}, expected ${expected}`,
      });
    }
  }

  if (tracked.has('sandbox.json')) {
    const content = read('sandbox.json');
    for (const match of content.matchAll(SANDBOX_NODE)) {
      const version = match[1] ?? match[2];
      if (version !== expected) {
        violations.push({
          file: `sandbox.json:${lineOf(content, match.index)}`,
          message: `downloads Node.js ${version}, expected ${expected}`,
        });
      }
    }
  }

  for (const file of files) {
    if (DOCKERFILE.test(file)) {
      const content = read(file);
      for (const match of content.matchAll(FROM_NODE)) {
        const ref = match[1];
        const location = `${file}:${lineOf(content, match.index)}`;
        if (ref.includes('$')) {
          violations.push({
            file: location,
            message: `interpolates the node tag (${ref}); Renovate cannot update it, use a literal version`,
          });
          continue;
        }
        const version = /^(\d+\.\d+\.\d+)(?:-|@|$)/.exec(ref)?.[1];
        if (version !== expected) {
          violations.push({
            file: location,
            message: `uses node:${ref.split('@')[0]}, expected node:${expected}-<variant>`,
          });
        }
      }
    }

    if (WORKFLOW.test(file)) {
      const content = read(file);
      for (const match of content.matchAll(LITERAL_NODE_VERSION)) {
        violations.push({
          file: `${file}:${lineOf(content, match.index)}`,
          message: `sets node-version: ${match[1]}; use node-version-file: .tool-versions`,
        });
      }
    }
  }

  return violations;
}

function main() {
  const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
    .split('\0')
    .filter((file) => file && existsSync(file));
  const violations = findViolations(files, (file) =>
    existsSync(file) ? readFileSync(file, 'utf8') : '',
  );
  if (violations.length === 0) {
    process.stdout.write('Node.js toolchain pins: OK\n');
    return;
  }
  for (const { file, message } of violations) {
    process.stderr.write(`${file}: ${message}\n`);
  }
  process.stderr.write(
    `\n${violations.length} Node.js pin(s) disagree with .tool-versions. See AGENTS.md, "Dependency Management".\n`,
  );
  process.exitCode = 1;
}

if (import.meta.main) {
  main();
}
