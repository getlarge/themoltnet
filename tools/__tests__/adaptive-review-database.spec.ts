import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const script = fileURLToPath(
  new URL('../setup-adaptive-review-database.sh', import.meta.url),
);

function run(env: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'adaptive-database-'));
  try {
    const output = join(dir, 'output');
    const calls = join(dir, 'calls');
    writeFileSync(output, '');
    writeFileSync(calls, '');
    writeFileSync(
      join(dir, 'docker'),
      '#!/bin/sh\nprintf "%s\\n" "$*" >> "$DOCKER_CALLS"\nif [ "$1" = run ]; then exit "${MIGRATION_EXIT:-0}"; fi\n',
      { mode: 0o755 },
    );
    const result = spawnSync('bash', [script], {
      env: {
        PATH: `${dir}:${process.env.PATH ?? ''}`,
        GITHUB_ENV: output,
        DOCKER_CALLS: calls,
        ...env,
      },
      encoding: 'utf8',
    });
    return {
      ...result,
      output: readFileSync(output, 'utf8'),
      calls: readFileSync(calls, 'utf8'),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const ephemeral = {
  ADAPTIVE_EXECUTION_MODE: 'ephemeral',
  ADAPTIVE_POSTGRES_CONTAINER: 'job-postgres-container',
  ADAPTIVE_POSTGRES_PORT: '40123',
};

describe('adaptive review database selection', () => {
  it('leaves an external durable database untouched', () => {
    const result = run({
      ADAPTIVE_DATABASE_URL: 'postgresql://external/review',
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.calls).toBe('');
    expect(result.output).toBe('');
  });

  it('requires the durable URL without falling back to the service', () => {
    const result = run({ ...ephemeral, ADAPTIVE_EXECUTION_MODE: 'durable' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('ADAPTIVE_DATABASE_URL is required');
    expect(result.calls).toBe('');
  });

  it('rejects unknown execution modes before touching infrastructure', () => {
    const result = run({ ADAPTIVE_EXECUTION_MODE: 'automatic' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('must be durable or ephemeral');
    expect(result.calls).toBe('');
  });

  it('initializes only the service namespace and exports its allocated port', () => {
    const result = run({
      ...ephemeral,
      ADAPTIVE_DATABASE_URL: 'postgresql://external/do-not-initialize',
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.calls).toContain(
      '--network container:job-postgres-container',
    );
    expect(result.calls).toContain('uvx absurdctl init --ref 0.4.0');
    expect(result.calls).not.toContain('external');
    expect(result.output).toBe(
      'ADAPTIVE_DATABASE_URL=postgresql://issue_lifecycle:issue_lifecycle_secret@127.0.0.1:40123/issue_lifecycle\n',
    );
  });

  it.each(['', 'not-a-port', '0', '65536', '123\nFORGED=value'])(
    'rejects an unusable service port %j before migration',
    (port) => {
      const result = run({ ...ephemeral, ADAPTIVE_POSTGRES_PORT: port });
      expect(result.status).not.toBe(0);
      expect(result.calls).toBe('');
      expect(result.output).toBe('');
    },
  );

  it('does not export a usable endpoint after migration failure', () => {
    const result = run({ ...ephemeral, MIGRATION_EXIT: '1' });
    expect(result.status).not.toBe(0);
    expect(result.output).toBe('');
  });
});
