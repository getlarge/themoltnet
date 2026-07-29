import { describe, expect, it } from 'vitest';

import {
  decodeShellCommandIdentifier,
  encodeShellCommandRule,
  MAX_SHELL_COMMAND_IDENTIFIER_BYTES,
  normalizeShellCommandRules,
  ShellCommandIdentifierError,
  type ShellCommandRule,
} from '../src/shell-command.js';

describe('shell command identifiers', () => {
  it.each([
    [['git', 'diff'], 'v1/git/diff'],
    [['npm', 'run', 'test:unit'], 'v1/npm/run/test%3Aunit'],
    [['tool/name', 'with space'], 'v1/tool%2Fname/with%20space'],
    [['100%', 'café'], 'v1/100%25/caf%C3%A9'],
    [['世界', '表示'], 'v1/%E4%B8%96%E7%95%8C/%E8%A1%A8%E7%A4%BA'],
  ] as Array<[ShellCommandRule['argvPrefix'], string]>)(
    'round trips %j',
    (prefix, identifier) => {
      const rule = { argvPrefix: prefix };
      expect(encodeShellCommandRule(rule)).toBe(identifier);
      expect(decodeShellCommandIdentifier(identifier)).toEqual(rule);
    },
  );

  it.each([
    'v2/git/diff',
    'v1/git',
    'v1/git/',
    'v1/git/%',
    'v1/git/%2f',
    'v1/git/%41',
    'v1/git/a+b',
    'v1/git/café',
    'v1/git/%C3%28',
    'v1/git/%00',
  ])('rejects malformed or non-canonical identifier %s', (identifier) => {
    expect(() => decodeShellCommandIdentifier(identifier)).toThrow(
      ShellCommandIdentifierError,
    );
  });

  it('enforces token and encoded identifier limits', () => {
    expect(() =>
      encodeShellCommandRule({ argvPrefix: ['git', 'x'.repeat(129)] }),
    ).toThrow(/128 characters/);
    expect(() =>
      decodeShellCommandIdentifier(
        `v1/${'a'.repeat(MAX_SHELL_COMMAND_IDENTIFIER_BYTES)}/b`,
      ),
    ).toThrow(/1024 encoded bytes/);
    expect(() =>
      encodeShellCommandRule({
        argvPrefix: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'],
      }),
    ).toThrow(/2–8 tokens/);
  });

  it('rejects malformed Unicode input instead of replacing it', () => {
    expect(() =>
      encodeShellCommandRule({ argvPrefix: ['git', '\ud800'] }),
    ).toThrow(/well-formed UTF-8/);
  });

  it('deduplicates and lexicographically sorts decoded token arrays', () => {
    expect(
      normalizeShellCommandRules([
        { argvPrefix: ['git', 'log'] },
        { argvPrefix: ['gh', 'pr', 'view'] },
        { argvPrefix: ['git', 'diff'] },
        { argvPrefix: ['git', 'diff'] },
      ]),
    ).toEqual([
      { argvPrefix: ['gh', 'pr', 'view'] },
      { argvPrefix: ['git', 'diff'] },
      { argvPrefix: ['git', 'log'] },
    ]);
  });
});
