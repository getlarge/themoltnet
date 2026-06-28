import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

if (process.env.NX_DRY_RUN === 'true') {
  console.log('Skipping Docker pre-version build during nx release dry-run.');
  process.exit(0);
}

const nxConfig = JSON.parse(readFileSync('nx.json', 'utf8'));
const releaseDockerProjects =
  nxConfig.release?.groups?.['docker-images']?.projects ?? [];
if (
  !Array.isArray(releaseDockerProjects) ||
  releaseDockerProjects.length === 0
) {
  throw new Error(
    'No projects configured in nx.json release.groups.docker-images',
  );
}

const projects =
  process.env.NX_RELEASE_DOCKER_PROJECTS?.split(',')
    .map((project) => project.trim())
    .filter(Boolean) ?? releaseDockerProjects;

console.log(
  `Building Docker release images for ${projects.join(', ')} before Nx retags them.`,
);

execFileSync(
  'pnpm',
  [
    'exec',
    'nx',
    'run-many',
    '-t',
    'docker:build',
    '--projects',
    projects.join(','),
  ],
  {
    stdio: 'inherit',
    windowsHide: true,
  },
);
