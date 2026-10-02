import { executionCapabilityOfferFromPiManifest } from '@moltnet/execution-integrations/pi';
import {
  buildPiExecutorManifest,
  createGondolinDurableTaskExecutor,
  definePiRuntime,
  type GondolinTemplateDefinition,
} from '@themoltnet/pi-runtime';

import { registerRuntimeExecutionOffer } from './lib/runtime-governance.js';
import type { DaemonRuntimeAdapter, PreparedDaemonRuntime } from './runtime.js';

/** Explicit opt-in. Pi Durable and MoltNet attempt leases are separate schedulers. */
export function createDurableDaemonAdapter(options: {
  id: string;
  version: string;
  vm: GondolinTemplateDefinition;
}): DaemonRuntimeAdapter {
  const runtime = definePiRuntime({
    ...options,
    runtimeKind: 'gondolin_pi_durable',
  });
  return {
    runtimeKind: runtime.runtimeKind,
    async prepare({ profile, onProgress }) {
      if (profile.runtimeKind !== runtime.runtimeKind)
        throw new Error('Durable runtime kind mismatch');
      const template = await runtime.vm.resolve({ onProgress });
      const tools = ['read', 'write', 'edit', 'bash'];
      const manifest = await buildPiExecutorManifest({
        runtime,
        profile,
        template,
        builtInToolNames: tools,
      });
      const prepared: PreparedDaemonRuntime = {
        runtimeKind: runtime.runtimeKind,
        sessionPersistence: 'api',
        manifest: {
          ...manifest,
          durability: {
            format: 'pi-durable.v1',
            recovery: 'same-agent-valid-lease',
            workspace: 'persistent-mount',
          },
        },
        tools,
        executables: template.executables,
        createTaskExecutor: (input) =>
          createGondolinDurableTaskExecutor({
            ...input,
            template,
            runtimeKind: runtime.runtimeKind,
          }),
      };
      registerRuntimeExecutionOffer(prepared, (executorFingerprint) =>
        executionCapabilityOfferFromPiManifest(manifest, {
          executorFingerprint,
        }),
      );
      return prepared;
    },
  };
}
