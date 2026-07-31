import { spawnSync } from 'node:child_process';

const OBJECT_ID = /^[0-9a-f]{40}$/i;
const GENERATED_ATTRIBUTE = 'linguist-generated';

/**
 * Resolve repository-owned generated declarations from the trusted base tree.
 * PR-head attributes are deliberately ignored so a change cannot hide itself.
 */
export function generatedPathsFromBaseAttributes(
  paths: readonly string[],
  baseRevision: string,
): Set<string> {
  if (!OBJECT_ID.test(baseRevision)) {
    throw new Error(
      'base revision for .gitattributes must be a 40-hex object id',
    );
  }
  const uniquePaths = [...new Set(paths)];
  if (uniquePaths.length === 0) return new Set();

  const result = spawnSync(
    'git',
    [
      'check-attr',
      '-z',
      `--source=${baseRevision}`,
      '--stdin',
      GENERATED_ATTRIBUTE,
    ],
    {
      encoding: 'utf8',
      input: `${uniquePaths.join('\0')}\0`,
      maxBuffer: 2 * 1024 * 1024,
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `failed to resolve trusted-base .gitattributes: ${result.stderr.trim() || `git exited ${String(result.status)}`}`,
    );
  }

  const fields = result.stdout.split('\0');
  if (fields.at(-1) === '') fields.pop();
  if (fields.length % 3 !== 0) {
    throw new Error('git check-attr returned malformed NUL-delimited output');
  }
  const generated = new Set<string>();
  for (let index = 0; index < fields.length; index += 3) {
    const path = fields[index];
    const attribute = fields[index + 1];
    const value = fields[index + 2];
    if (attribute !== GENERATED_ATTRIBUTE) {
      throw new Error(
        `git check-attr returned unexpected attribute ${attribute}`,
      );
    }
    if (value === 'set' || value === 'true') generated.add(path);
  }
  return generated;
}
