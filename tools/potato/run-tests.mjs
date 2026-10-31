// Shared Python test launcher; each Nx project supplies its own source/test roots.
import { spawnSync } from 'node:child_process';
import { delimiter, resolve } from 'node:path';

const [scripts, tests] = process.argv.slice(2);
if (!scripts || !tests) {
  throw new Error('Expected Python script and test directories');
}
const result = spawnSync(
  process.env.POTATO_PYTHON || 'python3',
  ['-m', 'unittest', 'discover', '-s', tests, '-p', 'test_*.py', '-v'],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      PYTHONPATH: [resolve(scripts), process.env.PYTHONPATH]
        .filter(Boolean)
        .join(delimiter),
    },
  },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
