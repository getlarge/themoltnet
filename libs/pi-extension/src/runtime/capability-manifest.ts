import {
  assertRuntimeCapabilityManifest,
  getRuntimeCapabilityManifest,
} from '@moltnet/models';

export interface NamedRuntimeTool {
  name: string;
}

export function assertGondolinPiToolDefinitions(
  tools: readonly NamedRuntimeTool[],
): void {
  assertRuntimeCapabilityManifest(
    'gondolin_pi',
    getRuntimeCapabilityManifest('gondolin_pi').version,
    tools.map((tool) => tool.name),
  );
}
