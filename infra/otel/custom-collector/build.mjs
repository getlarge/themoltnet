import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const projectRoot = dirname(fileURLToPath(import.meta.url));
const generatedRoot = resolve(projectRoot, '_build');

execFileSync(
  'go',
  [
    'run',
    'go.opentelemetry.io/collector/cmd/builder@v0.150.0',
    '--config=builder.yaml',
    '--skip-compilation',
  ],
  {
    cwd: projectRoot,
    stdio: 'inherit',
    env: { ...process.env, GOWORK: 'off' },
  },
);

for (const arch of ['amd64', 'arm64']) {
  const outputDir = resolve(generatedRoot, `linux-${arch}`);
  mkdirSync(outputDir, { recursive: true });
  execFileSync(
    'go',
    ['build', '-trimpath', '-o', resolve(outputDir, 'moltnet-otelcol'), '.'],
    {
      cwd: generatedRoot,
      stdio: 'inherit',
      env: {
        ...process.env,
        CGO_ENABLED: '0',
        GOOS: 'linux',
        GOARCH: arch,
        GOWORK: 'off',
      },
    },
  );
}
