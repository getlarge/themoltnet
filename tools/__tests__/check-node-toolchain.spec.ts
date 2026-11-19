import { describe, expect, it } from 'vitest';

import { findViolations, toolVersionsNode } from '../src/check-node-toolchain';

const DIGEST = 'sha256:0123456789abcdef';

function reader(sources: Record<string, string>) {
  return (file: string) => sources[file] ?? '';
}

describe('toolVersionsNode', () => {
  it('reads the nodejs line', () => {
    // Arrange
    const content = 'golang 1.27.4\nnodejs 24.22.3\nrust 1.90.0\n';

    // Act & Assert
    expect(toolVersionsNode(content)).toBe('24.22.3');
  });
});

describe('findViolations', () => {
  it('accepts pins that all match .tool-versions', () => {
    // Arrange
    const sources = {
      '.tool-versions': 'nodejs 24.22.3\n',
      '.nvmrc': '24.22.3\n',
      'sandbox.json':
        '"https://unofficial-builds.nodejs.org/download/release/v24.22.3/node-v24.22.3-linux-x64-musl.tar.xz"',
      'apps/api/Dockerfile': `# syntax=docker/dockerfile:1\nFROM node:24.22.3-slim@${DIGEST} AS base\nFROM nginx:alpine\n`,
      '.github/workflows/ci.yml':
        '      - uses: actions/setup-node@v6\n        with:\n          node-version-file: .tool-versions\n',
      'packages/x-action/action.yml': "        node-version: '24'\n",
    };

    // Act
    const violations = findViolations(Object.keys(sources), reader(sources));

    // Assert
    expect(violations).toEqual([]);
  });

  it('reports every pin that drifts from .tool-versions', () => {
    // Arrange
    const sources = {
      '.tool-versions': 'nodejs 24.22.3\n',
      '.nvmrc': 'v24.22.2\n',
      'sandbox.json':
        '"https://unofficial-builds.nodejs.org/download/release/v24.22.2/node-v24.22.2-linux-x64-musl.tar.xz"',
      'apps/api/Dockerfile': `FROM node:24.22.2-slim@${DIGEST} AS base\n`,
      'libs/db/Dockerfile': 'ARG NODE=24\nFROM node:${NODE}-slim\n',
      '.github/workflows/review.yml':
        "      - uses: actions/setup-node@v6\n        with:\n          node-version: '24'\n",
    };

    // Act
    const violations = findViolations(Object.keys(sources), reader(sources));

    // Assert
    expect(violations.map(({ file }) => file)).toEqual([
      '.nvmrc',
      'sandbox.json:1',
      'sandbox.json:1',
      'apps/api/Dockerfile:1',
      'libs/db/Dockerfile:2',
      '.github/workflows/review.yml:3',
    ]);
  });

  it('fails when .tool-versions has no nodejs pin', () => {
    // Arrange
    const sources = { '.tool-versions': 'golang 1.27.4\n' };

    // Act & Assert
    expect(findViolations(['.tool-versions'], reader(sources))).toEqual([
      { file: '.tool-versions', message: 'declares no nodejs version' },
    ]);
  });
});
