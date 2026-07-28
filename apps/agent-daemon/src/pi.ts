import {
  buildPiExecutorManifest,
  createPiTaskExecutor,
  defineGondolinTemplate,
  definePiRuntime,
  type PiRuntimeDefinition,
} from '@themoltnet/pi-runtime';
import { createExecutorAttestor } from '@themoltnet/sdk';

import type { DaemonRuntimeAdapter, PreparedDaemonRuntime } from './runtime.js';

export const PI_KERNEL_TOOL_NAMES = [
  'read',
  'write',
  'edit',
  'bash',
  'ls',
  'find',
  'grep',
  'subagent',
  'moltnet_pack_get',
  'moltnet_pack_create',
  'moltnet_pack_provenance',
  'moltnet_pack_render',
  'moltnet_rendered_pack_list',
  'moltnet_rendered_pack_get',
  'moltnet_diary_tags',
  'moltnet_list_entries',
  'moltnet_get_entry',
  'moltnet_search_entries',
  'moltnet_create_entry',
  'moltnet_get_task',
  'moltnet_list_task_attempts',
  'moltnet_list_task_messages',
  'moltnet_upload_task_artifact',
  'moltnet_list_task_artifacts',
  'moltnet_download_task_artifact',
  'moltnet_review_session_errors',
  'moltnet_host_exec',
] as const;

export function createPiDaemonAdapter(
  runtime: PiRuntimeDefinition,
): DaemonRuntimeAdapter {
  let resolvedTemplate:
    | Awaited<ReturnType<PiRuntimeDefinition['vm']['resolve']>>
    | undefined;

  return {
    runtimeKind: runtime.runtimeKind,
    async prepare(input): Promise<PreparedDaemonRuntime> {
      if (input.profile.runtimeKind !== runtime.runtimeKind) {
        throw new Error(
          `Runtime profile ${input.profile.id} requires "${input.profile.runtimeKind}", ` +
            `but this daemon adapter provides "${runtime.runtimeKind}".`,
        );
      }
      resolvedTemplate ??= await runtime.vm.resolve({
        onProgress: input.onProgress,
      });
      const manifest = await buildPiExecutorManifest({
        runtime,
        profile: input.profile,
        template: resolvedTemplate,
        builtInToolNames: PI_KERNEL_TOOL_NAMES,
      });
      const attestor = await createExecutorAttestor({
        manifest: manifest as unknown as Record<string, unknown>,
        configDir: input.configDir,
      });
      const extensionTools = runtime.extensions.flatMap(
        (extension) => extension.declaredTools,
      );
      return {
        runtimeKind: runtime.runtimeKind,
        manifest: manifest as unknown as Record<string, unknown>,
        attestor,
        tools: [
          ...PI_KERNEL_TOOL_NAMES,
          ...runtime.tools.map((tool) => tool.descriptor.name),
          ...extensionTools,
        ],
        executables: resolvedTemplate.executables,
        createTaskExecutor: (options) =>
          createPiTaskExecutor({
            ...options,
            runtimeDefinition: runtime,
            resolvedVmTemplate: resolvedTemplate,
          }),
      };
    },
  };
}

export const defaultPiDaemonAdapter = createPiDaemonAdapter(
  definePiRuntime({
    id: 'moltnet-default-pi',
    version: '1',
    vm: defineGondolinTemplate({
      id: 'moltnet-default-gondolin',
      version: '1',
    }),
  }),
);
