import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
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

const imageName = `${registryUrl}/${repositoryName}`;
const reference = `${imageName}:${values.tag}`;
const raw = execFileSync(
  'docker',
  [
    'buildx',
    'imagetools',
    'inspect',
    reference,
    '--format',
    '{{json .Manifest}}',
  ],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
);
const manifest = JSON.parse(raw);
const digest = manifest.digest;
if (typeof digest !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(digest)) {
  throw new Error(`${reference} has no valid image digest`);
}
const platformDigests = Object.fromEntries(
  ['amd64', 'arm64'].map((architecture) => {
    const item = (manifest.manifests ?? []).find(
      (entry) =>
        entry.platform?.os === 'linux' &&
        entry.platform?.architecture === architecture,
    );
    if (!item || !/^sha256:[0-9a-f]{64}$/.test(item.digest ?? '')) {
      throw new Error(`${reference} is missing linux/${architecture}`);
    }
    return [architecture, item.digest];
  }),
);
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `image_name=${imageName}\nimage_digest=${digest}\namd64_ref=${imageName}@${platformDigests.amd64}\narm64_ref=${imageName}@${platformDigests.arm64}\n`,
  );
}
process.stdout.write(
  `[docker-manifest] ${reference} (${digest}): linux/amd64 + linux/arm64 verified\n`,
);
