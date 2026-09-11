import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';

import {
  createNodeSecretProviderRegistry,
  FileSecretProvider,
} from '@themoltnet/sdk/node';

import { loadAgentServerEnvConfig } from '../config.js';
import {
  AgentServerStore,
  resolveAgentServerRoot,
} from '../lib/agent-server/store.js';
import { isHelpFlag, PROVIDERS_HELP } from '../lib/help.js';
import {
  OAuthProviderError,
  OAuthProviderService,
} from '../lib/oauth-provider.js';
import {
  ProviderConfigurationError,
  ProviderConfigurationService,
} from '../lib/provider-configuration.js';
import { ProviderLockError } from '../lib/provider-lock.js';

type SpawnProcess = typeof spawn;

interface ProviderCliDependencies {
  configuration?: ProviderConfigurationService;
  oauth?: OAuthProviderService;
  stdout?: (value: string) => void;
  stderr?: (value: string) => void;
  readStdin?: () => Promise<string>;
  question?: (prompt: string, signal?: AbortSignal) => Promise<string>;
  openUrl?: (url: string) => Promise<void> | void;
  interactive?: boolean;
  stdinIsTTY?: boolean;
  stdoutIsTTY?: boolean;
  signal?: AbortSignal;
  envRoot?: string;
}

interface ProviderCliContext {
  configuration: ProviderConfigurationService;
  oauth: OAuthProviderService;
  stdout(value: string): void;
  stderr(value: string): void;
  readStdin(): Promise<string>;
  question(prompt: string): Promise<string>;
  openUrl(url: string): Promise<void>;
  interactive: boolean;
  stdinIsTTY: boolean;
  signal: AbortSignal;
  close(): void;
}

export async function runProviders(
  argv: string[],
  dependencies: ProviderCliDependencies = {},
): Promise<number> {
  if (isHelpFlag(argv) || argv.length === 0) {
    (dependencies.stdout ?? console.log)(PROVIDERS_HELP);
    return argv.length === 0 ? 1 : 0;
  }

  let context: ProviderCliContext | undefined;
  try {
    const [command, ...args] = argv;
    const parsed = parseProviderArgsSafely(command, args);
    context = await createContext(
      parsed.root,
      dependencies,
      parsed.command !== 'list',
    );
    switch (parsed.command) {
      case 'list':
        return listProviders(context, parsed.json);
      case 'set':
        return await setProvider(context, parsed);
      case 'discover':
        return await discoverProvider(context, parsed);
      case 'remove':
        return await removeProvider(context, parsed);
      case 'login':
        return await loginProvider(context, parsed);
      case 'logout':
        return await logoutProvider(context, parsed);
      default:
        throw new ProviderCliError(
          'invalid_arguments',
          `Unknown providers command "${String(command)}"`,
        );
    }
  } catch (error) {
    (context?.stderr ?? dependencies.stderr ?? console.error)(
      publicCliError(error, context?.signal),
    );
    return 1;
  } finally {
    context?.close();
  }
}

class ProviderCliError extends Error {
  override name = 'ProviderCliError';

  constructor(
    readonly code:
      | 'invalid_arguments'
      | 'invalid_input'
      | 'non_interactive'
      | 'unsupported_auth_method',
    message: string,
  ) {
    super(message);
  }
}

function parseProviderArgsSafely(
  command: string | undefined,
  args: string[],
): ReturnType<typeof parseProviderArgs> {
  try {
    return parseProviderArgs(command, args);
  } catch (error) {
    if (error instanceof ProviderCliError) throw error;
    if (error instanceof Error && error.name === 'ParseArgsError') {
      throw new ProviderCliError('invalid_arguments', error.message);
    }
    throw error;
  }
}

