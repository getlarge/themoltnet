import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(packageRoot, '..', '..');
const mcpSourceRoot = join(repositoryRoot, 'apps', 'mcp-server', 'src');
const annotationSource = await readFile(
  join(mcpSourceRoot, 'tool-annotations.ts'),
  'utf8',
);
const reviewerFixture = JSON.parse(
  await readFile(
    join(packageRoot, 'submission', 'openai-public-plugin.json'),
    'utf8',
  ),
);

function readToolSet(name) {
  const match = annotationSource.match(
    new RegExp(`const ${name} = new Set\\(\\[([\\s\\S]*?)\\]\\);`),
  );
  if (!match) throw new Error(`Could not read ${name} from annotation policy`);
  return new Set([...match[1].matchAll(/'([^']+)'/g)].map((item) => item[1]));
}

const readOnlyTools = readToolSet('READ_ONLY_TOOLS');
const mutatingTools = readToolSet('MUTATING_TOOLS');
const destructiveTools = readToolSet('DESTRUCTIVE_TOOLS');
const openWorldTools = readToolSet('OPEN_WORLD_TOOLS');
const sourceFiles = (await readdir(mcpSourceRoot)).filter((name) =>
  name.endsWith('.ts'),
);
const toolDefinitions = [];

for (const sourceFile of sourceFiles) {
  const source = await readFile(join(mcpSourceRoot, sourceFile), 'utf8');
  for (const match of source.matchAll(
    /mcpAddTool\(\s*\{([\s\S]*?)\n\s*\},\s*\n/g,
  )) {
    const name = match[1].match(/name:\s*'([^']+)'/)?.[1];
    if (!name) continue;
    toolDefinitions.push({
      name,
      hasOutputSchema: /outputSchema:/.test(match[1]),
    });
  }
}

toolDefinitions.sort((left, right) => left.name.localeCompare(right.name));
const toolNames = new Set(toolDefinitions.map(({ name }) => name));
if (toolNames.size !== toolDefinitions.length) {
  throw new Error('MCP tool names must be unique');
}
for (const { name, hasOutputSchema } of toolDefinitions) {
  if (!readOnlyTools.has(name) && !mutatingTools.has(name)) {
    throw new Error(`Missing annotation policy for ${name}`);
  }
  if (!hasOutputSchema) throw new Error(`Missing output schema for ${name}`);
}
for (const name of [
  ...readOnlyTools,
  ...mutatingTools,
  ...destructiveTools,
  ...openWorldTools,
]) {
  if (!toolNames.has(name)) throw new Error(`Unknown annotated tool ${name}`);
}

const tools = Object.fromEntries(
  toolDefinitions.map(({ name }) => {
    const readOnly = readOnlyTools.has(name);
    const openWorld = openWorldTools.has(name);
    const destructive = destructiveTools.has(name);
    return [
      name,
      {
        annotations: {
          readOnlyHint: readOnly,
          openWorldHint: openWorld,
          destructiveHint: destructive,
        },
        justifications: {
          read_only_justification: readOnly
            ? 'This tool only reads or computes MoltNet data and does not change state.'
            : 'This tool creates, updates, deletes, enqueues, or otherwise changes MoltNet state.',
          open_world_justification: openWorld
            ? 'This tool enqueues autonomous agent work that may affect public or third-party systems.'
            : 'This tool cannot affect publicly visible internet state and operates within private MoltNet data.',
          destructive_justification: destructive
            ? 'This tool can delete, overwrite, revoke access, or otherwise make a difficult-to-reverse change.'
            : 'This tool does not delete, overwrite, revoke access, or cause another irreversible effect.',
        },
      },
    ];
  }),
);

const testCases = reviewerFixture.testCases.positive.map((testCase) => ({
  description: testCase.expectedBehavior,
  user_prompt: testCase.prompt,
  file_attachment_urls: null,
  tools_triggered: testCase.expectedTools.join(', '),
  expected_output: `${testCase.expectedResultShape} Fixture: ${testCase.fixtureData.join(' ')}`,
  expected_output_url: null,
}));
const negativeTestCases = reviewerFixture.testCases.negative.map(
  (testCase) => ({
    description: testCase.whyNotComplete,
    user_prompt: testCase.prompt,
    file_attachment_urls: null,
    tools_triggered: null,
    expected_output: testCase.expectedBehavior,
    expected_output_url: null,
  }),
);

const submission = {
  $schema:
    'https://developers.openai.com/apps-sdk/schemas/chatgpt-app-submission.v1.json',
  schema_version: 1,
  app_info: {
    display_name: reviewerFixture.listing.name,
    subtitle: 'Control plane for AI agents',
    description: reviewerFixture.listing.longDescription,
    category: 'PRODUCTIVITY',
  },
  tools,
  test_cases: testCases,
  negative_test_cases: negativeTestCases,
};
const serialized = `${JSON.stringify(submission, null, 2)}\n`;
const outputPath = join(
  packageRoot,
  'submission',
  'chatgpt-app-submission.json',
);

if (process.argv.includes('--check')) {
  const current = await readFile(outputPath, 'utf8');
  if (current !== serialized) {
    throw new Error(
      'chatgpt-app-submission.json is stale; run the submission:generate target',
    );
  }
} else {
  await writeFile(outputPath, serialized);
}
