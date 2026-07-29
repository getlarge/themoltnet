import { Type } from 'typebox';
import { describe, expect, it } from 'vitest';

import {
  buildPiExecutorManifest,
  defineGondolinTemplate,
  definePiExtension,
  definePiRuntime,
  definePiTool,
  filterModelVisibleTools,
  materializePiExtensions,
} from './runtime-definition.js';

function tool(name: string) {
  return definePiTool({
    descriptor: {
      name,
      label: name,
      description: `${name} tool`,
      parameters: Type.Object({}),
    },
    create: () =>
      ({
        name,
        label: name,
        description: `${name} tool`,
        parameters: Type.Object({}),
        execute: async () => ({ content: [], details: {} }),
      }) as never,
  });
}

describe('Pi runtime definitions', () => {
  it('uses the runtime-profile runtimeKind grammar', () => {
    const vm = defineGondolinTemplate({
      id: 'test-vm',
      version: '1',
      checkpointPath: '/tmp/checkpoint',
    });

    for (const runtimeKind of [
      'CustomPi',
      'custom:pi',
      `a${'b'.repeat(100)}`,
    ]) {
      expect(() =>
        definePiRuntime({
          id: 'invalid-kind',
          version: '1',
          runtimeKind,
          vm,
        }),
      ).toThrow(/Invalid runtime kind/);
    }
    expect(
      definePiRuntime({
        id: 'valid-kind',
        version: '1',
        runtimeKind: 'custom_pi.v2',
        vm,
      }).runtimeKind,
    ).toBe('custom_pi.v2');
  });

  it('rejects duplicate and reserved tool names before execution', () => {
    const vm = defineGondolinTemplate({
      id: 'test-vm',
      version: '1',
      checkpointPath: '/tmp/checkpoint',
    });

    expect(() =>
      definePiRuntime({
        id: 'duplicate',
        version: '1',
        vm,
        tools: [tool('review')],
        extensions: [
          definePiExtension({
            id: 'review-extension',
            declaredTools: ['review'],
            factory: () => undefined,
          }),
        ],
      }),
    ).toThrow(/declared by/);
    expect(() =>
      definePiRuntime({
        id: 'reserved-submit',
        version: '1',
        vm,
        tools: [tool('submit_fulfill_brief')],
      }),
    ).toThrow(/reserved/);
    expect(() =>
      definePiRuntime({
        id: 'reserved-subagent',
        version: '1',
        vm,
        tools: [tool('subagent')],
      }),
    ).toThrow(/reserved/);
  });

  it('builds a stable manifest from runtime, profile, template, and inventory', async () => {
    const runtime = definePiRuntime({
      id: 'custom',
      version: '2',
      runtimeKind: 'custom_pi',
      vm: defineGondolinTemplate({
        id: 'test-vm',
        version: '3',
        checkpointPath: '/tmp/checkpoint',
      }),
      tools: [tool('review')],
    });

    const manifest = await buildPiExecutorManifest({
      runtime,
      profile: { id: 'profile-id', definitionCid: 'bafkreiprofile' },
      template: {
        id: 'test-vm',
        version: '3',
        checkpointPath: '/tmp/checkpoint',
        fingerprint: 'bafkreitemplate',
        guestAssetBuildId: 'guest-build',
        executables: ['git'],
        resumeCommands: [],
      },
      builtInToolNames: ['read', 'bash'],
    });

    expect(manifest.runtime).toEqual({
      kind: 'custom_pi',
      engine: 'pi',
      sandbox: 'gondolin',
      id: 'custom',
      version: '2',
    });
    expect(manifest.tools.map(({ name }) => name)).toEqual([
      'bash',
      'read',
      'review',
    ]);
    expect(manifest.executables).toEqual(['git']);
  });

  it('keeps protocol tools while enforcing the model-visible allowlist', () => {
    const tools = [
      { name: 'read' },
      { name: 'write' },
      { name: 'bash' },
      { name: 'submit_freeform' },
    ] as never[];

    expect(
      filterModelVisibleTools(tools, {
        enforcement: 'enforce',
        allowedTools: new Set(['read']),
      }).map(({ name }) => name),
    ).toEqual(['read', 'bash', 'submit_freeform']);
  });

  it('keeps bash visible because command policy is enforced inside its gate', () => {
    expect(
      filterModelVisibleTools([{ name: 'bash' }] as never[], {
        enforcement: 'enforce',
        allowedTools: new Set(),
      }).map(({ name }) => name),
    ).toEqual(['bash']);
  });

  it('rejects extension registrations that differ from declarations', async () => {
    const runtime = definePiRuntime({
      id: 'extension-runtime',
      version: '1',
      vm: defineGondolinTemplate({
        id: 'test-vm',
        version: '1',
        checkpointPath: '/tmp/checkpoint',
      }),
      extensions: [
        definePiExtension({
          id: 'review-extension',
          declaredTools: ['review'],
          factory: (pi) => pi.registerTool({ name: 'surprise' } as never),
        }),
      ],
    });
    const [factory] = await materializePiExtensions({
      runtime,
      context: {} as never,
      target: 'parent',
    });

    expect(() => factory({ registerTool: () => undefined } as never)).toThrow(
      /registered undeclared tool "surprise"/,
    );
  });

  it('rejects extensions that omit a declared registration', async () => {
    const runtime = definePiRuntime({
      id: 'extension-runtime',
      version: '1',
      vm: defineGondolinTemplate({
        id: 'test-vm',
        version: '1',
        checkpointPath: '/tmp/checkpoint',
      }),
      extensions: [
        definePiExtension({
          id: 'review-extension',
          declaredTools: ['review'],
          factory: () => undefined,
        }),
      ],
    });
    const [factory] = await materializePiExtensions({
      runtime,
      context: {} as never,
      target: 'parent',
    });

    expect(() => factory({ registerTool: () => undefined } as never)).toThrow(
      /did not register declared tools: review/,
    );
  });
});
