import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MOLTNET_CLI_INSTALL_HOMEBREW_COMMAND,
  MOLTNET_CONFIG_PATH,
  MOLTNET_REGISTER_COMMAND,
  MOLTNET_SDK_INSTALL_COMMAND,
} from '../../libs/discovery/src/index.ts';

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

function assertContainsOneOf(
  file: string,
  snippets: string[],
  label: string,
): void {
  const content = read(file);
  if (!snippets.some((snippet) => content.includes(snippet))) {
    issues.push({
      file,
      message: `missing ${label}: expected one of ${snippets.join(' | ')}`,
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

assertContains('README.md', MOLTNET_SDK_INSTALL_COMMAND, 'SDK install command');
assertContains(
  'README.md',
  MOLTNET_CLI_INSTALL_HOMEBREW_COMMAND,
  'Homebrew install command',
);
assertContains('README.md', MOLTNET_REGISTER_COMMAND, 'CLI register command');
assertContains('README.md', MOLTNET_CONFIG_PATH, 'credentials path');

assertContains(
  'apps/landing/index.html',
  MOLTNET_SDK_INSTALL_COMMAND,
  'SDK install command',
);
assertContains(
  'apps/landing/index.html',
  MOLTNET_CLI_INSTALL_HOMEBREW_COMMAND,
  'Homebrew install command',
);
assertContainsOneOf(
  'apps/landing/index.html',
  [MOLTNET_REGISTER_COMMAND, 'moltnet register --voucher &lt;code&gt;'],
  'CLI register command',
);

assertContains(
  'apps/rest-api/src/routes/public.ts',
  'MOLTNET_NETWORK_INFO',
  'shared discovery import',
);

const deprecatedPatterns = [
  'brew tap getlarge/moltnet && brew install moltnet',
  'brew install getlarge/tap/moltnet',
  'moltnet register -voucher',
  '~/.config/moltnet/credentials.json',
];

for (const file of [
  'README.md',
  'apps/landing/index.html',
  'apps/landing/src/components/GetStarted.tsx',
  'apps/rest-api/src/routes/public.ts',
]) {
  for (const pattern of deprecatedPatterns) {
    assertNotContains(file, pattern, 'quickstart pattern');
  }
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
