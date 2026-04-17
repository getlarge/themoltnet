import { readFile } from 'node:fs/promises';
import path from 'node:path';

export type Criterion = {
  name: string;
  description: string;
  max_score: number;
};

export type Criteria = {
  type: 'weighted_checklist';
  context?: string;
  checklist: Criterion[];
};

export type Scenario = {
  id: string;
  dir: string;
  task: string;
  criteria: Criteria;
};

const SCENARIOS_DIR = path.resolve(
  process.cwd(),
  '../../evals/moltnet-practices',
);

export async function loadScenario(id: string): Promise<Scenario> {
  const dir = path.join(SCENARIOS_DIR, id);
  const [task, criteriaRaw] = await Promise.all([
    readFile(path.join(dir, 'task.md'), 'utf8'),
    readFile(path.join(dir, 'criteria.json'), 'utf8'),
  ]);
  const criteria = JSON.parse(criteriaRaw) as Criteria;
  if (criteria.type !== 'weighted_checklist') {
    throw new Error(
      `scenario ${id}: unsupported criteria type ${criteria.type}`,
    );
  }
  return { id, dir, task, criteria };
}
