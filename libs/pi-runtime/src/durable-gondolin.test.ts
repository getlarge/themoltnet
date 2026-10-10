import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  Type,
} from '@earendil-works/pi-ai';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import type { ClaimedTask, TaskReporter } from '@themoltnet/agent-runtime';
import { afterEach, expect, it, vi } from 'vitest';

import { remoteLog } from '../__tests__/durable-log.js';
import { createGondolinDurableTaskExecutor } from './durable-gondolin.js';
import { acquireDurableTransport } from './durable-transport.js';
import { agentSigningCapability } from './host-capabilities/agent-signing.js';
import type { ExecutePiTaskOptions } from './runtime/execute-pi-task.js';
import {
  defineGondolinTemplate,
  definePiBrokeredHttpSecret,
  definePiRuntime,
  definePiTool,
} from './runtime-definition.js';

vi.mock('./durable-transport.js', () => ({ acquireDurableTransport: vi.fn() }));

const dirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

const identity = {
  protocolVersion: 1 as const,
  agentName: 'a',
  subjectId: 'agent-1',
  subjectType: 'agent' as const,
  publicKey: 'ed25519:wBkbENwyQSOnY+OZIsVX1F3b35JvQ42juWDXyqTapN4=',
  fingerprint: 'F',
  gitName: 'A',
  gitEmail: 'a@x',
};
const origin = 'https://agent-signing.moltnet.internal';

function setup(granted: boolean, tools: string[] = []) {
  const mountPath = mkdtempSync(join(tmpdir(), 'durable-capabilities-'));
  dirs.push(mountPath);
  vi.stubEnv('PI_CODING_AGENT_DIR', mountPath);
  const remote = remoteLog();
  const controller = new AbortController();
  vi.mocked(acquireDurableTransport).mockResolvedValue({
    transport: remote.transport,
    signal: controller.signal,
    check: () => controller.signal.throwIfAborted(),
  });
  const faux = fauxProvider({ tokensPerSecond: 0 });
  const models = createModels();
  models.setProvider(faux.provider);
  vi.spyOn(ModelRuntime, 'create').mockResolvedValue(
    Object.assign(models, {
      getModel: () => faux.models[0],
      getError: () => undefined,
    }) as unknown as ModelRuntime,
  );
  faux.setResponses([
    fauxAssistantMessage(
      fauxToolCall('submit_freeform_output', { summary: 'Done' }),
      { stopReason: 'toolUse' },
    ),
  ]);
  const signer = {
    identity,
    signGitCommit: vi.fn().mockResolvedValue({ signature: new Uint8Array(64) }),
    signDiaryEntry: vi.fn(),
  };
  const resolve = vi.fn().mockResolvedValue('test-host-token');
  const runtime = definePiRuntime({
    id: 'durable-test',
    version: '1',
    vm: defineGondolinTemplate({
      id: 'vm',
      version: '1',
      checkpointPath: '/checkpoint',
    }),
    hostCapabilities: [agentSigningCapability],
    brokeredHttpSecrets: [
      definePiBrokeredHttpSecret({
        id: 'test-http',
        guestEnv: 'TEST_TOKEN',
        hosts: ['example.com'],
        resolve,
      }),
    ],
  });
  const stop = vi.fn().mockResolvedValue(undefined);
  const close = vi.fn().mockResolvedValue(undefined);
  const revokeSecret = vi.fn();
  const resumeVm = vi
    .fn<NonNullable<ExecutePiTaskOptions['resumeVm']>>()
    .mockResolvedValue({
      vm: { id: 'vm', fs: {}, close },
      credentials: { agentEnv: {} },
      services: { stop },
      guestWorkspace: '/workspace',
      secretManager: { revokeSecret },
    } as never);
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn() };
  const options = {
    agentName: 'a',
    provider: faux.provider.id,
    model: faux.models[0].id,
    runtimeProfileId: 'profile',
    mountPath,
    runtimeDefinition: runtime,
    agentIdentity: identity,
    hostCapabilitySigner: signer,
    resumeVm,
    toolPolicyLogger: logger,
    moltnetAgent: {
      runtimeSessions: {},
      runtimeProfiles: {
        allowedTools: vi.fn().mockResolvedValue({
          enforcement: 'enforce',
          runtimeKind: 'gondolin_pi_durable',
          allowedTools: [
            ...(granted ? ['capability:agent-signing'] : []),
            ...tools,
          ],
          allowedShellCommands: [],
        }),
      },
    } as unknown as ExecutePiTaskOptions['moltnetAgent'],
    template: {
      id: 'vm',
      version: '1',
      checkpointPath: '/checkpoint',
      fingerprint: 'template',
      guestAssetBuildId: 'guest',
      executables: [],
      resumeCommands: [],
    },
    runtimeKind: 'gondolin_pi_durable',
  };
  const claimed = {
    task: {
      id: 'aaaaaaaa-0000-4000-8000-000000000001',
      taskType: 'freeform',
      teamId: 'team',
      input: { brief: 'Do it' },
      inputCid: 'bafy-input',
      diaryId: 'diary',
    },
    attemptN: 1,
    traceHeaders: {},
  } as unknown as ClaimedTask;
  const reporter = {
    open: vi.fn(),
    record: vi.fn(),
    finalize: vi.fn(),
    close: vi.fn(),
    cancelReason: null,
    cancelSignal: controller.signal,
  } as TaskReporter;
  return {
    faux,
    options,
    claimed,
    reporter,
    resumeVm,
    signer,
    resolve,
    stop,
    close,
    revokeSecret,
  };
}

