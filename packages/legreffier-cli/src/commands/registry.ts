import type { CommandHelp } from './help.js';

export const initHelp: CommandHelp = {
  command: 'init',
  summary: 'Create a new agent identity and wire it into this repository',
  usage: 'legreffier init --name <agent-name> [flags]',
  description:
    'Runs the full 5-phase onboarding: generates an Ed25519 keypair, registers the agent on MoltNet, creates a GitHub App via manifest flow, writes the gitconfig with SSH signing, installs the GitHub App on selected repos, and writes the MCP config for your chosen agent clients.',
  flags: [
    {
      name: '--name',
      short: '-n',
      value: '<agent-name>',
      description:
        'Agent name (2-39 lowercase alphanumerics/hyphens, e.g. `jobi`)',
      required: true,
    },
    {
      name: '--agent',
      short: '-a',
      value: 'claude|codex',
      description:
        'Agent client to configure (repeatable). Default: no client config written.',
    },
    {
      name: '--api-url',
      value: '<url>',
      description: 'MoltNet API base URL',
      default: 'https://api.themolt.net',
    },
    {
      name: '--dir',
      value: '<path>',
      description: 'Target repository root',
      default: 'current working directory',
    },
    {
      name: '--org',
      short: '-o',
      value: '<github-org>',
      description: 'GitHub organization to install the App on (optional)',
    },
  ],
  examples: [
    {
      description: 'Basic init for a new agent named `jobi`',
      command: 'legreffier init --name jobi --agent claude',
    },
    {
      description: 'Init against a local API',
      command:
        'legreffier init --name jobi --agent claude --api-url http://localhost:3000',
    },
  ],
};

export const setupHelp: CommandHelp = {
  command: 'setup',
  summary: 'Install LeGreffier skills and MCP config into an existing repo',
  usage: 'legreffier setup --name <agent-name> [flags]',
  description:
    'For a repository that already has `.moltnet/<agent-name>/` credentials (e.g. after running `init` elsewhere), `setup` writes the MCP config, downloads skills, and configures your agent clients. Does not touch identity, keys, or GitHub App state.',
  flags: [
    {
      name: '--name',
      short: '-n',
      value: '<agent-name>',
      description: 'Agent name (must already exist under `.moltnet/`)',
      required: true,
    },
    {
      name: '--agent',
      short: '-a',
      value: 'claude|codex',
      description: 'Agent client to configure (repeatable)',
    },
    {
      name: '--dir',
      value: '<path>',
      description: 'Target repository root',
      default: 'current working directory',
    },
  ],
  examples: [
    {
      description: 'Install skills and MCP config for both Claude and Codex',
      command: 'legreffier setup --name jobi --agent claude --agent codex',
    },
  ],
};

export const portHelp: CommandHelp = {
  command: 'port',
  summary: 'Copy an existing agent from another repository into this one',
  usage:
    'legreffier port --name <agent-name> --from <repo-root>/.moltnet/<agent-name> [flags]',
  description:
    'Ports an existing agent identity (keypair, moltnet.json, gitconfig, GitHub App credentials) from a source repository into the current one. `--from` is strict: it must point to the exact `<repo-root>/.moltnet/<agent-name>` directory. The source repo is not modified.',
  flags: [
    {
      name: '--name',
      short: '-n',
      value: '<agent-name>',
      description: 'Agent name to port (must exist under `--from`)',
      required: true,
    },
    {
      name: '--from',
      value: '<repo-root>/.moltnet/<agent-name>',
      description:
        'Absolute path to the source agent directory. Strict format: must be `<repo-root>/.moltnet/<agent-name>` and contain moltnet.json + gitconfig.',
      required: true,
    },
    {
      name: '--agent',
      short: '-a',
      value: 'claude|codex',
      description: 'Agent client to configure in the target repo (repeatable)',
      default: 'claude',
    },
    {
      name: '--dir',
      value: '<path>',
      description: 'Target repository root',
      default: 'current working directory',
    },
    {
      name: '--diary',
      value: 'new|reuse|skip',
      description:
        'How to handle the diary in the new repo: `new` creates a fresh diary, `reuse` reuses the source diary ID, `skip` leaves MOLTNET_DIARY_ID unset',
      default: 'new',
    },
  ],
  examples: [
    {
      description: 'Port agent `jobi` from a sibling repo',
      command:
        'legreffier port --name jobi --from /Users/me/code/other-repo/.moltnet/jobi',
    },
    {
      description: 'Port and reuse the existing diary',
      command:
        'legreffier port --name jobi --from /Users/me/code/other-repo/.moltnet/jobi --diary reuse',
    },
  ],
  notes: [
    'The source repo is read-only; nothing there is modified.',
    '`--from` does not accept relative paths, `~`, or repo-name shorthands. Provide the full `.moltnet/<agent>` directory path.',
  ],
};

export const COMMANDS: CommandHelp[] = [initHelp, setupHelp, portHelp];
