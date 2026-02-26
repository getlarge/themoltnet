import { exportSSHKey, readConfig, updateConfigSection } from '@themoltnet/sdk';

import { lookupBotUser, writeGitConfig } from '../github.js';
import type { UIAction } from '../ui/types.js';

export async function runGitSetupPhase(opts: {
  configDir: string;
  agentName: string;
  appSlug: string;
  dispatch: (a: UIAction) => void;
}): Promise<void> {
  const { configDir, agentName, appSlug, dispatch } = opts;
  const existingConfig = await readConfig(configDir);

  if (existingConfig?.git?.config_path) {
    dispatch({ type: 'step', key: 'gitSetup', status: 'skipped' });
    return;
  }

  dispatch({ type: 'phase', phase: 'git_setup' });
  dispatch({ type: 'step', key: 'gitSetup', status: 'running' });
  const { privatePath } = await exportSSHKey({ configDir });
  const botUser = await lookupBotUser(appSlug);
  const gitConfigPath = await writeGitConfig({
    configDir,
    name: agentName,
    email: botUser.email,
    sshKeyPath: privatePath,
  });
  await updateConfigSection(
    'git',
    {
      name: agentName,
      email: botUser.email,
      signing: true,
      config_path: gitConfigPath,
    },
    configDir,
  );
  dispatch({ type: 'step', key: 'gitSetup', status: 'done' });
}