it.each([false, true])(
  'enforces host signing policy before VM startup (grant: %s) and revokes access at cleanup',
  async (granted) => {
    const s = setup(granted);
    const managed = await s.resumeVm({} as never);
    s.resumeVm.mockClear();
    s.resumeVm.mockImplementation(async (config) => {
      expect(s.resolve).toHaveBeenCalledOnce();
      expect(config.brokeredSecrets).toEqual([
        expect.objectContaining({
          guestEnv: 'TEST_TOKEN',
          value: 'test-host-token',
        }),
      ]);
      expect(config.guestProjection?.env?.SSH_AUTH_SOCK).toBeDefined();
      const response = await config.hostOrigins![origin](
        new Request(`${origin}/sign-git-commit`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            sshsig: Buffer.from('test').toString('base64'),
          }),
        }),
      );
      expect(response.status).toBe(granted ? 200 : 403);
      return managed;
    });
    const output = await createGondolinDurableTaskExecutor(s.options)(
      s.claimed,
      s.reporter,
    );
    expect(output.status).toBe('completed');
    expect(s.signer.signGitCommit).toHaveBeenCalledTimes(granted ? 1 : 0);
    expect(s.revokeSecret).toHaveBeenCalledWith('TEST_TOKEN');
    expect(s.stop).toHaveBeenCalledOnce();
    expect(s.close).toHaveBeenCalledOnce();
    const handler = s.resumeVm.mock.calls[0][0].hostOrigins![origin];
    const response = await handler(
      new Request(`${origin}/sign-git-commit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sshsig: Buffer.from('test').toString('base64'),
        }),
      }),
    );
    expect(response.status).not.toBe(200);
    expect(s.signer.signGitCommit).toHaveBeenCalledTimes(granted ? 1 : 0);
  },
);

it('fails before VM resume when declared host capabilities lack identity', async () => {
  const s = setup(true);
  await expect(
    createGondolinDurableTaskExecutor({
      ...s.options,
      agentIdentity: undefined,
    })(s.claimed, s.reporter),
  ).rejects.toThrow('no agent identity');
  expect(s.resumeVm).not.toHaveBeenCalled();
});

it('fails before VM resume if brokered credential resolution fails', async () => {
  const s = setup(true);
  s.resolve.mockRejectedValue(new Error('credential unavailable'));
  await expect(
    createGondolinDurableTaskExecutor(s.options)(s.claimed, s.reporter),
  ).rejects.toThrow();
  expect(s.resumeVm).not.toHaveBeenCalled();
});

it('stops services and closes the VM even when credential revocation fails', async () => {
  const s = setup(true);
  s.revokeSecret.mockImplementation(() => {
    throw new Error('revoke failed');
  });
  await expect(
    createGondolinDurableTaskExecutor(s.options)(s.claimed, s.reporter),
  ).rejects.toThrow('cleanup interrupted');
  expect(s.stop).toHaveBeenCalledOnce();
  expect(s.close).toHaveBeenCalledOnce();
  const handler = s.resumeVm.mock.calls[0][0].hostOrigins![origin];
  const response = await handler(
    new Request(`${origin}/sign-git-commit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sshsig: Buffer.from('test').toString('base64') }),
    }),
  );
  expect(response.status).not.toBe(200);
  expect(s.signer.signGitCommit).not.toHaveBeenCalled();
});

