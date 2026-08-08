import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const projectRoot = dirname(fileURLToPath(import.meta.url));
const generatedRoot = resolve(projectRoot, '_build');
const configs = [
  resolve(projectRoot, 'testdata/sanity-config.yaml'),
  resolve(projectRoot, '../collector-config.dev.yaml'),
  resolve(projectRoot, '../collector-config.yaml'),
];

for (const config of configs) {
  execFileSync('go', ['run', '.', 'validate', `--config=${config}`], {
    cwd: generatedRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      AXIOM_API_TOKEN: 'validation-only',
      AXIOM_LOGS_DATASET: 'moltnet-logs',
      AXIOM_METRICS_DATASET: 'moltnet-metrics',
      AXIOM_TRACES_DATASET: 'moltnet-traces',
      GOWORK: 'off',
      ORY_API_KEY: 'validation-only',
      ORY_PROJECT_URL: 'https://project.example',
    },
  });
}
