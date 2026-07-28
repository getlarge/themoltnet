import { createRequire } from 'node:module';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { DaemonRuntimeAdapter } from './runtime.js';

export interface RuntimeModuleSelection {
  readonly argv: string[];
  readonly specifier?: string;
}

export function extractRuntimeModule(
  argv: readonly string[],
): RuntimeModuleSelection {
  const remaining: string[] = [];
  let specifier: string | undefined;
  let parsingOptions = true;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') {
      parsingOptions = false;
      remaining.push(argument);
      continue;
    }
    if (!parsingOptions) {
      remaining.push(argument);
      continue;
    }

    let candidate: string | undefined;
    if (argument === '--runtime') {
      candidate = argv[index + 1];
      if (!candidate) {
        throw new Error('Missing value for --runtime');
      }
      index += 1;
    } else if (argument.startsWith('--runtime=')) {
      candidate = argument.slice('--runtime='.length);
      if (!candidate) {
        throw new Error('Missing value for --runtime');
      }
    } else {
      remaining.push(argument);
      continue;
    }

    if (specifier) {
      throw new Error('--runtime may be specified only once');
    }
    specifier = candidate;
  }

  return { argv: remaining, specifier };
}

export function resolveRuntimeModuleUrl(
  specifier: string,
  cwd = process.cwd(),
): string {
  if (specifier.startsWith('file:')) {
    return new URL(specifier).href;
  }
  if (
    isAbsolute(specifier) ||
    specifier.startsWith('./') ||
    specifier.startsWith('../')
  ) {
    return pathToFileURL(resolve(cwd, specifier)).href;
  }

  const requireFromCwd = createRequire(resolve(cwd, 'package.json'));
  return pathToFileURL(requireFromCwd.resolve(specifier)).href;
}

export async function loadDaemonRuntimeAdapter(
  specifier: string,
  options: { cwd?: string } = {},
): Promise<DaemonRuntimeAdapter> {
  let moduleUrl: string;
  try {
    moduleUrl = resolveRuntimeModuleUrl(specifier, options.cwd);
  } catch (cause) {
    throw new Error(
      `Unable to resolve runtime module "${specifier}" from ${
        options.cwd ?? process.cwd()
      }`,
      { cause },
    );
  }

  let namespace: Record<string, unknown>;
  try {
    namespace = (await import(moduleUrl)) as Record<string, unknown>;
  } catch (cause) {
    throw new Error(`Unable to load runtime module "${specifier}"`, { cause });
  }

  const adapter = namespace.default;
  if (!isDaemonRuntimeAdapter(adapter)) {
    throw new Error(
      `Runtime module "${specifier}" must default-export a DaemonRuntimeAdapter`,
    );
  }
  return adapter;
}

function isDaemonRuntimeAdapter(value: unknown): value is DaemonRuntimeAdapter {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<DaemonRuntimeAdapter>;
  return (
    typeof candidate.runtimeKind === 'string' &&
    candidate.runtimeKind.length > 0 &&
    typeof candidate.prepare === 'function'
  );
}