function parseProviderArgs(command: string | undefined, args: string[]) {
  const common = { root: { type: 'string' as const } };
  switch (command) {
    case 'list': {
      const { values, positionals } = parseArgs({
        args,
        options: { ...common, json: { type: 'boolean' } },
        allowPositionals: true,
        strict: true,
      });
      requirePositionals(positionals, 0, 'providers list');
      return { command, root: values.root, json: values.json ?? false };
    }
    case 'set': {
      const { values, positionals } = parseArgs({
        args,
        options: {
          ...common,
          'base-url': { type: 'string' },
          api: { type: 'string' },
          model: { type: 'string', multiple: true },
          'clear-models': { type: 'boolean' },
          'api-key-stdin': { type: 'boolean' },
          'clear-api-key': { type: 'boolean' },
        },
        allowPositionals: true,
        strict: true,
      });
      requirePositionals(positionals, 1, 'providers set <id>');
      if (values.model && values['clear-models']) {
        throw new ProviderCliError(
          'invalid_arguments',
          '--model and --clear-models cannot be used together',
        );
      }
      if (values['api-key-stdin'] && values['clear-api-key']) {
        throw new ProviderCliError(
          'invalid_arguments',
          '--api-key-stdin and --clear-api-key cannot be used together',
        );
      }
      return {
        command,
        root: values.root,
        providerId: positionals[0],
        baseUrl: values['base-url'],
        api: values.api,
        models: values['clear-models'] ? [] : values.model,
        apiKeyStdin: values['api-key-stdin'] ?? false,
        clearApiKey: values['clear-api-key'] ?? false,
      };
    }
    case 'discover': {
      const { values, positionals } = parseArgs({
        args,
        options: {
          ...common,
          save: { type: 'boolean' },
          json: { type: 'boolean' },
        },
        allowPositionals: true,
        strict: true,
      });
      requirePositionals(positionals, 1, 'providers discover <id>');
      return {
        command,
        root: values.root,
        providerId: positionals[0],
        save: values.save ?? false,
        json: values.json ?? false,
      };
    }
    case 'remove':
    case 'logout': {
      const { values, positionals } = parseArgs({
        args,
        options: { ...common, yes: { type: 'boolean' } },
        allowPositionals: true,
        strict: true,
      });
      requirePositionals(positionals, 1, `providers ${command} <id>`);
      return {
        command,
        root: values.root,
        providerId: positionals[0],
        yes: values.yes ?? false,
      };
    }
    case 'login': {
      const { values, positionals } = parseArgs({
        args,
        options: {
          ...common,
          'auth-method': { type: 'string' },
        },
        allowPositionals: true,
        strict: true,
      });
      requirePositionals(positionals, 1, 'providers login <id>');
      return {
        command,
        root: values.root,
        providerId: positionals[0],
        authMethod: values['auth-method'],
      };
    }
    default:
      throw new ProviderCliError(
        'invalid_arguments',
        `Unknown providers command "${String(command)}"`,
      );
  }
}

async function createContext(
  rootFlag: string | undefined,
  dependencies: ProviderCliDependencies,
  installInterruptHandler: boolean,
): Promise<ProviderCliContext> {
  const root = resolveAgentServerRoot({
    root: rootFlag ?? dependencies.envRoot ?? loadAgentServerEnvConfig().root,
  });
  const store = new AgentServerStore(root).ensure();
  const secrets = new FileSecretProvider({
    root: store.secretsDir,
    writable: true,
  });
  const secretProviders = createNodeSecretProviderRegistry().register(secrets);
  const stderr = dependencies.stderr ?? console.error;
  const logger = createCliLogger(stderr);
  const configuration =
    dependencies.configuration ??
    new ProviderConfigurationService({
      store,
      secrets,
      secretProviders,
      logger,
    });
  const oauth =
    dependencies.oauth ??
    (await OAuthProviderService.create({
      authPath: store.piAuthJsonPath,
      logger,
    }));
  const controller = new AbortController();
  const onInterrupt = () => controller.abort(new Error('Interrupted'));
  if (installInterruptHandler) process.once('SIGINT', onInterrupt);
  const signal = dependencies.signal
    ? AbortSignal.any([dependencies.signal, controller.signal])
    : controller.signal;
  const question = dependencies.question ?? defaultQuestion;
  const stdinIsTTY =
    dependencies.stdinIsTTY ??
    dependencies.interactive ??
    Boolean(process.stdin.isTTY);
  const stdoutIsTTY =
    dependencies.stdoutIsTTY ??
    dependencies.interactive ??
    Boolean(process.stdout.isTTY);
  return {
    configuration,
    oauth,
    stdout: dependencies.stdout ?? console.log,
    stderr,
    readStdin: () =>
      raceWithSignal(
        dependencies.readStdin?.() ?? defaultReadStdin(signal),
        signal,
      ),
    question: (prompt) => question(prompt, signal),
    openUrl: async (url) => {
      if (dependencies.openUrl) await dependencies.openUrl(url);
      else await defaultOpenUrl(url);
    },
    interactive: dependencies.interactive ?? (stdinIsTTY && stdoutIsTTY),
    stdinIsTTY,
    signal,
    close: () => {
      if (installInterruptHandler) {
        process.removeListener('SIGINT', onInterrupt);
      }
    },
  };
}

