import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    projects: {
      type: 'string',
    },
  },
  strict: true,
});

const configuredProjects =
  values.projects
    ?.split(',')
    .map((project) => project.trim())
    .filter(Boolean) ?? [];
const overriddenProjects = process.env.NX_RELEASE_DOCKER_PROJECTS?.split(',')
  .map((project) => project.trim())
  .filter(Boolean);
const projects =
  overriddenProjects && overriddenProjects.length > 0
    ? overriddenProjects
    : configuredProjects;

if (projects.length === 0) {
  throw new Error(
    'Pass at least one Nx project with --projects=<comma-separated-projects>.',
  );
}

if (process.env.NX_DRY_RUN === 'true') {
  process.stdout.write(
    `Skipping Docker pre-version build for ${projects.join(
      ', ',
    )} during nx release dry-run.\n`,
  );
} else {
  process.stdout.write(
    `Building Docker release images for ${projects.join(
      ', ',
    )} before Nx retags them.\n`,
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
}
