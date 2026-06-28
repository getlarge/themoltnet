import { execFileSync } from 'node:child_process';

if (process.env.NX_DRY_RUN === 'true') {
  console.log('Skipping Docker pre-version build during nx release dry-run.');
  process.exit(0);
}

const releaseDockerProjects = [
  '@moltnet/console',
  '@moltnet/database',
  '@moltnet/landing',
  '@moltnet/mcp-host',
  '@moltnet/mcp-server',
  '@moltnet/rest-api',
];

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