function listProviders(context: ProviderCliContext, json: boolean): number {
  const configuredProviders = context.configuration.list();
  const oauthProviders = context.oauth.list();
  if (json) {
    context.stdout(JSON.stringify({ configuredProviders, oauthProviders }));
    return 0;
  }
  const configured = Object.entries(configuredProviders);
  context.stdout('Configured providers:');
  if (configured.length === 0) context.stdout('  (none)');
  for (const [id, provider] of configured) {
    context.stdout(
      `  ${id}  ${provider.baseUrl}  ${provider.models.length} model(s)${provider.hasApiKey ? '  API key configured' : ''}`,
    );
  }
  context.stdout('OAuth providers:');
  if (oauthProviders.length === 0) context.stdout('  (none)');
  for (const provider of oauthProviders) {
    context.stdout(
      `  ${provider.id}  ${provider.name}  ${provider.connected ? 'connected' : 'not connected'}`,
    );
  }
  return 0;
}

async function setProvider(
  context: ProviderCliContext,
  parsed: {
    providerId: string;
    apiKeyStdin: boolean;
    clearApiKey: boolean;
    baseUrl?: string;
    api?: string;
    models?: string[];
  },
): Promise<number> {
  let apiKey: string | undefined;
  if (parsed.apiKeyStdin) {
    if (context.stdinIsTTY) {
      throw new ProviderCliError(
        'invalid_input',
        '--api-key-stdin requires redirected stdin; pipe the API key into this command',
      );
    }
    apiKey = (await context.readStdin()).replace(/[\r\n]+$/u, '');
    if (!apiKey) {
      throw new ProviderCliError(
        'invalid_input',
        'No API key was received on stdin',
      );
    }
  }
  const provider = await context.configuration.set(
    parsed.providerId,
    {
      ...(parsed.baseUrl ? { baseUrl: parsed.baseUrl } : {}),
      ...(parsed.api ? { api: parsed.api } : {}),
      ...(parsed.models ? { models: parsed.models } : {}),
      ...(apiKey ? { apiKey } : {}),
      ...(parsed.clearApiKey ? { clearApiKey: true } : {}),
    },
    { signal: context.signal },
  );
  context.stdout(JSON.stringify({ id: parsed.providerId, ...provider }));
  return 0;
}

async function discoverProvider(
  context: ProviderCliContext,
  parsed: {
    providerId: string;
    save: boolean;
    json: boolean;
  },
): Promise<number> {
  const result = await context.configuration.discover(parsed.providerId, {
    save: parsed.save,
    signal: context.signal,
  });
  if (parsed.json) context.stdout(JSON.stringify(result));
  else for (const model of result.models) context.stdout(model);
  return 0;
}

async function removeProvider(
  context: ProviderCliContext,
  parsed: { providerId: string; yes: boolean },
): Promise<number> {
  if (
    !(await confirmDestructive(
      context,
      parsed.yes,
      `Remove configured provider "${parsed.providerId}"? [y/N] `,
    ))
  ) {
    context.stderr('Provider removal cancelled.');
    return 1;
  }
  await context.configuration.remove(parsed.providerId, {
    signal: context.signal,
  });
  context.stdout(`Removed configured provider "${parsed.providerId}".`);
  return 0;
}

