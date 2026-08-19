import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { env } from 'node:process';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const provisionScript = fileURLToPath(
  new URL('../scripts/provision-absurd-schema.sh', import.meta.url),
);
const tempDirectories: string[] = [];

interface ProvisionFixture {
  callsPath: string;
  environment: NodeJS.ProcessEnv;
}

function createFixture(
  initialVersion: string,
  finalVersion = '0.4.0',
): ProvisionFixture {
  const directory = mkdtempSync(join(tmpdir(), 'absurd-schema-test-'));
  const uvxPath = join(directory, 'uvx');
  const callsPath = join(directory, 'calls.log');
  const readsPath = join(directory, 'reads');
  tempDirectories.push(directory);

  writeFileSync(
    uvxPath,
    [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'printf \'%s\\n\' "$*" >> "$UVX_CALL_LOG"',
      'if [[ "${4:-}" == "schema-version" ]]; then',
      '  reads=0',
      '  if [[ -f "$UVX_SCHEMA_READS" ]]; then',
      '    read -r reads < "$UVX_SCHEMA_READS"',
      '  fi',
      '  reads=$((reads + 1))',
      '  printf \'%s\\n\' "$reads" > "$UVX_SCHEMA_READS"',
      '  if [[ "$reads" -eq 1 ]]; then',
      '    printf \'%s\\n\' "$UVX_INITIAL_VERSION"',
      '  else',
      '    printf \'%s\\n\' "$UVX_FINAL_VERSION"',
      '  fi',
      'fi',
    ].join('\n'),
    { mode: 0o755 },
  );

  return {
    callsPath,
    environment: {
      ...env,
      PATH: `${directory}:${env.PATH ?? ''}`,
      UVX_CALL_LOG: callsPath,
      UVX_FINAL_VERSION: finalVersion,
      UVX_INITIAL_VERSION: initialVersion,
      UVX_SCHEMA_READS: readsPath,
    },
  };
}

function readCalls(callsPath: string): string[] {
  return readFileSync(callsPath, 'utf8').trim().split('\n');
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('Absurd schema provisioner', () => {
  it('initializes a database whose schema version is unknown', () => {
    // Arrange
    const fixture = createFixture('unknown');

    // Act
    const output = execFileSync('bash', [provisionScript], {
      encoding: 'utf8',
      env: fixture.environment,
    });

    // Assert
    expect(output).toBe('Absurd schema ready at 0.4.0\n');
    expect(readCalls(fixture.callsPath)).toEqual([
      '--from absurdctl==0.4.0 absurdctl schema-version',
      '--from absurdctl==0.4.0 absurdctl init --ref 0.4.0',
      '--from absurdctl==0.4.0 absurdctl schema-version',
    ]);
  });

  it('leaves the target schema version unchanged', () => {
    // Arrange
    const fixture = createFixture('0.4.0');

    // Act
    const output = execFileSync('bash', [provisionScript], {
      encoding: 'utf8',
      env: fixture.environment,
    });

    // Assert
    expect(output).toBe('Absurd schema ready at 0.4.0\n');
    expect(readCalls(fixture.callsPath)).toEqual([
      '--from absurdctl==0.4.0 absurdctl schema-version',
      '--from absurdctl==0.4.0 absurdctl schema-version',
    ]);
  });

  it('migrates a known older schema version to the target', () => {
    // Arrange
    const fixture = createFixture('0.3.0');

    // Act
    const output = execFileSync('bash', [provisionScript], {
      encoding: 'utf8',
      env: fixture.environment,
    });

    // Assert
    expect(output).toBe('Absurd schema ready at 0.4.0\n');
    expect(readCalls(fixture.callsPath)).toEqual([
      '--from absurdctl==0.4.0 absurdctl schema-version',
      '--from absurdctl==0.4.0 absurdctl migrate --from 0.3.0 --to 0.4.0',
      '--from absurdctl==0.4.0 absurdctl schema-version',
    ]);
  });

  it('fails when the final schema version does not match the target', () => {
    // Arrange
    const fixture = createFixture('0.4.0', '0.3.0');

    // Act
    const result = spawnSync('bash', [provisionScript], {
      encoding: 'utf8',
      env: fixture.environment,
    });

    // Assert
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      '::error::Expected Absurd schema 0.4.0, found 0.3.0',
    );
  });
});
