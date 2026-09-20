import { ProviderForm } from '@moltnet/task-ui/local-providers';

import type { LocalRuntimeController } from './useLocalRuntime.js';

/** Console and Desktop share the complete write-only provider configuration flow. */
export function ApiKeyProviderForm({
  runtime,
  provider,
  onDone,
}: {
  runtime: LocalRuntimeController;
  provider?: { id: string } | null;
  onDone?: () => void;
}) {
  return (
    <ProviderForm
      key={provider?.id ?? 'new-provider'}
      providers={runtime.data?.providers ?? {}}
      existingId={provider?.id}
      actions={{
        putProvider: runtime.putProvider,
        discoverModels: runtime.discoverModels,
        deleteProvider: runtime.deleteProvider,
      }}
      onChanged={() => undefined}
      onDone={() => onDone?.()}
    />
  );
}
