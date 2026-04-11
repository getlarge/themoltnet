import { describe, expect, it } from 'vitest';

import type { CommandHelp } from './help.js';
import { printCommandHelp, printRootHelp } from './help.js';

function capture(fn: () => void): string {
  const chunks: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  // @ts-expect-error narrow override for test
  process.stdout.write = (chunk: string | Uint8Array): boolean => {
    chunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
    return true;
  };
  try {
    fn();
  } finally {
    process.stdout.write = original;
  }
  return chunks.join('');
}

const portHelp: CommandHelp = {
  command: 'port',
  summary: 'Copy an existing agent into this repository',
  usage: 'legreffier port --name <agent> --from <repo-root>/.moltnet/<agent>',
  description:
    'Copy the identity, credentials, and gitconfig of an existing agent from another repository into the current one. The target repo must not already have a `.moltnet/<agent>/` directory.',
  flags: [
    {
      name: '--name',
      short: '-n',
      value: '<agent-name>',
      description: 'Agent name to port (must exist in --from directory)',
      required: true,
    },
    {
      name: '--from',
      value: '<repo-root>/.moltnet/<agent-name>',
      description:
        'Absolute path to the source agent directory. Must contain moltnet.json and gitconfig.',
      required: true,
    },
    {
      name: '--diary',
      value: 'new|reuse|skip',
      description: 'How to handle the diary in the new repo',
      default: 'new',
    },
  ],
  examples: [
    {
      description: 'Port agent `jobi` from a sibling repo',
      command:
        'legreffier port --name jobi --from /Users/me/code/other-repo/.moltnet/jobi',
    },
  ],
  notes: ['The source repo is read-only; nothing there is modified.'],
};

describe('printCommandHelp', () => {
  it('prints the usage line', () => {
    const out = capture(() => printCommandHelp(portHelp));
    expect(out).toContain(
      'legreffier port --name <agent> --from <repo-root>/.moltnet/<agent>',
    );
  });

  it('marks required flags', () => {
    const out = capture(() => printCommandHelp(portHelp));
    expect(out).toContain('--name');
    expect(out).toContain('(required)');
  });

  it('shows flag defaults when present', () => {
    const out = capture(() => printCommandHelp(portHelp));
    expect(out).toContain('--diary');
    expect(out).toContain('default: new');
  });

  it('includes examples and notes', () => {
    const out = capture(() => printCommandHelp(portHelp));
    expect(out).toContain('Port agent `jobi` from a sibling repo');
    expect(out).toContain('The source repo is read-only');
  });
});

describe('printRootHelp', () => {
  it('lists all commands with summaries', () => {
    const out = capture(() =>
      printRootHelp([
        portHelp,
        { ...portHelp, command: 'init', summary: 'Set up a new agent' },
      ]),
    );
    expect(out).toContain('port');
    expect(out).toContain('Copy an existing agent');
    expect(out).toContain('init');
    expect(out).toContain('Set up a new agent');
  });
});
