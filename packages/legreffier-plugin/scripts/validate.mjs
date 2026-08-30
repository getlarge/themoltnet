import { access, lstat, readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const root = process.argv.includes('--dist')
  ? join(packageRoot, 'dist')
  : packageRoot;
const pluginRoot = join(root, 'plugins', 'legreffier');

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

const packageManifest = await readJson(join(packageRoot, 'package.json'));
const codex = await readJson(join(pluginRoot, '.codex-plugin', 'plugin.json'));
const claude = await readJson(
  join(pluginRoot, '.claude-plugin', 'plugin.json'),
);
const codexMarketplace = await readJson(join(root, 'marketplace.json'));
const claudeMarketplace = await readJson(
  join(root, '.claude-plugin', 'marketplace.json'),
);
const claudeMarketplacePlugin = claudeMarketplace.plugins.find(
  (plugin) => plugin.name === 'legreffier',
);
const claudeMcp = await readJson(join(pluginRoot, '.mcp.json'));
const hooks = await readJson(join(pluginRoot, 'hooks', 'hooks.json'));

if (codex.name !== 'legreffier' || claude.name !== 'legreffier') {
  throw new Error('Both plugin manifests must use the legreffier identifier');
}
const versions = new Set([
  packageManifest.version,
  codex.version,
  claude.version,
  claudeMarketplacePlugin?.version,
]);
if (versions.size !== 1) {
  throw new Error(
    'Package, Codex, Claude, and Claude marketplace versions must match',
  );
}
const contactEmail = 'legreffier@themolt.net';
if (
  codex.author?.email !== contactEmail ||
  claude.author?.email !== contactEmail ||
  claudeMarketplace.owner?.email !== contactEmail ||
  claudeMarketplace.plugins[0]?.author?.email !== contactEmail
) {
  throw new Error(`Every plugin contact must use ${contactEmail}`);
}
if (
  codexMarketplace.plugins[0]?.source?.path !== './plugins/legreffier' ||
  claudeMarketplace.plugins[0]?.source !== './plugins/legreffier'
) {
  throw new Error('Marketplace sources must resolve to ./plugins/legreffier');
}
if (
  codex.mcpServers?.moltnet?.url !== 'https://mcp.themolt.net/mcp' ||
  claudeMcp.moltnet?.url !== 'https://mcp.themolt.net/mcp'
) {
  throw new Error('Both plugin hosts must use the public MoltNet MCP endpoint');
}

const preToolUseGroups = hooks.hooks?.PreToolUse ?? [];
const hookCommands = preToolUseGroups.flatMap((group) =>
  group.hooks.map((hook) => hook.command),
);
if (
  !hookCommands.some((command) => command.includes('moltnet github guard')) ||
  !hookCommands.some((command) => command.includes('moltnet secrets guard'))
) {
  throw new Error('Plugin must register both MoltNet command guards');
}
if (
  hookCommands
    .find((command) => command.includes('moltnet secrets guard'))
    ?.includes('|| true')
) {
  throw new Error('The secrets guard must preserve activated-agent failures');
}
const secretGroup = preToolUseGroups.find((group) =>
  group.hooks.some((hook) => hook.command.includes('moltnet secrets guard')),
);
const protectedTools = [
  'Bash',
  'Read',
  'Write',
  'Edit',
  'Grep',
  'Glob',
  'apply_patch',
];
if (
  !protectedTools.every((tool) =>
    secretGroup?.matcher.split('|').includes(tool),
  )
) {
  throw new Error('The secrets guard must cover shell and file tools');
}
const principalGroup = preToolUseGroups.find((group) =>
  group.matcher.includes('mcp__plugin_legreffier_moltnet__'),
);
if (
  !principalGroup?.matcher.includes('mcp__moltnet__') ||
  !principalGroup.hooks.some((hook) =>
    hook.command.includes('Activated MoltNet agents must use'),
  )
) {
  throw new Error('Activated agents must be blocked from the human OAuth MCP');
}

const skillNames = [
  'legreffier',
  'legreffier-explore',
  'legreffier-onboarding',
];
for (const skillName of skillNames) {
  await access(join(pluginRoot, 'skills', skillName, 'SKILL.md'));
}

const forbidden = [
  /legreffier (?:setup|init|port)/,
  /npx @themoltnet\/(?:legreffier|cli)/,
  /skills-lock\.json/,
];

const walk = async (directory) => {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else files.push(path);
  }
  return files;
};

for (const path of await walk(join(pluginRoot, 'skills'))) {
  const content = await readFile(path, 'utf8');
  for (const pattern of forbidden) {
    if (pattern.test(content)) {
      throw new Error(
        `Legacy setup reference ${pattern} found in ${relative(root, path)}`,
      );
    }
  }
}

if (!process.argv.includes('--dist')) {
  const repositoryRoot = resolve(packageRoot, '..', '..');
  for (const skillName of skillNames) {
    const link = join(repositoryRoot, '.agents', 'skills', skillName);
    const stat = await lstat(link);
    if (!stat.isSymbolicLink()) {
      throw new Error(`${relative(repositoryRoot, link)} must be a symlink`);
    }
  }
}