it('revokes the capability handlers if VM startup fails', async () => {
  const s = setup(true);
  s.resumeVm.mockRejectedValue(new Error('VM startup failed'));
  await expect(
    createGondolinDurableTaskExecutor(s.options)(s.claimed, s.reporter),
  ).rejects.toThrow('VM startup failed');
  const handler = s.resumeVm.mock.calls[0][0].hostOrigins![origin];
  const response = await handler(
    new Request(`${origin}/sign-git-commit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sshsig: Buffer.from('test').toString('base64') }),
    }),
  );
  expect(response.status).not.toBe(200);
  expect(s.signer.signGitCommit).not.toHaveBeenCalled();
});

it('runs a policy-approved custom tool and shares task instructions', async () => {
  const s = setup(false, ['project_lookup']);
  const execute = vi.fn().mockResolvedValue({
    content: [{ type: 'text', text: 'found' }],
    details: { optional: undefined },
  });
  const custom = definePiTool({
    name: 'project_lookup',
    label: 'Lookup',
    description: 'Lookup project',
    parameters: Type.Object({}),
    execute,
  });
  const options = {
    ...s.options,
    runtimeDefinition: { ...s.options.runtimeDefinition, tools: [custom] },
  };
  let observed: unknown;
  s.faux.setResponses([
    (context) => {
      observed = context;
      return fauxAssistantMessage(fauxToolCall('project_lookup', {}), {
        stopReason: 'toolUse',
      });
    },
    fauxAssistantMessage(
      fauxToolCall('submit_freeform_output', { summary: 'Done' }),
      { stopReason: 'toolUse' },
    ),
  ]);
  const result = await createGondolinDurableTaskExecutor(options)(
    s.claimed,
    s.reporter,
  );
  expect(result.status).toBe('completed');
  expect(observed).toBeDefined();
  expect(JSON.stringify(observed)).toContain('Effective runtime tool policy');
  expect(JSON.stringify(observed)).toContain('project_lookup');
  expect(JSON.stringify(observed)).not.toContain('moltnet_create_entry');
  expect(execute).toHaveBeenCalledOnce();
});

it('uses the host SDK for an authorized MoltNet tool', async () => {
  const s = setup(false, ['moltnet_pack_get']);
  const get = vi.fn().mockResolvedValue({ id: 'pack' });
  Object.assign(s.options.moltnetAgent!, { packs: { get } });
  s.faux.setResponses([
    fauxAssistantMessage(fauxToolCall('moltnet_pack_get', { packId: 'pack' }), {
      stopReason: 'toolUse',
    }),
    fauxAssistantMessage(
      fauxToolCall('submit_freeform_output', { summary: 'Done' }),
      { stopReason: 'toolUse' },
    ),
  ]);
  const result = await createGondolinDurableTaskExecutor(s.options)(
    s.claimed,
    s.reporter,
  );
  expect(result.status).toBe('completed');
  expect(get).toHaveBeenCalledWith('pack', { expand: undefined });
});
