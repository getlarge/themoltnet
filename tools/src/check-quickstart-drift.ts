import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MOLTNET_AGENTS_INIT_COMMAND,
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
assertContains(
  'apps/landing/index.html',
  MOLTNET_AGENTS_INIT_COMMAND.replace('<', '&lt;').replace('>', '&gt;'),
  'agent init command',
);

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
  'apps/landing/index.html',
  'apps/landing/src/components/GetStarted.tsx',
  'apps/rest-api/src/routes/public.ts',
]) {
  for (const pattern of deprecatedPatterns) {
    assertNotContains(file, pattern, 'quickstart pattern');
  }
}

for (const pattern of [
  'npx @themoltnet/legreffier init',
  'X-Client-Id',
  'X-Client-Secret',
]) {
  assertNotContains(
    'apps/landing/index.html',
    pattern,
    'landing discovery pattern',
  );
}

// The landing deep-links into docs headings. Renaming a heading silently
// breaks those links, so every anchor the landing points at must resolve to a
// real heading in the target page.
const LANDING_SRC = resolve(ROOT, 'apps/landing/src');

/** VitePress heading slug: lowercase, drop punctuation, spaces to hyphens. */
function slugify(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-');
}

function collectFiles(dir: string, extension: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) return collectFiles(full, extension);
    return entry.name.endsWith(extension) ? [full] : [];
  });
}

const docsAnchorPattern = /\$\{docsUrl\}\/([a-z0-9/-]+)#([a-z0-9-]+)/g;

for (const file of collectFiles(LANDING_SRC, '.tsx')) {
  const source = readFileSync(file, 'utf-8');
  for (const [, docPath, anchor] of source.matchAll(docsAnchorPattern)) {
    const target = `docs/${docPath}.md`;
    let markdown: string;
    try {
      markdown = read(target);
    } catch {
      issues.push({
        file: file.slice(ROOT.length + 1),
        message: `links to a docs page that does not exist: ${target}`,
      });
      continue;
    }
    const anchors = new Set(
      [...markdown.matchAll(/^#{2,4}\s+(.+)$/gm)].map(([, heading]) =>
        slugify(heading),
      ),
    );
    if (!anchors.has(anchor)) {
      issues.push({
        file: file.slice(ROOT.length + 1),
        message: `links to a missing heading: ${target}#${anchor}`,
      });
    }
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
