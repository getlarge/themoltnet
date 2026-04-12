import { statSync } from 'node:fs';

import { defineCommand } from 'citty';
import { render } from 'ink';

import { validatePortFromArg } from '../phases/portArgs.js';
import type { PortDiaryMode } from '../phases/portDiary.js';
import { PortApp } from '../PortApp.js';
import {
  CliValidationError,
  collectAgents,
  commonArgs,
  requireAgentName,
  resolveApiUrl,
  resolveDir,
  withCleanErrors,
} from './shared.js';

const DIARY_MODES = ['new', 'reuse', 'skip'] as const;

function assertDirectory(label: '--dir' | '--from', path: string): void {
  try {
    const stat = statSync(path);
    if (!stat.isDirectory()) {
      throw new CliValidationError(`${label} "${path}" is not a directory`);
    }
  } catch (err) {
    if (err instanceof CliValidationError) throw err;
    throw new CliValidationError(`${label} "${path}" does not exist`);
  }
}

export const portCommand = defineCommand({
  meta: {
    name: 'port',
    description: 'Copy an existing agent from another repository into this one',
  },
  args: {
    name: { ...commonArgs.name, required: true },
    from: {
      type: 'string',
      description:
        'Absolute path to the source agent directory (must be `<repo-root>/.moltnet/<agent-name>` and contain moltnet.json + gitconfig)',
      required: true,
      valueHint: 'repo-root/.moltnet/agent-name',
    },
    agent: commonArgs.agent,
    'api-url': commonArgs['api-url'],
    dir: commonArgs.dir,
    diary: {
      type: 'enum',
      description:
        'How to handle the diary in the new repo: `new` creates a fresh diary, `reuse` reuses the source diary ID, `skip` leaves MOLTNET_DIARY_ID unset',
      options: [...DIARY_MODES],
      default: 'new',
      valueHint: 'new|reuse|skip',
    },
  },
  run: withCleanErrors(({ args, rawArgs }) => {
    const name = requireAgentName(args.name);
    const agents = collectAgents(rawArgs);
    const apiUrl = resolveApiUrl(args['api-url']);
    const dir = resolveDir(args.dir);

    const fromValidation = validatePortFromArg(args.from);
    if (!fromValidation.ok) {
      throw new CliValidationError(fromValidation.error);
    }
    const absoluteFromDir = args.from as string;

    // Validate target and source directories exist before kicking off the
    // 5-phase port pipeline. A typo in --dir would otherwise run the whole
    // port against a missing path and silently swallow the remote lookup
    // failure in the warning-only verify step.
    assertDirectory('--dir', dir);
    assertDirectory('--from', absoluteFromDir);

    render(
      <PortApp
        name={name}
        agents={agents.length > 0 ? agents : ['claude']}
        sourceDir={absoluteFromDir}
        targetRepoDir={dir}
        diaryMode={args.diary as PortDiaryMode}
        apiUrl={apiUrl}
      />,
    );
  }),
});
