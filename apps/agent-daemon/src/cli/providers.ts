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
import { PROVIDERS_HELP } from '../lib/help.js';
import {
  OAuthProviderError,
  OAuthProviderService,
} from '../lib/oauth-provider.js';
import {
  ProviderConfigurationError,
  ProviderConfigurationService,
} from '../lib/provider-configuration.js';

interface ProviderCliDependencies {
  configuration?: ProviderConfigurationService;
  oauth?: OAuthProviderService;
  stdout?: (value: string) => void;
  stderr?: (value: string) => void;
  readStdin?: () => Promise<string>;
  question?: (prompt: string) => Promise<string>;
  openUrl?: (url: string) => void;
  interactive?: boolean;
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
  openUrl(url: string): void;
  interactive: boolean;
  signal: AbortSignal;
  close(): void;
}

export async function runProviders(
  argv: string[],
  dependencies: ProviderCliDependencies = {},
): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h') || argv.length === 0) {
    (dependencies.stdout ?? console.log)(PROVIDERS_HELP);
    return argv.length === 0 ? 1 : 0;
  }

  let context: ProviderCliContext | undefined;
  try {
    const [command, ...args] = argv;
    const parsed = parseProviderArgs(command, args);
    context = await createContext(parsed.root, dependencies);
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
        throw new Error(`Unknown providers command "${String(command)}"`);
    }
  } catch (error) {
    (context?.stderr ?? dependencies.stderr ?? console.error)(
      publicCliError(error),
    );
    return 1;
  } finally {
    context?.close();
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
        throw new Error('--model and --clear-models cannot be used together');
      }
      if (values['api-key-stdin'] && values['clear-api-key']) {
        throw new Error(
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
      throw new Error(`Unknown providers command "${String(command)}"`);
  }
}

async function createContext(
  rootFlag: string | undefined,
  dependencies: ProviderCliDependencies,
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
  const controller = new AbortController();
  const onInterrupt = () => controller.abort(new Error('Interrupted'));
  process.once('SIGINT', onInterrupt);
  const signal = dependencies.signal
    ? AbortSignal.any([dependencies.signal, controller.signal])
    : controller.signal;
  const question = dependencies.question ?? defaultQuestion;
  return {
    configuration:
      dependencies.configuration ??
      new ProviderConfigurationService({ store, secrets, secretProviders }),
    oauth:
      dependencies.oauth ??
      (await OAuthProviderService.create({ authPath: store.piAuthJsonPath })),
    stdout: dependencies.stdout ?? console.log,
    stderr: dependencies.stderr ?? console.error,
    readStdin: dependencies.readStdin ?? defaultReadStdin,
    question,
    openUrl: dependencies.openUrl ?? defaultOpenUrl,
    interactive:
      dependencies.interactive ??
      Boolean(process.stdin.isTTY && process.stdout.isTTY),
    signal,
    close: () => process.removeListener('SIGINT', onInterrupt),
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
    if (context.interactive) {
      throw new Error(
        '--api-key-stdin requires redirected stdin; pipe the API key into this command',
      );
    }
    apiKey = (await context.readStdin()).replace(/[\r\n]+$/u, '');
    if (!apiKey) throw new Error('No API key was received on stdin');
  }
  const provider = await context.configuration.set(parsed.providerId, {
    ...(parsed.baseUrl ? { baseUrl: parsed.baseUrl } : {}),
    ...(parsed.api ? { api: parsed.api } : {}),
    ...(parsed.models ? { models: parsed.models } : {}),
    ...(apiKey ? { apiKey } : {}),
    ...(parsed.clearApiKey ? { clearApiKey: true } : {}),
  });
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
  await context.configuration.remove(parsed.providerId);
  context.stdout(`Removed configured provider "${parsed.providerId}".`);
  return 0;
}

async function loginProvider(
  context: ProviderCliContext,
  parsed: { providerId: string; authMethod?: string },
): Promise<number> {
  if (!context.interactive) {
    throw new Error('Provider login requires an interactive terminal');
  }
  await context.oauth.login(parsed.providerId, {
    signal: context.signal,
    notify: (event) => {
      switch (event.type) {
        case 'auth_url':
          context.stderr(event.instructions ?? 'Authorize in your browser:');
          context.stderr(event.url);
          context.openUrl(event.url);
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
            throw new Error(
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
  });
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
  await context.oauth.logout(parsed.providerId);
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
    throw new Error('--yes is required outside an interactive terminal');
  }
  return /^y(es)?$/iu.test((await context.question(message)).trim());
}

function requirePositionals(
  positionals: string[],
  expected: number,
  usage: string,
): void {
  if (positionals.length !== expected) throw new Error(`Usage: ${usage}`);
}

function publicCliError(error: unknown): string {
  if (
    error instanceof ProviderConfigurationError ||
    error instanceof OAuthProviderError ||
    (error instanceof Error && error.name === 'ParseArgsError')
  ) {
    return error.message;
  }
  if (error instanceof Error && error.message === 'Interrupted') {
    return 'Provider operation interrupted.';
  }
  if (
    error instanceof Error &&
    /^(--|Usage:|Unknown providers command|Provider login requires|No API key|OAuth auth method)/u.test(
      error.message,
    )
  ) {
    return error.message;
  }
  return 'Provider operation failed.';
}

async function defaultReadStdin(): Promise<string> {
  let value = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) value += chunk;
  return value;
}

async function defaultQuestion(prompt: string): Promise<string> {
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    return await readline.question(prompt);
  } finally {
    readline.close();
  }
}

function defaultOpenUrl(url: string): void {
  let executable: string;
  let args: string[];
  if (process.platform === 'darwin') {
    executable = 'open';
    args = [url];
  } else if (process.platform === 'win32') {
    executable = 'cmd';
    args = ['/c', 'start', '', url];
  } else {
    executable = 'xdg-open';
    args = [url];
  }
  const child = spawn(executable, args, {
    detached: true,
    stdio: 'ignore',
  });
  child.on('error', () => undefined);
  child.unref();
}
