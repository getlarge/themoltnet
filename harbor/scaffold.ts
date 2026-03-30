/* eslint-disable no-console */
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const HARBOR_DIR = __dirname;
const TEMPLATES_DIR = join(HARBOR_DIR, 'templates');
const EVALS_DIR = join(ROOT, 'tiles', 'moltnet-practices', 'evals');
const TASKS_DIR = join(HARBOR_DIR, 'tasks');
const TILE_DOCS_DIR = join(
  ROOT,
  '.tessl',
  'tiles',
  'getlarge',
  'moltnet-practices',
  'docs',
);

async function loadTileDocs(): Promise<string> {
  const files = ['index.md', 'database-patterns.md', 'incident-patterns.md'];
  const parts: string[] = [];
  for (const file of files) {
    const content = await readFile(join(TILE_DOCS_DIR, file), 'utf-8');
    parts.push(content);
  }
  return parts.join('\n\n---\n\n');
}

async function scaffoldTask(
  evalDir: string,
  name: string,
  withContext: boolean,
  tileDocs: string,
  templates: { taskToml: string; dockerfile: string; testSh: string },
): Promise<void> {
  const variant = withContext ? `${name}-with-context` : name;
  const taskDir = join(TASKS_DIR, variant);
  const judgeDir = join(HARBOR_DIR, 'judge');

  await rm(taskDir, { recursive: true, force: true });
  await mkdir(join(taskDir, 'environment'), { recursive: true });
  await mkdir(join(taskDir, 'tests', 'judge'), { recursive: true });

  await writeFile(join(taskDir, 'task.toml'), templates.taskToml);

  const taskMd = await readFile(join(evalDir, 'task.md'), 'utf-8');
  await writeFile(join(taskDir, 'instruction.md'), taskMd);

  await writeFile(
    join(taskDir, 'environment', 'Dockerfile'),
    templates.dockerfile,
  );

  // Copy judge into environment/ so the Dockerfile can bake it into the image
  // with pre-installed deps (avoids permission + network issues at runtime).
  await mkdir(join(taskDir, 'environment', 'judge'), { recursive: true });
  await copyFile(
    join(judgeDir, 'package.json'),
    join(taskDir, 'environment', 'judge', 'package.json'),
  );
  await copyFile(
    join(judgeDir, 'judge.js'),
    join(taskDir, 'environment', 'judge', 'judge.js'),
  );

  if (withContext) {
    const claudeDir = join(taskDir, 'environment', '.claude');
    await mkdir(claudeDir, { recursive: true });
    await writeFile(
      join(claudeDir, 'CLAUDE.md'),
      `# MoltNet Development Practices\n\nThis context is from the moltnet-practices tile. Use it to inform your work.\n\n${tileDocs}`,
    );
  }

  await copyFile(
    join(evalDir, 'criteria.json'),
    join(taskDir, 'tests', 'criteria.json'),
  );

  await writeFile(join(taskDir, 'tests', 'test.sh'), templates.testSh, {
    mode: 0o755,
  });

  await copyFile(
    join(judgeDir, 'package.json'),
    join(taskDir, 'tests', 'judge', 'package.json'),
  );
  await copyFile(
    join(judgeDir, 'judge.js'),
    join(taskDir, 'tests', 'judge', 'judge.js'),
  );

  console.log(`  ${variant}`);
}

async function main(): Promise<void> {
  console.log('Scaffolding Harbor tasks from tile evals...\n');

  const [tileDocs, taskToml, dockerfile, testSh] = await Promise.all([
    loadTileDocs(),
    readFile(join(TEMPLATES_DIR, 'task.toml'), 'utf-8'),
    readFile(join(TEMPLATES_DIR, 'Dockerfile'), 'utf-8'),
    readFile(join(TEMPLATES_DIR, 'test.sh'), 'utf-8'),
  ]);

  const templates = { taskToml, dockerfile, testSh };

  const evalDirs = await readdir(EVALS_DIR, { withFileTypes: true });
  const evals = evalDirs
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  console.log(`Found ${evals.length} eval(s) in ${EVALS_DIR}\n`);

  await rm(TASKS_DIR, { recursive: true, force: true });
  await mkdir(TASKS_DIR, { recursive: true });

  for (const name of evals) {
    const evalDir = join(EVALS_DIR, name);
    await scaffoldTask(evalDir, name, false, tileDocs, templates);
    await scaffoldTask(evalDir, name, true, tileDocs, templates);
  }

  console.log(
    `\nDone: ${evals.length * 2} tasks (${evals.length} x 2 variants)`,
  );
}

main().catch((err) => {
  console.error('Scaffold failed:', err);
  process.exit(1);
});
