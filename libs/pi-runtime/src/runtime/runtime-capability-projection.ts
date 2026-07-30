import type { ToolEnforcement } from '@moltnet/models';

import type { ShellCommandRule } from '../tool-policy/gate.js';
import type { RuntimeInstructorToolPolicy } from './runtime-instructor.js';

interface ResolvedToolPolicy {
  enforcement: ToolEnforcement;
  allowedTools: ReadonlySet<string>;
  allowedShellCommands: readonly ShellCommandRule[];
  degraded: boolean;
}

export interface RuntimeCapabilityProjection {
  instructorPolicy: RuntimeInstructorToolPolicy;
  unavailableTools: string[];
  unavailableExecutables: string[];
  droppedShellCommandCount: number;
}

/**
 * Project trusted policy resolution and runtime inventory into the exact
 * model-visible policy plus host-side degradation diagnostics.
 */
export function projectRuntimeCapabilities(input: {
  policy?: ResolvedToolPolicy;
  visibleToolNames: readonly string[];
  unavailableShellCommands?: readonly ShellCommandRule[];
}): RuntimeCapabilityProjection {
  const visibleOptionalTools = input.visibleToolNames.filter(
    (name) => !name.startsWith('submit_'),
  );
  if (!input.policy) {
    return {
      instructorPolicy: {
        enforcement: 'off',
        allowedTools: visibleOptionalTools,
        allowedShellCommands: [],
        degraded: false,
      },
      unavailableTools: [],
      unavailableExecutables: [],
      droppedShellCommandCount: 0,
    };
  }

  const visible = new Set(input.visibleToolNames);
  const unavailableTools = [...input.policy.allowedTools]
    .filter((name) => !visible.has(name))
    .sort();
  const unavailableShellCommands = input.unavailableShellCommands ?? [];
  return {
    instructorPolicy: {
      enforcement: input.policy.enforcement,
      allowedTools: visibleOptionalTools,
      allowedShellCommands: input.policy.allowedShellCommands,
      degraded: input.policy.degraded,
    },
    unavailableTools,
    unavailableExecutables: [
      ...new Set(
        unavailableShellCommands.map(({ argvPrefix }) => argvPrefix[0]),
      ),
    ].sort(),
    droppedShellCommandCount: unavailableShellCommands.length,
  };
}
