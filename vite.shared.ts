import { readFileSync } from 'node:fs';
import { isBuiltin } from 'node:module';

interface PackageManifest {
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

/**
 * Preserve every installable dependency declared by a published Node package.
 * Private @moltnet/* packages belong in devDependencies and remain bundle
 * inputs. Any third-party import reached through that private closure must be
 * promoted to the published manifest instead of being bundled accidentally.
 */
export function externalizeInstallableDependencies(
  packageJsonUrl: URL,
): (id: string) => boolean {
  const manifest = JSON.parse(
    readFileSync(packageJsonUrl, 'utf8'),
  ) as PackageManifest;
  const packageNames = Object.keys({
    ...manifest.dependencies,
    ...manifest.optionalDependencies,
    ...manifest.peerDependencies,
  }).filter((name) => !name.startsWith('@moltnet/'));

  return (id: string) => {
    if (isBuiltin(id)) return true;
    if (
      id.startsWith('.') ||
      id.startsWith('/') ||
      id.startsWith('\0') ||
      id.startsWith('@moltnet/')
    ) {
      return false;
    }

    const packageName = id.startsWith('@')
      ? id.split('/', 2).join('/')
      : id.split('/', 1)[0];
    if (packageNames.includes(packageName)) return true;

    throw new Error(
      `Published bundle imports undeclared third-party package "${packageName}" ` +
        `through "${id}". Declare it as a runtime or peer dependency, or move ` +
        'the import behind a private @moltnet/* bundle boundary.',
    );
  };
}

// Vite 8/Rolldown accepts explicit package names in `ssr.external`.
// Keep these lists aligned with the runtime OpenTelemetry packages each app
// expects to resolve from node_modules.
export const otelObservabilityExternals = [
  '@opentelemetry/api',
  '@opentelemetry/exporter-metrics-otlp-proto',
  '@opentelemetry/exporter-trace-otlp-proto',
  '@opentelemetry/instrumentation',
  '@opentelemetry/instrumentation-dns',
  '@opentelemetry/instrumentation-http',
  '@opentelemetry/instrumentation-net',
  '@opentelemetry/instrumentation-pg',
  '@opentelemetry/instrumentation-pino',
  '@opentelemetry/instrumentation-runtime-node',
  '@opentelemetry/instrumentation-undici',
  '@opentelemetry/resources',
  '@opentelemetry/sdk-metrics',
  '@opentelemetry/sdk-trace-base',
  '@opentelemetry/sdk-trace-node',
  '@opentelemetry/semantic-conventions',
];

export const restApiOtelExternals = [
  ...otelObservabilityExternals,
  '@opentelemetry/exporter-logs-otlp-proto',
];
