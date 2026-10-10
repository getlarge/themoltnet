import type { VM } from '@earendil-works/gondolin';

export const GONDOLIN_TOOL_NAMES = [
  'read',
  'write',
  'edit',
  'bash',
  'ls',
  'find',
  'grep',
] as const;
import {
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent';

import {
  createGondolinFindOps,
  createGondolinLsOps,
  createGondolinReadOps,
  executeGondolinGrep,
  type GondolinToolLifecycle,
  guardGondolinToolDefinitions,
} from './tool-operations.js';

/** Native read/search tools need only a cwd and model, never a session manager. */
export function createGondolinReadToolDefinitions(config: {
  vm: VM;
  cwdPath: string;
  guestWorkspace: string;
  lifecycle: GondolinToolLifecycle;
}): ToolDefinition[] {
  const { vm, cwdPath, guestWorkspace, lifecycle } = config;
  const grepTool = createGrepToolDefinition(cwdPath);
  return guardGondolinToolDefinitions(
    [
      createReadToolDefinition(cwdPath, {
        operations: createGondolinReadOps(vm, cwdPath, guestWorkspace),
      }),
      createLsToolDefinition(cwdPath, {
        operations: createGondolinLsOps(vm, cwdPath, guestWorkspace),
      }),
      createFindToolDefinition(cwdPath, {
        operations: createGondolinFindOps(vm, cwdPath, guestWorkspace),
      }),
      {
        ...grepTool,
        async execute(
          ...args: Parameters<typeof grepTool.execute>
        ): ReturnType<typeof grepTool.execute> {
          const [_id, params, signal] = args;
          return executeGondolinGrep(
            vm,
            cwdPath,
            guestWorkspace,
            params,
            signal,
          );
        },
      },
    ] as unknown as ToolDefinition[],
    lifecycle,
  );
}
