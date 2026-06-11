import type { Task as DbTask } from '@moltnet/database';
import {
  type ClaimCondition,
  ClaimCondition as ClaimConditionSchema,
  ClaimConditionDefinition,
  TaskStatus as TaskStatusSchema,
  type TaskValidationError,
} from '@moltnet/tasks';
import { Value } from 'typebox/value';

function formatField(prefix: string, path: string): string {
  return path ? `${prefix}${path}` : prefix;
}

const MAX_CLAIM_CONDITION_DEPTH = 4;

export function validateClaimConditionShape(
  condition: unknown,
): TaskValidationError[] {
  // ClaimCondition's `task_status` leaf references the TaskStatus schema by
  // $id (Type.Ref('TaskStatus')). Value.Errors must be given that referenced
  // schema in its context map, otherwise it throws TypeDereferenceError and
  // the whole create request 500s.
  const schemaErrors = [
    ...Value.Errors(
      {
        ClaimCondition: ClaimConditionDefinition,
        TaskStatus: TaskStatusSchema,
      },
      ClaimConditionSchema,
      condition,
    ),
  ].map((error) => ({
    field: formatField('claimCondition', error.instancePath),
    message: error.message,
  }));
  return [
    ...schemaErrors,
    ...validateClaimConditionDepth(condition, 'claimCondition', 1),
  ];
}

function validateClaimConditionDepth(
  condition: unknown,
  path: string,
  depth: number,
): TaskValidationError[] {
  if (depth > MAX_CLAIM_CONDITION_DEPTH) {
    return [
      {
        field: path,
        message: `Claim condition nesting depth must be <= ${MAX_CLAIM_CONDITION_DEPTH}`,
      },
    ];
  }
  if (typeof condition !== 'object' || condition === null) return [];
  const op = (condition as { op?: unknown }).op;
  if (op !== 'all' && op !== 'any') return [];
  const children = (condition as { conditions?: unknown }).conditions;
  if (!Array.isArray(children)) return [];
  return children.flatMap((child, index) =>
    validateClaimConditionDepth(
      child,
      `${path}.conditions[${index}]`,
      depth + 1,
    ),
  );
}

export function evaluateClaimConditionFromTasks(
  condition: ClaimCondition,
  tasksById: ReadonlyMap<string, DbTask>,
): boolean {
  switch (condition.op) {
    case 'all':
      return condition.conditions.every((child) =>
        evaluateClaimConditionFromTasks(child, tasksById),
      );
    case 'any':
      return condition.conditions.some((child) =>
        evaluateClaimConditionFromTasks(child, tasksById),
      );
    case 'task_status': {
      const task = tasksById.get(condition.taskId);
      return task ? condition.statuses.includes(task.status) : false;
    }
    case 'task_accepted': {
      const task = tasksById.get(condition.taskId);
      return (
        task?.acceptedAttemptN !== null && task?.acceptedAttemptN !== undefined
      );
    }
  }
}

export function collectConditionTaskIds(
  condition: ClaimCondition,
  out = new Set<string>(),
): Set<string> {
  switch (condition.op) {
    case 'all':
    case 'any':
      for (const child of condition.conditions) {
        collectConditionTaskIds(child, out);
      }
      break;
    case 'task_status':
    case 'task_accepted':
      out.add(condition.taskId);
      break;
  }
  return out;
}
