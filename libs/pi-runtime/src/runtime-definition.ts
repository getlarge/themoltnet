import type { VM } from '@earendil-works/gondolin';
import { VmCheckpoint } from '@earendil-works/gondolin';
import type {
  ExtensionAPI,
  ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import { computeJsonCid } from '@moltnet/crypto-service/json-cid';
import { RUNTIME_PROFILE_RUNTIME_KIND_REGEXP } from '@moltnet/runtime-profiles';
import type { ClaimedTask, TaskReporter } from '@themoltnet/agent-runtime';
import {
  type BrokeredHttpSecretBinding,
  type BrokeredHttpSecretDescriptor,
  canonicalizeBrokeredHttpSecretDescriptor,
  ensureSnapshot,
  type ResumeCommand,
  type SnapshotConfig,
} from '@themoltnet/sandbox-gondolin';
import type { Agent } from '@themoltnet/sdk';

import type { ToolEnforcement } from './tool-policy/gate.js';

export const PI_RUNTIME_DEFINITION_VERSION = 'moltnet:pi-runtime:v1';
export const PI_EXECUTOR_MANIFEST_VERSION =
  'moltnet:executor-manifest:v1' as const;

export type PiToolScope = 'parent' | 'parent_and_subagents';

export interface PiToolContext {
  agent: Agent;
  claimedTask: ClaimedTask;
  reporter: TaskReporter;
  vm: VM;
  cwdPath: string;
  guestWorkspace: string;
}

export type PiToolDescriptor = Pick<
  ToolDefinition,
  'name' | 'label' | 'description' | 'parameters'
>;

export interface PiToolContribution {
  readonly kind: 'tool';
  readonly descriptor: PiToolDescriptor;
  readonly scope: PiToolScope;
  create: (context: PiToolContext) => ToolDefinition | Promise<ToolDefinition>;
}

export interface PiToolFactoryOptions {
  descriptor: PiToolDescriptor;
  scope?: PiToolScope;
  create: (context: PiToolContext) => ToolDefinition | Promise<ToolDefinition>;
}

export interface PiBrokeredHttpSecretResolveContext {
  agentName: string;
  claimedTask: ClaimedTask;
  cwdPath: string;
  /** Cancelled when the attempt stops or the resolver exceeds its deadline. */
  signal: AbortSignal;
}

export const DEFAULT_BROKERED_HTTP_SECRET_RESOLUTION_TIMEOUT_MS = 30_000;
const MAX_BROKERED_HTTP_SECRET_RESOLUTION_TIMEOUT_MS = 2_147_483_647;

export class PiBrokeredHttpSecretResolutionError extends Error {
  constructor(
    public readonly requirementId: string,
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'PiBrokeredHttpSecretResolutionError';
  }
}

function brokeredHttpSecretAbortError(): Error {
  const error = new Error('Brokered HTTP secret resolution aborted');
  error.name = 'AbortError';
  return error;
}

export interface PiBrokeredHttpSecretContribution {
  readonly kind: 'brokered_http_secret';
  readonly descriptor: BrokeredHttpSecretDescriptor;
  readonly resolve: (
    context: PiBrokeredHttpSecretResolveContext,
  ) => string | undefined | Promise<string | undefined>;
}

export interface DefinePiBrokeredHttpSecretOptions extends BrokeredHttpSecretDescriptor {
  resolve: (
    context: PiBrokeredHttpSecretResolveContext,
  ) => string | undefined | Promise<string | undefined>;
}

/**
 * Declare a value-free HTTP credential requirement in trusted runtime code.
 * The resolver runs per attempt on the daemon host; its return value is never
 * added to the runtime definition or executor manifest.
 */
export function definePiBrokeredHttpSecret(
  options: DefinePiBrokeredHttpSecretOptions,
): PiBrokeredHttpSecretContribution {
  const descriptor = canonicalizeBrokeredHttpSecretDescriptor(options);
  return Object.freeze({
    kind: 'brokered_http_secret',
    descriptor,
    resolve: options.resolve,
  });
}

export function definePiTool(
  tool: ToolDefinition,
  options?: { scope?: PiToolScope },
): PiToolContribution;
export function definePiTool(options: PiToolFactoryOptions): PiToolContribution;
export function definePiTool(
  input: ToolDefinition | PiToolFactoryOptions,
  options: { scope?: PiToolScope } = {},
): PiToolContribution {
  if ('descriptor' in input) {
    assertToolName(input.descriptor.name);
    return Object.freeze({
      kind: 'tool',
      descriptor: input.descriptor,
      scope: input.scope ?? 'parent',
      create: input.create,
    });
  }

  assertToolName(input.name);
  const descriptor: PiToolDescriptor = {
    name: input.name,
    label: input.label,
    description: input.description,
    parameters: input.parameters,
  };
  return Object.freeze({
    kind: 'tool',
    descriptor,
    scope: options.scope ?? 'parent',
    create: () => input,
  });
}

export type PiExtensionFactory = (pi: ExtensionAPI) => void;

export interface PiExtensionContribution {
  readonly kind: 'extension';
  readonly id: string;
  readonly declaredTools: readonly string[];
  readonly scope: PiToolScope;
  create: (
    context: PiToolContext,
  ) => PiExtensionFactory | Promise<PiExtensionFactory>;
}

export interface PiExtensionOptions {
  id: string;
  declaredTools?: readonly string[];
  scope?: PiToolScope;
  factory?: PiExtensionFactory;
  create?: (
    context: PiToolContext,
  ) => PiExtensionFactory | Promise<PiExtensionFactory>;
}

export function definePiExtension(
  options: PiExtensionOptions,
): PiExtensionContribution {
  assertStableId(options.id, 'extension id');
  const declaredTools = [...new Set(options.declaredTools ?? [])].sort();
  declaredTools.forEach((name) => assertToolName(name));
  if (Boolean(options.factory) === Boolean(options.create)) {
    throw new Error(
      `Pi extension "${options.id}" must define exactly one of factory or create`,
    );
  }
  const create = options.create;
  const factory = options.factory;
  return Object.freeze({
    kind: 'extension',
    id: options.id,
    declaredTools,
    scope: options.scope ?? 'parent',
    create: create ?? (() => factory as PiExtensionFactory),
  });
}

export interface GondolinTemplateResolveContext {
  onProgress?: (message: string) => void;
}

export interface ResolvedGondolinTemplate {
  id: string;
  version: string;
  checkpointPath: string;
  fingerprint: string;
  guestAssetBuildId: string;
  executables: readonly string[];
  resumeCommands: readonly ResumeCommand[];
}

export interface GondolinTemplateDefinition {
  readonly kind: 'gondolin';
  readonly id: string;
  readonly version: string;
  readonly executables: readonly string[];
  readonly resumeCommands: readonly ResumeCommand[];
  resolve(
    context?: GondolinTemplateResolveContext,
  ): Promise<ResolvedGondolinTemplate>;
}

export interface DefineGondolinTemplateOptions {
  id: string;
  version: string;
  snapshot?: SnapshotConfig;
  checkpointPath?: string;
  resolveCheckpoint?(context: GondolinTemplateResolveContext): Promise<string>;
  fingerprint?: string;
  executables?: readonly string[];
  resumeCommands?: readonly ResumeCommand[];
}

export function defineGondolinTemplate(
  options: DefineGondolinTemplateOptions,
): GondolinTemplateDefinition {
  assertStableId(options.id, 'template id');
  assertStableId(options.version, 'template version');
  const resolverCount = [
    options.snapshot !== undefined,
    options.checkpointPath !== undefined,
    options.resolveCheckpoint !== undefined,
  ].filter(Boolean).length;
  if (resolverCount > 1) {
    throw new Error(
      `Gondolin template "${options.id}" accepts only one checkpoint source`,
    );
  }
  const executables = [...new Set(options.executables ?? [])].sort();
  const resumeCommands = [...(options.resumeCommands ?? [])];

  return Object.freeze({
    kind: 'gondolin',
    id: options.id,
    version: options.version,
    executables,
    resumeCommands,
    async resolve(
      context: GondolinTemplateResolveContext = {},
    ): Promise<ResolvedGondolinTemplate> {
      const checkpointPath = options.resolveCheckpoint
        ? await options.resolveCheckpoint(context)
        : (options.checkpointPath ??
          (await ensureSnapshot({
            config: options.snapshot,
            onProgress: context.onProgress,
          })));
      const checkpoint = VmCheckpoint.load(checkpointPath);
      const fingerprint =
        options.fingerprint ??
        (await computeJsonCid({
          v: 'moltnet:gondolin-template:v1',
          id: options.id,
          version: options.version,
          snapshot: options.snapshot ?? null,
          executables,
          resumeCommands,
          guestAssetBuildId: checkpoint.guestAssetBuildId,
        }));
      return {
        id: options.id,
        version: options.version,
        checkpointPath,
        fingerprint,
        guestAssetBuildId: checkpoint.guestAssetBuildId,
        executables,
        resumeCommands,
      };
    },
  });
}

export interface PiRuntimeDefinition {
  readonly schemaVersion: typeof PI_RUNTIME_DEFINITION_VERSION;
  readonly id: string;
  readonly version: string;
  readonly runtimeKind: string;
  readonly vm: GondolinTemplateDefinition;
  /** Optional v1 extension; absent on independently packaged legacy runtimes. */
  readonly brokeredHttpSecrets?: readonly PiBrokeredHttpSecretContribution[];
  readonly tools: readonly PiToolContribution[];
  readonly extensions: readonly PiExtensionContribution[];
}

export interface DefinePiRuntimeOptions {
  id: string;
  version: string;
  runtimeKind?: string;
  vm: GondolinTemplateDefinition;
  brokeredHttpSecrets?: readonly PiBrokeredHttpSecretContribution[];
  tools?: readonly PiToolContribution[];
  extensions?: readonly PiExtensionContribution[];
}

export function definePiRuntime(
  options: DefinePiRuntimeOptions,
): PiRuntimeDefinition {
  assertStableId(options.id, 'runtime id');
  assertStableId(options.version, 'runtime version');
  assertRuntimeKind(options.runtimeKind ?? 'gondolin_pi');

  const names = new Map<string, string>();
  for (const tool of options.tools ?? []) {
    claimToolName(names, tool.descriptor.name, 'tool contribution');
  }
  for (const extension of options.extensions ?? []) {
    for (const name of extension.declaredTools) {
      claimToolName(names, name, `extension "${extension.id}"`);
    }
  }

  const secretIds = new Set<string>();
  const secretEnvNames = new Set<string>();
  for (const secret of options.brokeredHttpSecrets ?? []) {
    const { id, guestEnv } = secret.descriptor;
    if (secretIds.has(id)) {
      throw new Error(`Duplicate brokered HTTP secret id "${id}"`);
    }
    if (secretEnvNames.has(guestEnv)) {
      throw new Error(`Duplicate brokered HTTP secret guest env "${guestEnv}"`);
    }
    secretIds.add(id);
    secretEnvNames.add(guestEnv);
  }

  return Object.freeze({
    schemaVersion: PI_RUNTIME_DEFINITION_VERSION,
    id: options.id,
    version: options.version,
    runtimeKind: options.runtimeKind ?? 'gondolin_pi',
    vm: options.vm,
    brokeredHttpSecrets: Object.freeze([
      ...(options.brokeredHttpSecrets ?? []),
    ]),
    tools: Object.freeze([...(options.tools ?? [])]),
    extensions: Object.freeze([...(options.extensions ?? [])]),
  });
}

export interface PiExecutorManifest {
  schemaVersion: typeof PI_EXECUTOR_MANIFEST_VERSION;
  runtime: {
    kind: string;
    engine: 'pi';
    sandbox: 'gondolin';
    id: string;
    version: string;
  };
  profile: { id: string; definitionCid: string };
  vm: {
    templateId: string;
    templateVersion: string;
    templateFingerprint: string;
    guestAssetBuildId: string;
  };
  /** Optional v1 extension, emitted only when requirements are declared. */
  brokeredHttpSecrets?: {
    id: string;
    guestEnv: string;
    hosts: readonly string[];
    protocol: 'https' | 'http';
    ports: readonly number[];
    required: boolean;
  }[];
  tools: {
    name: string;
    descriptorCid: string | null;
    scope: PiToolScope;
  }[];
  extensions: {
    id: string;
    declaredTools: readonly string[];
    scope: PiToolScope;
  }[];
  executables: readonly string[];
}

export async function buildPiExecutorManifest(input: {
  runtime: PiRuntimeDefinition;
  profile: { id: string; definitionCid: string };
  template: ResolvedGondolinTemplate;
  builtInTools?: readonly PiToolDescriptor[];
  builtInToolNames?: readonly string[];
}): Promise<PiExecutorManifest> {
  const brokeredHttpSecrets = input.runtime.brokeredHttpSecrets ?? [];
  const descriptors = [
    ...(input.builtInTools ?? []).map((descriptor) => ({
      descriptor,
      scope: 'parent_and_subagents' as const,
    })),
    ...input.runtime.tools,
  ];
  const tools: PiExecutorManifest['tools'] = await Promise.all(
    descriptors.map(async ({ descriptor, scope }) => ({
      name: descriptor.name,
      descriptorCid: await computeJsonCid({
        name: descriptor.name,
        label: descriptor.label,
        description: descriptor.description,
        parameters: descriptor.parameters,
      }),
      scope,
    })),
  );
  for (const name of input.builtInToolNames ?? []) {
    if (tools.some((tool) => tool.name === name)) continue;
    tools.push({
      name,
      descriptorCid: null,
      scope: 'parent_and_subagents',
    });
  }
  tools.sort((a, b) => a.name.localeCompare(b.name));
  return {
    schemaVersion: PI_EXECUTOR_MANIFEST_VERSION,
    runtime: {
      kind: input.runtime.runtimeKind,
      engine: 'pi',
      sandbox: 'gondolin',
      id: input.runtime.id,
      version: input.runtime.version,
    },
    profile: input.profile,
    vm: {
      templateId: input.template.id,
      templateVersion: input.template.version,
      templateFingerprint: input.template.fingerprint,
      guestAssetBuildId: input.template.guestAssetBuildId,
    },
    ...(brokeredHttpSecrets.length > 0 && {
      brokeredHttpSecrets: brokeredHttpSecrets
        .map(({ descriptor }) => ({
          id: descriptor.id,
          guestEnv: descriptor.guestEnv,
          hosts: [...descriptor.hosts],
          protocol: descriptor.protocol ?? 'https',
          ports: [
            ...(descriptor.ports ?? [
              descriptor.protocol === 'http' ? 80 : 443,
            ]),
          ],
          required: descriptor.required !== false,
        }))
        .sort((left, right) => left.id.localeCompare(right.id)),
    }),
    tools,
    extensions: input.runtime.extensions.map((extension) => ({
      id: extension.id,
      declaredTools: extension.declaredTools,
      scope: extension.scope,
    })),
    executables: input.template.executables,
  };
}

export async function materializePiBrokeredHttpSecrets(input: {
  runtime: PiRuntimeDefinition;
  context: Omit<PiBrokeredHttpSecretResolveContext, 'signal'>;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<BrokeredHttpSecretBinding[]> {
  const timeoutMs =
    input.timeoutMs ?? DEFAULT_BROKERED_HTTP_SECRET_RESOLUTION_TIMEOUT_MS;
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > MAX_BROKERED_HTTP_SECRET_RESOLUTION_TIMEOUT_MS
  ) {
    throw new Error(
      `Brokered HTTP secret resolution timeout must be an integer between 1 and ${MAX_BROKERED_HTTP_SECRET_RESOLUTION_TIMEOUT_MS}`,
    );
  }
  if (input.signal?.aborted) throw brokeredHttpSecretAbortError();

  const contributions = input.runtime.brokeredHttpSecrets ?? [];
  const batchController = new AbortController();
  const abortBatchFromAttempt = () =>
    batchController.abort(input.signal?.reason);
  input.signal?.addEventListener('abort', abortBatchFromAttempt, {
    once: true,
  });

  try {
    const outcomes = await Promise.all(
      contributions.map((contribution, index) =>
        materializeSinglePiBrokeredHttpSecret({
          contribution,
          context: input.context,
          batchSignal: batchController.signal,
          timeoutMs,
          index,
        }).then((outcome) => {
          if (outcome.kind === 'failure' && !batchController.signal.aborted) {
            batchController.abort(outcome.error);
          }
          return outcome;
        }),
      ),
    );

    // Attempt cancellation always wins over provider/timeout failures. Among
    // genuine provider failures, permanent failures win over transient ones,
    // then declaration order breaks ties. Batch-aborted siblings are ignored.
    if (input.signal?.aborted) throw brokeredHttpSecretAbortError();
    const failures = outcomes
      .filter(
        (outcome): outcome is BrokeredHttpSecretFailureOutcome =>
          outcome.kind === 'failure',
      )
      .sort(
        (left, right) =>
          Number(left.error.retryable) - Number(right.error.retryable) ||
          left.index - right.index,
      );
    if (failures[0]) throw failures[0].error;

    return outcomes
      .filter(
        (outcome): outcome is BrokeredHttpSecretSuccessOutcome =>
          outcome.kind === 'success',
      )
      .sort((left, right) => left.index - right.index)
      .map(({ binding }) => binding);
  } finally {
    input.signal?.removeEventListener('abort', abortBatchFromAttempt);
  }
}

interface BrokeredHttpSecretSuccessOutcome {
  kind: 'success';
  index: number;
  binding: BrokeredHttpSecretBinding;
}

interface BrokeredHttpSecretFailureOutcome {
  kind: 'failure';
  index: number;
  error: PiBrokeredHttpSecretResolutionError;
}

interface BrokeredHttpSecretBatchAbortOutcome {
  kind: 'batch-abort';
  index: number;
}

type BrokeredHttpSecretResolutionOutcome =
  | BrokeredHttpSecretSuccessOutcome
  | BrokeredHttpSecretFailureOutcome
  | BrokeredHttpSecretBatchAbortOutcome;

/** One auditable resolver lifecycle; the batch coordinator owns precedence. */
async function materializeSinglePiBrokeredHttpSecret(input: {
  contribution: PiBrokeredHttpSecretContribution;
  context: Omit<PiBrokeredHttpSecretResolveContext, 'signal'>;
  batchSignal: AbortSignal;
  timeoutMs: number;
  index: number;
}): Promise<BrokeredHttpSecretResolutionOutcome> {
  const { descriptor, resolve } = input.contribution;
  if (input.batchSignal.aborted) {
    return { kind: 'batch-abort', index: input.index };
  }

  const controller = new AbortController();
  let timedOut = false;
  const abortFromBatch = () => controller.abort(input.batchSignal.reason);
  input.batchSignal.addEventListener('abort', abortFromBatch, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, input.timeoutMs);
  const abortOutcome = new Promise<{ kind: 'abort' }>((resolveAbort) => {
    const resolveFromAbort = () => resolveAbort({ kind: 'abort' });
    if (controller.signal.aborted) resolveFromAbort();
    else
      controller.signal.addEventListener('abort', resolveFromAbort, {
        once: true,
      });
  });

  try {
    let resolverOutcome: Promise<
      | { kind: 'value'; value: string | undefined }
      | { kind: 'error'; error: unknown }
    >;
    try {
      resolverOutcome = Promise.resolve(
        resolve({ ...input.context, signal: controller.signal }),
      ).then(
        (value) => ({ kind: 'value' as const, value }),
        (error: unknown) => ({ kind: 'error' as const, error }),
      );
    } catch (error) {
      resolverOutcome = Promise.resolve({ kind: 'error' as const, error });
    }

    const outcome = await Promise.race([resolverOutcome, abortOutcome]);
    if (outcome.kind === 'abort') {
      if (!timedOut) return { kind: 'batch-abort', index: input.index };
      return {
        kind: 'failure',
        index: input.index,
        error: new PiBrokeredHttpSecretResolutionError(
          descriptor.id,
          `Brokered HTTP secret "${descriptor.id}" resolution timed out`,
          true,
        ),
      };
    }
    if (outcome.kind === 'error') {
      return {
        kind: 'failure',
        index: input.index,
        error:
          outcome.error instanceof PiBrokeredHttpSecretResolutionError
            ? outcome.error
            : new PiBrokeredHttpSecretResolutionError(
                descriptor.id,
                `Brokered HTTP secret "${descriptor.id}" resolution failed`,
                true,
              ),
      };
    }
    if (
      (outcome.value === undefined || outcome.value === '') &&
      descriptor.required !== false
    ) {
      return {
        kind: 'failure',
        index: input.index,
        error: new PiBrokeredHttpSecretResolutionError(
          descriptor.id,
          `Required brokered HTTP secret "${descriptor.id}" is unavailable`,
          false,
        ),
      };
    }
    return {
      kind: 'success',
      index: input.index,
      binding: {
        ...descriptor,
        hosts: [...descriptor.hosts],
        ports: descriptor.ports ? [...descriptor.ports] : undefined,
        value: outcome.value,
      },
    };
  } finally {
    clearTimeout(timeout);
    input.batchSignal.removeEventListener('abort', abortFromBatch);
  }
}

export async function materializePiTools(input: {
  runtime: PiRuntimeDefinition;
  context: PiToolContext;
  target: 'parent' | 'subagent';
  policy?: ModelVisibleToolPolicy;
}): Promise<ToolDefinition[]> {
  const contributions = input.runtime.tools.filter(
    (tool) =>
      input.target === 'parent' || tool.scope === 'parent_and_subagents',
  );
  const tools = await Promise.all(
    contributions.map(async (contribution) => {
      const tool = await contribution.create(input.context);
      if (tool.name !== contribution.descriptor.name) {
        throw new Error(
          `Pi tool factory declared "${contribution.descriptor.name}" but created "${tool.name}"`,
        );
      }
      return tool;
    }),
  );
  return tools.filter((tool) => isToolVisible(tool.name, input.policy));
}

export async function materializePiExtensions(input: {
  runtime: PiRuntimeDefinition;
  context: PiToolContext;
  target: 'parent' | 'subagent';
  policy?: ModelVisibleToolPolicy;
}): Promise<PiExtensionFactory[]> {
  const contributions = input.runtime.extensions.filter(
    (extension) =>
      input.target === 'parent' || extension.scope === 'parent_and_subagents',
  );
  return Promise.all(
    contributions.map(async (contribution) => {
      const factory = await contribution.create(input.context);
      return wrapExtensionFactory(factory, contribution, input.policy);
    }),
  );
}

export function filterModelVisibleTools(
  tools: readonly ToolDefinition[],
  policy?: ModelVisibleToolPolicy,
): ToolDefinition[] {
  return tools.filter(
    (tool) => isKernelTool(tool.name) || isToolVisible(tool.name, policy),
  );
}

export function enabledPiToolNames(input: {
  tools: readonly ToolDefinition[];
  extensions?: readonly PiExtensionContribution[];
  policy?: ModelVisibleToolPolicy;
}): string[] | undefined {
  if (!input.policy || input.policy.enforcement !== 'enforce') return undefined;
  return modelVisiblePiToolNames(input);
}

/** Exact tool names the selected runtime and effective policy expose. */
export function modelVisiblePiToolNames(input: {
  tools: readonly ToolDefinition[];
  extensions?: readonly PiExtensionContribution[];
  policy?: ModelVisibleToolPolicy;
}): string[] {
  return [
    ...new Set([
      ...input.tools.map((tool) => tool.name),
      ...(input.extensions ?? []).flatMap((extension) =>
        extension.declaredTools.filter((name) =>
          isToolVisible(name, input.policy),
        ),
      ),
    ]),
  ].sort();
}

export function isToolVisible(
  name: string,
  policy?: ModelVisibleToolPolicy,
): boolean {
  if (!policy || policy.enforcement !== 'enforce') return true;
  // Bash is useful only when at least one command prefix is authorized. The
  // analyzer still gates every visible bash call, but an empty shell policy
  // should not tempt the model with a tool that can never succeed.
  if (name === 'bash') {
    return (
      policy.allowedShellCommands === undefined ||
      policy.allowedShellCommands.length > 0
    );
  }
  return policy.allowedTools.has(name);
}

export interface ModelVisibleToolPolicy {
  enforcement: ToolEnforcement;
  allowedTools: ReadonlySet<string>;
  allowedShellCommands?: readonly { argvPrefix: readonly string[] }[];
}

export function isKernelTool(name: string): boolean {
  return name.startsWith('submit_') || name === 'subagent';
}

function wrapExtensionFactory(
  factory: PiExtensionFactory,
  contribution: PiExtensionContribution,
  policy: ModelVisibleToolPolicy | undefined,
): PiExtensionFactory {
  return (pi) => {
    const registered = new Set<string>();
    const proxy = new Proxy(pi, {
      get(target, property, receiver) {
        if (property !== 'registerTool') {
          return Reflect.get(target, property, receiver) as unknown;
        }
        return (tool: ToolDefinition) => {
          if (!contribution.declaredTools.includes(tool.name)) {
            throw new Error(
              `Pi extension "${contribution.id}" registered undeclared tool "${tool.name}"`,
            );
          }
          registered.add(tool.name);
          if (isToolVisible(tool.name, policy)) {
            target.registerTool(tool);
          }
        };
      },
    });
    factory(proxy);
    const missing = contribution.declaredTools.filter(
      (name) => !registered.has(name),
    );
    if (missing.length > 0) {
      throw new Error(
        `Pi extension "${contribution.id}" did not register declared tools: ${missing.join(', ')}`,
      );
    }
  };
}

function claimToolName(
  names: Map<string, string>,
  name: string,
  owner: string,
): void {
  if (isKernelTool(name)) {
    throw new Error(`Pi tool name "${name}" is reserved by the runtime kernel`);
  }
  const previous = names.get(name);
  if (previous) {
    throw new Error(
      `Pi tool name "${name}" is declared by ${previous} and ${owner}`,
    );
  }
  names.set(name, owner);
}

function assertToolName(name: string): void {
  if (!/^[a-zA-Z0-9_.:-]{1,128}$/.test(name)) {
    throw new Error(`Invalid Pi tool name "${name}"`);
  }
}

function assertStableId(value: string, label: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,127}$/.test(value)) {
    throw new Error(`Invalid ${label} "${value}"`);
  }
}

function assertRuntimeKind(value: string): void {
  if (!RUNTIME_PROFILE_RUNTIME_KIND_REGEXP.test(value)) {
    throw new Error(`Invalid runtime kind "${value}"`);
  }
}
