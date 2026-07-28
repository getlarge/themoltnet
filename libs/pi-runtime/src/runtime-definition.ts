import type { VM } from '@earendil-works/gondolin';
import { VmCheckpoint } from '@earendil-works/gondolin';
import type {
  ExtensionAPI,
  ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import { computeJsonCid } from '@moltnet/crypto-service';
import { RUNTIME_PROFILE_RUNTIME_KIND_REGEXP } from '@moltnet/tasks';
import type { ClaimedTask, TaskReporter } from '@themoltnet/agent-runtime';
import type { Agent } from '@themoltnet/sdk';

import {
  ensureSnapshot,
  type ResumeCommand,
  type SnapshotConfig,
} from './snapshot.js';
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
  readonly tools: readonly PiToolContribution[];
  readonly extensions: readonly PiExtensionContribution[];
}

export interface DefinePiRuntimeOptions {
  id: string;
  version: string;
  runtimeKind?: string;
  vm: GondolinTemplateDefinition;
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

  return Object.freeze({
    schemaVersion: PI_RUNTIME_DEFINITION_VERSION,
    id: options.id,
    version: options.version,
    runtimeKind: options.runtimeKind ?? 'gondolin_pi',
    vm: options.vm,
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
    tools,
    extensions: input.runtime.extensions.map((extension) => ({
      id: extension.id,
      declaredTools: extension.declaredTools,
      scope: extension.scope,
    })),
    executables: input.template.executables,
  };
}

export async function materializePiTools(input: {
  runtime: PiRuntimeDefinition;
  context: PiToolContext;
  target: 'parent' | 'subagent';
  policy?: { enforcement: ToolEnforcement; allowedTools: ReadonlySet<string> };
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
  policy?: { enforcement: ToolEnforcement; allowedTools: ReadonlySet<string> };
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
  policy?: { enforcement: ToolEnforcement; allowedTools: ReadonlySet<string> },
): ToolDefinition[] {
  return tools.filter(
    (tool) => isKernelTool(tool.name) || isToolVisible(tool.name, policy),
  );
}

export function enabledPiToolNames(input: {
  tools: readonly ToolDefinition[];
  extensions?: readonly PiExtensionContribution[];
  policy?: { enforcement: ToolEnforcement; allowedTools: ReadonlySet<string> };
}): string[] | undefined {
  if (!input.policy || input.policy.enforcement !== 'enforce') return undefined;
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
  policy?: { enforcement: ToolEnforcement; allowedTools: ReadonlySet<string> },
): boolean {
  if (!policy || policy.enforcement !== 'enforce') return true;
  // Bash remains model-visible so ShellCommandAnalyzer can enforce the
  // executable-level policy at the command boundary. Hiding it here would
  // bypass that finer-grained gate rather than strengthening enforcement.
  if (name === 'bash') return true;
  return policy.allowedTools.has(name);
}

export function isKernelTool(name: string): boolean {
  return name.startsWith('submit_');
}

function wrapExtensionFactory(
  factory: PiExtensionFactory,
  contribution: PiExtensionContribution,
  policy:
    | { enforcement: ToolEnforcement; allowedTools: ReadonlySet<string> }
    | undefined,
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
  if (isKernelTool(name) || name === 'subagent') {
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
