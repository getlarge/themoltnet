import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { readIdentityDefaultBinding } from './identity-binding.js';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

/** Writes an identity directory holding the given `env` file contents. */
function identityDir(env?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'identity-'));
  dirs.push(dir);
  if (env !== undefined) writeFileSync(join(dir, 'env'), env);
  return dir;
}

describe('readIdentityDefaultBinding', () => {
  it('reads the team and diary the identity defaults to', () => {
    // Arrange
    const dir = identityDir(
      'MOLTNET_TEAM_ID=team-uuid\nMOLTNET_DIARY_ID=diary-uuid\n',
    );

    // Act
    const binding = readIdentityDefaultBinding(dir);

    // Assert
    expect(binding).toEqual({ teamId: 'team-uuid', diaryId: 'diary-uuid' });
  });

  it('returns nothing when the identity has no env file', () => {
    // Arrange
    const dir = identityDir();

    // Act / Assert
    expect(readIdentityDefaultBinding(dir)).toEqual({});
  });

  it('ignores a half-filled binding', () => {
    // The Go CLI refuses a team without a diary; a half-filled pair here is
    // the same invalid state and must not seed a default.
    const dir = identityDir('MOLTNET_TEAM_ID=team-uuid\n');

    expect(readIdentityDefaultBinding(dir)).toEqual({});
  });

  it('ignores unrelated variables in the same file', () => {
    // Arrange
    const dir = identityDir(
      [
        'MOLTNET_AGENT_NAME=legreffier',
        'GIT_CONFIG_GLOBAL=gitconfig',
        'MOLTNET_TEAM_ID=team-uuid',
        'MOLTNET_DIARY_ID=diary-uuid',
      ].join('\n'),
    );

    // Act / Assert
    expect(readIdentityDefaultBinding(dir)).toEqual({
      teamId: 'team-uuid',
      diaryId: 'diary-uuid',
    });
  });

  it('tolerates comments, blank lines, quotes and surrounding space', () => {
    // Arrange: shapes a hand-edited env file realistically takes.
    const dir = identityDir(
      [
        '# bound by moltnet context set',
        '',
        '  MOLTNET_TEAM_ID = "team-uuid" ',
        "MOLTNET_DIARY_ID='diary-uuid'",
      ].join('\n'),
    );

    // Act / Assert
    expect(readIdentityDefaultBinding(dir)).toEqual({
      teamId: 'team-uuid',
      diaryId: 'diary-uuid',
    });
  });

  it('returns nothing when the env file is unreadable rather than throwing', () => {
    // A missing or malformed default is not a reason to fail the catalogue.
    expect(readIdentityDefaultBinding('/nonexistent/identity/dir')).toEqual({});
  });
});
