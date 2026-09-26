import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MOLTNET_CLI_INSTALL_APT_COMMAND,
  MOLTNET_CLI_INSTALL_HOMEBREW_COMMAND,
  MOLTNET_CLI_INSTALL_SCOOP_COMMAND,
  MOLTNET_CONFIG_PATH,
  MOLTNET_REGISTER_COMMAND,
  MOLTNET_SDK_INSTALL_COMMAND,
} from '@moltnet/discovery';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));

function read(filePath: string): string {
  return readFileSync(resolve(ROOT, filePath), 'utf-8');
}

type Issue = {
  file: string;
  message: string;
};

const issues: Issue[] = [];

function assertContains(file: string, snippet: string, label: string): void {
  if (!read(file).includes(snippet)) {
    issues.push({
      file,
      message: `missing ${label}: ${snippet}`,
    });
  }
}

function assertNotContains(file: string, snippet: string, label: string): void {
  if (read(file).includes(snippet)) {
    issues.push({
      file,
      message: `contains deprecated ${label}: ${snippet}`,
    });
  }
}

// Install/register commands were migrated from README.md to the docs site
// as part of the README slim-down. Canonical location is now the SDK &
// Integrations page.
const SDK_DOC = 'docs/use/sdk-and-integrations.md';
assertContains(SDK_DOC, MOLTNET_SDK_INSTALL_COMMAND, 'SDK install command');
assertContains(
  SDK_DOC,
  MOLTNET_CLI_INSTALL_HOMEBREW_COMMAND,
  'Homebrew install command',
);
assertContains(SDK_DOC, MOLTNET_CLI_INSTALL_APT_COMMAND, 'APT install command');
assertContains(
  SDK_DOC,
  MOLTNET_CLI_INSTALL_SCOOP_COMMAND,
  'Scoop install command',
);
assertContains(SDK_DOC, MOLTNET_REGISTER_COMMAND, 'CLI register command');

// The activation guide is the second place the install commands are spelled
// out; keep it in lockstep with the discovery constants.
const INSTALL_DOC = 'docs/start/install-and-initialize.md';
assertContains(
  INSTALL_DOC,
  MOLTNET_CLI_INSTALL_HOMEBREW_COMMAND,
  'Homebrew install command',
);
assertContains(
  INSTALL_DOC,
  MOLTNET_CLI_INSTALL_APT_COMMAND,
  'APT install command',
);
assertContains(
  INSTALL_DOC,
  MOLTNET_CLI_INSTALL_SCOOP_COMMAND,
  'Scoop install command',
);
assertContains(SDK_DOC, MOLTNET_CONFIG_PATH, 'credentials path');

// The portable setup skill repeats only the commands needed to bootstrap a
// client. Check those copies against the same discovery constants as the docs.
const SETUP_SKILL = 'skills/local-moltnet-setup/SKILL.md';
assertContains(SETUP_SKILL, MOLTNET_SDK_INSTALL_COMMAND, 'SDK install command');
assertContains(
  SETUP_SKILL,
  MOLTNET_REGISTER_COMMAND.replace('<agent-name>', '<alias>'),
  'CLI register command',
);
assertContains(SETUP_SKILL, 'moltnet version', 'CLI version command');

assertContains(
  'apps/rest-api/src/routes/public.ts',
  'MOLTNET_NETWORK_INFO',
  'shared discovery import',
);

const deprecatedPatterns = [
  'brew tap getlarge/moltnet && brew install moltnet',
  'brew install getlarge/tap/moltnet',
  'moltnet register --voucher',
  '~/.config/moltnet/credentials.json',
];

for (const file of [
  'README.md',
  SDK_DOC,
  SETUP_SKILL,
  'apps/rest-api/src/routes/public.ts',
]) {
  for (const pattern of deprecatedPatterns) {
    assertNotContains(file, pattern, 'quickstart pattern');
  }
}

for (const pattern of ['moltnet --version', 'moltnet-agent --version']) {
  assertNotContains(SETUP_SKILL, pattern, 'version command');
  assertNotContains(
    'skills/local-moltnet-setup/references/verification.md',
    pattern,
    'version command',
  );
}

if (issues.length > 0) {
  // eslint-disable-next-line no-console
  console.error('Quickstart drift check failed:');
  for (const issue of issues) {
    // eslint-disable-next-line no-console
    console.error(`- ${issue.file}: ${issue.message}`);
  }
  process.exit(1);
}

// eslint-disable-next-line no-console
console.log('Quickstart drift check passed.');
