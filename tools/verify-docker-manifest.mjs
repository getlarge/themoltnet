import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { parseArgs } from 'node:util';

import {
  createProjectGraphAsync,
  readProjectsConfigurationFromProjectGraph,
} from '@nx/devkit';

const { values } = parseArgs({
  options: {
    project: { type: 'string' },
    tag: { type: 'string' },
  },
  strict: true,
});

if (!values.project || !values.tag) {
  throw new Error('--project and --tag are required');
}

const graph = await createProjectGraphAsync({ exitOnError: false });
const project =
  readProjectsConfigurationFromProjectGraph(graph).projects[values.project];
if (!project) throw new Error(`Unknown Nx project: ${values.project}`);

const repositoryName = project.release?.docker?.repositoryName;
const registryUrl = JSON.parse(readFileSync('nx.json', 'utf8')).release?.docker
  ?.registryUrl;
if (!repositoryName || !registryUrl) {
  throw new Error(`${values.project} has incomplete Docker release metadata`);
}

const reference = `${registryUrl}/${repositoryName}:${values.tag}`;
const raw = execFileSync(
  'docker',
  ['buildx', 'imagetools', 'inspect', reference, '--raw'],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
);
const manifest = JSON.parse(raw);
const platforms = new Set(
  (manifest.manifests ?? []).map(
    (item) => `${item.platform?.os}/${item.platform?.architecture}`,
  ),
);
for (const expected of ['linux/amd64', 'linux/arm64']) {
  if (!platforms.has(expected)) {
    throw new Error(`${reference} is missing ${expected}`);
  }
}
process.stdout.write(
  `[docker-manifest] ${reference}: linux/amd64 + linux/arm64 verified\n`,
);
