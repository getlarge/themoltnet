import { appendFileSync, readFileSync } from 'node:fs';
import process from 'node:process';

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const RELEASE_TAG = /^[0-9A-Za-z][0-9A-Za-z._-]*$/;

const nxConfig = JSON.parse(readFileSync('nx.json', 'utf8'));
const configuredProjects = new Set(
  nxConfig.release?.groups?.['docker-images']?.projects ?? [],
);

function resolveMatrix(raw) {
  const candidates = JSON.parse(raw);
  if (!Array.isArray(candidates)) {
    throw new Error('MOLTNET_DOCKER_RELEASES_JSON must be an array');
  }

  const include = candidates.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object') {
      throw new Error('Docker release entries must be objects');
    }
    const { project, released, tag, version } = candidate;
    if (typeof project !== 'string' || !configuredProjects.has(project)) {
      throw new Error(`Unknown Nx Docker release project: ${String(project)}`);
    }
    if (released !== 'true') return [];
    if (typeof version !== 'string' || !SEMVER.test(version)) {
      throw new Error(`Invalid release version for ${project}: ${version}`);
    }
    if (
      typeof tag !== 'string' ||
      !RELEASE_TAG.test(tag) ||
      !tag.endsWith(`-v${version}`)
    ) {
      throw new Error(`Invalid GitHub release tag for ${project}: ${tag}`);
    }
    return [{ project, tag, version }];
  });

  return { include };
}

const raw = process.env.MOLTNET_DOCKER_RELEASES_JSON;
if (!raw) throw new Error('MOLTNET_DOCKER_RELEASES_JSON is required');
const outputPath = process.env.GITHUB_OUTPUT;
if (!outputPath) throw new Error('GITHUB_OUTPUT is required');

const matrix = resolveMatrix(raw);
appendFileSync(
  outputPath,
  `matrix=${JSON.stringify(matrix)}\nhas-releases=${matrix.include.length > 0}\n`,
);