async function loginProvider(
  context: ProviderCliContext,
  parsed: { providerId: string; authMethod?: string },
): Promise<number> {
  if (!context.interactive) {
    throw new ProviderCliError(
      'non_interactive',
      'Provider login requires an interactive terminal',
    );
  }
  await context.oauth.login(
    parsed.providerId,
    {
      signal: context.signal,
      notify: (event) => {
        switch (event.type) {
          case 'auth_url':
            context.stderr(event.instructions ?? 'Authorize in your browser:');
            context.stderr(event.url);
            void context.openUrl(event.url).catch(() => {
              context.stderr(
                'Could not open the browser automatically; open the authorization URL above manually.',
              );
            });
            break;
          case 'device_code':
            context.stderr(`Open ${event.verificationUri}`);
            context.stderr(`Enter code: ${event.userCode}`);
            break;
          case 'info':
          case 'progress':
            context.stderr(event.message);
            break;
        }
      },
      prompt: async (prompt) => {
        if (prompt.type === 'select') {
          if (parsed.authMethod) {
            if (
              !prompt.options.some((option) => option.id === parsed.authMethod)
            ) {
              throw new ProviderCliError(
                'unsupported_auth_method',
                `OAuth auth method "${parsed.authMethod}" is not available`,
              );
            }
            return parsed.authMethod;
          }
          context.stderr(prompt.message);
          for (const option of prompt.options) {
            context.stderr(`  ${option.id}: ${option.label}`);
          }
        }
        return context.question(`${prompt.message} `);
      },
    },
    { signal: context.signal },
  );
  context.stdout(`Connected OAuth provider "${parsed.providerId}".`);
  return 0;
}

async function logoutProvider(
  context: ProviderCliContext,
  parsed: { providerId: string; yes: boolean },
): Promise<number> {
  if (
    !(await confirmDestructive(
      context,
      parsed.yes,
      `Log out OAuth provider "${parsed.providerId}"? [y/N] `,
    ))
  ) {
    context.stderr('Provider logout cancelled.');
    return 1;
  }
  await context.oauth.logout(parsed.providerId, context.signal);
  context.stdout(`Logged out OAuth provider "${parsed.providerId}".`);
  return 0;
}

async function confirmDestructive(
  context: ProviderCliContext,
  yes: boolean,
  message: string,
): Promise<boolean> {
  if (yes) return true;
  if (!context.interactive) {
    throw new ProviderCliError(
      'non_interactive',
      '--yes is required outside an interactive terminal',
    );
  }
  return /^y(es)?$/iu.test((await context.question(message)).trim());
}

function requirePositionals(
  positionals: string[],
  expected: number,
  usage: string,
): void {
  if (positionals.length !== expected) {
    throw new ProviderCliError('invalid_arguments', `Usage: ${usage}`);
  }
}

function publicCliError(error: unknown, signal?: AbortSignal): string {
  if (signal?.aborted) return 'Provider operation interrupted.';
  if (
    error instanceof ProviderCliError ||
    error instanceof ProviderConfigurationError ||
    error instanceof OAuthProviderError ||
    error instanceof ProviderLockError
  ) {
    return error.message;
  }
  return 'Provider operation failed.';
}

async function defaultReadStdin(signal: AbortSignal): Promise<string> {
  let value = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) {
    if (signal.aborted) throw new Error('Interrupted');
    value += chunk;
  }
  return value;
}

function raceWithSignal<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error('Interrupted'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error('Interrupted'));
    signal.addEventListener('abort', onAbort, { once: true });
    void work.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', onAbort);
    });
  });
}

async function defaultQuestion(
  prompt: string,
  signal?: AbortSignal,
): Promise<string> {
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    return await readline.question(prompt, { signal });
  } finally {
    readline.close();
  }
}

export function browserLaunchCommand(
  platform: NodeJS.Platform,
  url: string,
): { executable: string; args: string[] } {
  if (platform === 'darwin') {
    return { executable: 'open', args: [url] };
  }
  if (platform === 'win32') {
    return { executable: 'explorer.exe', args: [url] };
  }
  return { executable: 'xdg-open', args: [url] };
}

function defaultOpenUrl(
  url: string,
  spawnProcess: SpawnProcess = spawn,
): Promise<void> {
  const { executable, args } = browserLaunchCommand(process.platform, url);
  return new Promise<void>((resolve, reject) => {
    const child = spawnProcess(executable, args, {
      detached: true,
      stdio: 'ignore',
    });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

function createCliLogger(stderr: (value: string) => void) {
  const write = (
    level: 'info' | 'warn',
    context: Record<string, unknown>,
    message: string,
  ) => {
    const safeContext = Object.fromEntries(
      Object.entries(context).filter(
        ([key, value]) =>
          !/(?:credential|message|secret|token|url)/iu.test(key) &&
          ['string', 'number', 'boolean'].includes(typeof value),
      ),
    );
    stderr(JSON.stringify({ level, message, ...safeContext }));
  };
  return {
    info: (context: Record<string, unknown>, message: string) =>
      write('info', context, message),
    warn: (context: Record<string, unknown>, message: string) =>
      write('warn', context, message),
  };
}
