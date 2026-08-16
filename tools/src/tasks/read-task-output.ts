import { parseArgs } from 'node:util';

import { resolveTasksApiContext } from './api.js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const { values } = parseArgs({
  options: {
    'task-id': { type: 'string' },
    'team-id': { type: 'string' },
    'agent-name': { type: 'string' },
  },
});

const taskId = values['task-id'];
const teamId = values['team-id'];
const agentName = values['agent-name'];

if (!taskId || !teamId || !agentName) {
  console.error(
    'Usage: tsx tools/src/tasks/read-task-output.ts --task-id <uuid> --team-id <uuid> --agent-name <name>',
  );
  process.exit(1);
}

if (!UUID_RE.test(taskId)) {
  throw new Error(`Invalid --task-id "${taskId}": expected a UUID.`);
}
if (!UUID_RE.test(teamId)) {
  throw new Error(`Invalid --team-id "${teamId}": expected a UUID.`);
}

const { agent } = await resolveTasksApiContext(process.cwd(), agentName);
const result = await agent.tasks.readResult(taskId, { teamId });
process.stdout.write(`${JSON.stringify(result.output)}\n`);
