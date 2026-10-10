import type { VM } from '@earendil-works/gondolin';
import {
  createBashToolDefinition,
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent';

import {
  createGondolinBashOps,
  createGondolinEditOps,
  createGondolinFindOps,
  createGondolinLsOps,
  createGondolinReadOps,
  createGondolinWriteOps,
  executeGondolinGrep,
  type GondolinToolLifecycle,
  type GondolinVmRetirement,
  guardGondolinToolDefinitions,
} from './tool-operations.js';

export function createGondolinToolDefinitions(config: {
  vm: VM;
  cwdPath: string;
  guestWorkspace: string;
  lifecycle: GondolinToolLifecycle;
  retireVm: (retirement: GondolinVmRetirement) => Promise<void>;
}): ToolDefinition[] {
  const { vm, cwdPath, guestWorkspace, lifecycle, retireVm } = config;
  const readTools = createGondolinReadToolDefinitions(config);
  return guardGondolinToolDefinitions(
    [
      readTools[0],
      createWriteToolDefinition(cwdPath, {
        operations: createGondolinWriteOps(vm, cwdPath, guestWorkspace),
      }),
      createEditToolDefinition(cwdPath, {
        operations: createGondolinEditOps(vm, cwdPath, guestWorkspace),
      }),
      createBashToolDefinition(cwdPath, {
        operations: createGondolinBashOps(vm, cwdPath, guestWorkspace, {
          lifecycle,
          retireVm,
        }),
      }),
      ...readTools.slice(1),
    ] as unknown as ToolDefinition[],
    lifecycle,
  );
}

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
