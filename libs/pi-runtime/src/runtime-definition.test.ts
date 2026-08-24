import { Type } from 'typebox';
import { describe, expect, it, vi } from 'vitest';

import { agentSigningCapability } from './host-capabilities/agent-signing.js';
import {
  buildPiExecutorManifest,
  defineGondolinTemplate,
  definePiBrokeredHttpSecret,
  definePiExtension,
  definePiRuntime,
  definePiTool,
  filterModelVisibleTools,
  materializePiBrokeredHttpSecrets,
  materializePiExtensions,
  PiBrokeredHttpSecretResolutionError,
  type PiRuntimeDefinition,
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
    expect(manifest).not.toHaveProperty('brokeredHttpSecrets');

    const { brokeredHttpSecrets: _brokeredHttpSecrets, ...legacyFields } =
      runtime;
    const legacyRuntime = legacyFields as PiRuntimeDefinition;
    await expect(
      materializePiBrokeredHttpSecrets({
        runtime: legacyRuntime,
        context: {
          agentName: 'legreffier',
          claimedTask: {} as never,
          cwdPath: '/workspace',
        },
      }),
    ).resolves.toEqual([]);
  });

  it('attests host capabilities by name, origin and operation and rejects duplicates', async () => {
    const runtime = definePiRuntime({
      id: 'capability-runtime',
      version: '1',
      vm: defineGondolinTemplate({
        id: 'test-vm',
        version: '1',
        checkpointPath: '/tmp/checkpoint',
      }),
      hostCapabilities: [agentSigningCapability],
    });
    const manifest = await buildPiExecutorManifest({
      runtime,
      profile: { id: 'profile', definitionCid: 'bafkreiprofile' },
      template: {
        id: 'test-vm',
        version: '1',
        checkpointPath: '/tmp/checkpoint',
        fingerprint: 'bafkreitemplate',
        guestAssetBuildId: 'guest-build',
        executables: [],
        resumeCommands: [],
      },
    });
    expect(manifest.hostCapabilities).toEqual([
      {
        name: 'agent-signing',
        origin: 'https://agent-signing.moltnet.internal',
        operations: ['sign-diary-entry', 'sign-git-commit'],
        descriptorCid: agentSigningCapability.descriptorCid,
      },
    ]);
    expect(JSON.stringify(manifest)).not.toContain('handle');

    expect(() =>
      definePiRuntime({
        id: 'dup',
        version: '1',
        vm: defineGondolinTemplate({
          id: 'test-vm',
          version: '1',
          checkpointPath: '/tmp/checkpoint',
        }),
        hostCapabilities: [agentSigningCapability, agentSigningCapability],
      }),
    ).toThrow('Duplicate host capability name "agent-signing"');
  });

  it('attests broker descriptors without resolving or evidencing values', async () => {
    const sentinel = 'host-only-value';
    const resolve = vi.fn(() => sentinel);
    const runtime = definePiRuntime({
      id: 'credential-runtime',
      version: '1',
      vm: defineGondolinTemplate({
        id: 'test-vm',
        version: '1',
        checkpointPath: '/tmp/checkpoint',
      }),
      brokeredHttpSecrets: [
        definePiBrokeredHttpSecret({
          id: 'github-api',
          guestEnv: 'GH_TOKEN',
          hosts: [' API.GITHUB.COM ', 'api.github.com'],
          required: false,
          resolve,
        }),
      ],
    });

    const manifest = await buildPiExecutorManifest({
      runtime,
      profile: { id: 'profile-id', definitionCid: 'bafkreiprofile' },
      template: {
        id: 'test-vm',
        version: '1',
        checkpointPath: '/tmp/checkpoint',
        fingerprint: 'bafkreitemplate',
        guestAssetBuildId: 'guest-build',
        executables: ['gh'],
        resumeCommands: [],
      },
    });

    expect(resolve).not.toHaveBeenCalled();
    expect(manifest.brokeredHttpSecrets).toEqual([
      {
        id: 'github-api',
        guestEnv: 'GH_TOKEN',
        hosts: ['api.github.com'],
        protocol: 'https',
        ports: [443],
        required: false,
      },
    ]);
    expect(JSON.stringify(manifest)).not.toContain(sentinel);

    await expect(
      materializePiBrokeredHttpSecrets({
        runtime,
        context: {
          agentName: 'legreffier',
          claimedTask: {} as never,
          cwdPath: '/workspace',
        },
      }),
    ).resolves.toEqual([
      {
        id: 'github-api',
        guestEnv: 'GH_TOKEN',
        hosts: ['api.github.com'],
        protocol: 'https',
        ports: [443],
        required: false,
        value: sentinel,
      },
    ]);
  });

  it('redacts broker resolver failures', async () => {
    const runtime = definePiRuntime({
      id: 'credential-runtime',
      version: '1',
      vm: defineGondolinTemplate({
        id: 'test-vm',
        version: '1',
        checkpointPath: '/tmp/checkpoint',
      }),
      brokeredHttpSecrets: [
        definePiBrokeredHttpSecret({
          id: 'example-api',
          guestEnv: 'EXAMPLE_API_TOKEN',
          hosts: ['api.example.com'],
          resolve: () => {
            throw new Error('upstream included secret-value');
          },
        }),
      ],
    });

    let error: unknown;
    try {
      await materializePiBrokeredHttpSecrets({
        runtime,
        context: {
          agentName: 'legreffier',
          claimedTask: {} as never,
          cwdPath: '/workspace',
        },
      });
    } catch (caught) {
      error = caught;
    }
    expect(String(error)).toContain(
      'Brokered HTTP secret "example-api" resolution failed',
    );
    expect(String(error)).not.toContain('secret-value');
    expect(error).toBeInstanceOf(PiBrokeredHttpSecretResolutionError);
    expect((error as PiBrokeredHttpSecretResolutionError).retryable).toBe(true);
  });

  it('classifies missing required values as permanent and omits optional values', async () => {
    const runtime = definePiRuntime({
      id: 'credential-runtime',
      version: '1',
      vm: defineGondolinTemplate({
        id: 'test-vm',
        version: '1',
        checkpointPath: '/tmp/checkpoint',
      }),
      brokeredHttpSecrets: [
        definePiBrokeredHttpSecret({
          id: 'required-api',
          guestEnv: 'REQUIRED_API_TOKEN',
          hosts: ['api.example.com'],
          resolve: () => undefined,
        }),
      ],
    });

    await expect(
      materializePiBrokeredHttpSecrets({
        runtime,
        context: {
          agentName: 'legreffier',
          claimedTask: {} as never,
          cwdPath: '/workspace',
        },
      }),
    ).rejects.toMatchObject({
      name: 'PiBrokeredHttpSecretResolutionError',
      retryable: false,
    });

    const optionalRuntime = definePiRuntime({
      id: 'optional-runtime',
      version: '1',
      vm: runtime.vm,
      brokeredHttpSecrets: [
        definePiBrokeredHttpSecret({
          id: 'optional-api',
          guestEnv: 'OPTIONAL_API_TOKEN',
          hosts: ['api.example.com'],
          required: false,
          resolve: () => undefined,
        }),
      ],
    });
    await expect(
      materializePiBrokeredHttpSecrets({
        runtime: optionalRuntime,
        context: {
          agentName: 'legreffier',
          claimedTask: {} as never,
          cwdPath: '/workspace',
        },
      }),
    ).resolves.toEqual([
      expect.objectContaining({ id: 'optional-api', value: undefined }),
    ]);
  });

  it('bounds resolution and passes an abort signal to the provider', async () => {
    let resolverSignal: AbortSignal | undefined;
    const runtime = definePiRuntime({
      id: 'credential-runtime',
      version: '1',
      vm: defineGondolinTemplate({
        id: 'test-vm',
        version: '1',
        checkpointPath: '/tmp/checkpoint',
      }),
      brokeredHttpSecrets: [
        definePiBrokeredHttpSecret({
          id: 'slow-api',
          guestEnv: 'SLOW_API_TOKEN',
          hosts: ['api.example.com'],
          resolve: ({ signal }) => {
            resolverSignal = signal;
            return new Promise<string>(() => {});
          },
        }),
      ],
    });

    await expect(
      materializePiBrokeredHttpSecrets({
        runtime,
        context: {
          agentName: 'legreffier',
          claimedTask: {} as never,
          cwdPath: '/workspace',
        },
        timeoutMs: 5,
      }),
    ).rejects.toMatchObject({
      name: 'PiBrokeredHttpSecretResolutionError',
      retryable: true,
    });
    expect(resolverSignal?.aborted).toBe(true);

    const attemptController = new AbortController();
    const pending = materializePiBrokeredHttpSecrets({
      runtime,
      context: {
        agentName: 'legreffier',
        claimedTask: {} as never,
        cwdPath: '/workspace',
      },
      signal: attemptController.signal,
    });
    attemptController.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('does not invoke providers for an already-cancelled attempt', async () => {
    const resolve = vi.fn(() => 'must-not-be-minted');
    const runtime = definePiRuntime({
      id: 'credential-runtime',
      version: '1',
      vm: defineGondolinTemplate({
        id: 'test-vm',
        version: '1',
        checkpointPath: '/tmp/checkpoint',
      }),
      brokeredHttpSecrets: [
        definePiBrokeredHttpSecret({
          id: 'example-api',
          guestEnv: 'EXAMPLE_API_TOKEN',
          hosts: ['api.example.com'],
          resolve,
        }),
      ],
    });
    const controller = new AbortController();
    controller.abort();

    await expect(
      materializePiBrokeredHttpSecrets({
        runtime,
        context: {
          agentName: 'legreffier',
          claimedTask: {} as never,
          cwdPath: '/workspace',
        },
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(resolve).not.toHaveBeenCalled();
  });

  it('aborts and settles sibling providers after one binding fails', async () => {
    let siblingSignal: AbortSignal | undefined;
    let siblingSettled = false;
    const runtime = definePiRuntime({
      id: 'credential-runtime',
      version: '1',
      vm: defineGondolinTemplate({
        id: 'test-vm',
        version: '1',
        checkpointPath: '/tmp/checkpoint',
      }),
      brokeredHttpSecrets: [
        definePiBrokeredHttpSecret({
          id: 'missing-api',
          guestEnv: 'MISSING_API_TOKEN',
          hosts: ['api.example.com'],
          resolve: () => undefined,
        }),
        definePiBrokeredHttpSecret({
          id: 'slow-api',
          guestEnv: 'SLOW_API_TOKEN',
          hosts: ['api.example.com'],
          resolve: ({ signal }) => {
            siblingSignal = signal;
            return new Promise<string>((_resolve, reject) => {
              signal.addEventListener(
                'abort',
                () => {
                  siblingSettled = true;
                  reject(new Error('sibling aborted'));
                },
                { once: true },
              );
            });
          },
        }),
      ],
    });

    await expect(
      materializePiBrokeredHttpSecrets({
        runtime,
        context: {
          agentName: 'legreffier',
          claimedTask: {} as never,
          cwdPath: '/workspace',
        },
      }),
    ).rejects.toMatchObject({
      requirementId: 'missing-api',
      retryable: false,
    });
    expect(siblingSignal?.aborted).toBe(true);
    expect(siblingSettled).toBe(true);
  });

  it('prefers permanent failures over transient failures deterministically', async () => {
    const runtime = definePiRuntime({
      id: 'credential-runtime',
      version: '1',
      vm: defineGondolinTemplate({
        id: 'test-vm',
        version: '1',
        checkpointPath: '/tmp/checkpoint',
      }),
      brokeredHttpSecrets: [
        definePiBrokeredHttpSecret({
          id: 'transient-api',
          guestEnv: 'TRANSIENT_API_TOKEN',
          hosts: ['api.example.com'],
          resolve: () => {
            throw new Error('temporary provider failure');
          },
        }),
        definePiBrokeredHttpSecret({
          id: 'missing-api',
          guestEnv: 'MISSING_API_TOKEN',
          hosts: ['api.example.com'],
          resolve: () => undefined,
        }),
      ],
    });

    await expect(
      materializePiBrokeredHttpSecrets({
        runtime,
        context: {
          agentName: 'legreffier',
          claimedTask: {} as never,
          cwdPath: '/workspace',
        },
      }),
    ).rejects.toMatchObject({
      requirementId: 'missing-api',
      retryable: false,
    });
  });

  it('gives cancellation deterministic precedence over provider failure', async () => {
    const attempt = new AbortController();
    const runtime = definePiRuntime({
      id: 'credential-runtime',
      version: '1',
      vm: defineGondolinTemplate({
        id: 'test-vm',
        version: '1',
        checkpointPath: '/tmp/checkpoint',
      }),
      brokeredHttpSecrets: [
        definePiBrokeredHttpSecret({
          id: 'example-api',
          guestEnv: 'EXAMPLE_API_TOKEN',
          hosts: ['api.example.com'],
          resolve: () => {
            attempt.abort();
            throw new Error('provider failed with secret-value');
          },
        }),
      ],
    });

    await expect(
      materializePiBrokeredHttpSecrets({
        runtime,
        context: {
          agentName: 'legreffier',
          claimedTask: {} as never,
          cwdPath: '/workspace',
        },
        signal: attempt.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it.each([0, 1.5, 2_147_483_648, Number.POSITIVE_INFINITY])(
    'rejects unsupported timeout %s before invoking a resolver',
    async (timeoutMs) => {
      const resolve = vi.fn(() => 'must-not-be-minted');
      const runtime = definePiRuntime({
        id: 'credential-runtime',
        version: '1',
        vm: defineGondolinTemplate({
          id: 'test-vm',
          version: '1',
          checkpointPath: '/tmp/checkpoint',
        }),
        brokeredHttpSecrets: [
          definePiBrokeredHttpSecret({
            id: 'example-api',
            guestEnv: 'EXAMPLE_API_TOKEN',
            hosts: ['api.example.com'],
            resolve,
          }),
        ],
      });

      await expect(
        materializePiBrokeredHttpSecrets({
          runtime,
          context: {
            agentName: 'legreffier',
            claimedTask: {} as never,
            cwdPath: '/workspace',
          },
          timeoutMs,
        }),
      ).rejects.toThrow(/must be an integer between/);
      expect(resolve).not.toHaveBeenCalled();
    },
  );

  it('keeps protocol tools while enforcing the model-visible allowlist', () => {
    const tools = [
      { name: 'read' },
      { name: 'write' },
      { name: 'bash' },
      { name: 'submit_freeform' },
      { name: 'subagent' },
    ] as never[];

    expect(
      filterModelVisibleTools(tools, {
        enforcement: 'enforce',
        allowedTools: new Set(['read']),
        allowedShellCommands: [{ argvPrefix: ['git', 'diff'] }],
      }).map(({ name }) => name),
    ).toEqual(['read', 'bash', 'submit_freeform', 'subagent']);
  });

  it('hides bash when no shell command prefix is authorized', () => {
    expect(
      filterModelVisibleTools([{ name: 'bash' }] as never[], {
        enforcement: 'enforce',
        allowedTools: new Set(),
        allowedShellCommands: [],
      }).map(({ name }) => name),
    ).toEqual([]);
  });

  it('keeps bash visible when the analyzer has an authorized command', () => {
    expect(
      filterModelVisibleTools([{ name: 'bash' }] as never[], {
        enforcement: 'enforce',
        allowedTools: new Set(),
        allowedShellCommands: [{ argvPrefix: ['git', 'diff'] }],
      }).map(({ name }) => name),
    ).toEqual(['bash']);
  });

  it('preserves the legacy policy shape where shell commands were omitted', () => {
    expect(
      filterModelVisibleTools([{ name: 'bash' }, { name: 'read' }] as never[], {
        enforcement: 'enforce',
        allowedTools: new Set(['read']),
      }).map(({ name }) => name),
    ).toEqual(['bash', 'read']);
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
