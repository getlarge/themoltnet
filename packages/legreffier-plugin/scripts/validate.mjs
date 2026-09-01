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
const submission = await readJson(
  join(root, 'submission', 'openai-public-plugin.json'),
);
const chatgptSubmission = await readJson(
  join(root, 'submission', 'chatgpt-app-submission.json'),
);

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
if (
  submission.listing?.mcpServerUrl !== 'https://mcp.themolt.net/mcp' ||
  submission.authentication?.type !== 'oauth2' ||
  submission.authentication?.agentCredentialsAcceptedByPublicPlugin !== false
) {
  throw new Error('OpenAI submission must preserve the human OAuth boundary');
}
if (
  submission.verification?.challengePath !==
    '/.well-known/openai-apps-challenge' ||
  submission.verification?.environmentVariable !== 'OPENAI_APPS_CHALLENGE_TOKEN'
) {
  throw new Error('OpenAI submission challenge contract is incomplete');
}
if (
  submission.testCases?.positive?.length < 5 ||
  submission.testCases?.negative?.length < 3
) {
  throw new Error(
    'OpenAI submission needs at least 5 positive and 3 negative cases',
  );
}
if (
  chatgptSubmission.$schema !==
    'https://developers.openai.com/plugins/schemas/chatgpt-app-submission.v1.json' ||
  chatgptSubmission.schema_version !== 1 ||
  Object.keys(chatgptSubmission.tools ?? {}).length === 0 ||
  chatgptSubmission.test_cases?.length !== 5 ||
  chatgptSubmission.negative_test_cases?.length !== 3
) {
  throw new Error('ChatGPT submission import does not match the v1 contract');
}
for (const [name, tool] of Object.entries(chatgptSubmission.tools)) {
  if (
    typeof tool.annotations?.readOnlyHint !== 'boolean' ||
    typeof tool.annotations?.openWorldHint !== 'boolean' ||
    typeof tool.annotations?.destructiveHint !== 'boolean' ||
    !tool.justifications?.read_only_justification ||
    !tool.justifications?.open_world_justification ||
    !tool.justifications?.destructive_justification
  ) {
    throw new Error(`ChatGPT submission has incomplete metadata for ${name}`);
  }
}

const submissionTools = new Set([
  'diaries_list',
  'entries_map_open',
  'entries_search',
  'packs_diff',
  'packs_list',
  'tasks_list',
  'teams_list',
]);
const isNonEmptyString = (value) =>
  typeof value === 'string' && value.trim().length > 0;

if (
  !isNonEmptyString(submission.reviewerAccess?.credentialDelivery) ||
  !submission.reviewerAccess?.requirements?.length ||
  !submission.reviewerAccess?.requirements?.every(isNonEmptyString)
) {
  throw new Error(
    'OpenAI submission must document private reviewer credential delivery and access requirements',
  );
}
for (const [index, testCase] of submission.testCases.positive.entries()) {
  if (
    !isNonEmptyString(testCase.prompt) ||
    !isNonEmptyString(testCase.expectedBehavior) ||
    !isNonEmptyString(testCase.expectedResultShape) ||
    !testCase.fixtureData?.length ||
    !testCase.fixtureData.every(isNonEmptyString) ||
    !testCase.expectedTools?.length
  ) {
    throw new Error(
      `OpenAI positive test case ${index + 1} is not reviewer-reproducible`,
    );
  }
  for (const tool of testCase.expectedTools) {
    if (!submissionTools.has(tool)) {
      throw new Error(
        `OpenAI positive test case ${index + 1} references unknown tool ${tool}`,
      );
    }
  }
}
for (const [index, testCase] of submission.testCases.negative.entries()) {
  if (
    !isNonEmptyString(testCase.prompt) ||
    !isNonEmptyString(testCase.expectedBehavior) ||
    !isNonEmptyString(testCase.whyNotComplete)
  ) {
    throw new Error(
      `OpenAI negative test case ${index + 1} needs a safe fallback and rationale`,
    );
  }
}
for (const field of [
  'websiteUrl',
  'supportUrl',
  'privacyPolicyUrl',
  'termsOfServiceUrl',
  'iconUrl',
]) {
  if (!submission.listing?.[field]?.startsWith('https://')) {
    throw new Error(`OpenAI submission listing.${field} must be an HTTPS URL`);
  }
}
for (const asset of [codex.interface?.composerIcon, codex.interface?.logo]) {
  if (!asset?.startsWith('./assets/')) {
    throw new Error('Codex plugin visual assets must live under ./assets');
  }
  await access(resolve(pluginRoot, asset));
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

if (!process.argv.includes('--dist')) {
  const repositoryRoot = resolve(packageRoot, '..', '..');
  const mcpToolSource = (
    await Promise.all(
      (await walk(join(repositoryRoot, 'apps', 'mcp-server', 'src')))
        .filter((path) => path.endsWith('.ts'))
        .map((path) => readFile(path, 'utf8')),
    )
  ).join('\n');
  const expectedTools = new Set(
    submission.testCases.positive.flatMap((testCase) => testCase.expectedTools),
  );
  for (const tool of expectedTools) {
    const registeredName = new RegExp(`\\bname:\\s*['"]${tool}['"]`);
    if (!registeredName.test(mcpToolSource)) {
      throw new Error(
        `OpenAI submission references unregistered MCP tool ${tool}`,
      );
    }
  }
}

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
