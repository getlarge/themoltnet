import {
  Button,
  InlineNotice,
  Input,
  Select,
  Stack,
  Text,
} from '@themoltnet/design-system';
import { useState } from 'react';

import type { AgentServerProvider, ProviderActions } from './types.js';

const PRESETS = [
  {
    id: 'ollama',
    label: 'Ollama (local)',
    baseUrl: 'http://localhost:11434/v1',
  },
  {
    id: 'ollama-cloud',
    label: 'Ollama Cloud',
    baseUrl: 'https://ollama.com/v1',
  },
  { id: 'custom', label: 'Custom (OpenAI-compatible)', baseUrl: '' },
];

/** Discovery uses the server's stored key; full model capabilities survive selection. */
export function ProviderForm({
  providers,
  actions,
  existingId,
  onChanged,
  onDone,
}: {
  providers: Record<string, AgentServerProvider>;
  actions: ProviderActions;
  existingId?: string;
  onChanged: () => void;
  onDone: () => void;
}) {
  const existing = existingId ? providers[existingId] : undefined;
  const [preset, setPreset] = useState(existing ? 'custom' : 'ollama');
  const [id, setId] = useState(existingId ?? 'ollama');
  const [baseUrl, setBaseUrl] = useState(
    existing?.baseUrl ?? PRESETS[0].baseUrl,
  );
  const [apiKey, setApiKey] = useState('');
  const [saved, setSaved] = useState<AgentServerProvider | undefined>(existing);
  const [models, setModels] = useState(existing?.models ?? []);
  const [selected, setSelected] = useState(
    new Set(models.map((model) => model.id)),
  );
  const [filter, setFilter] = useState('');
  const [limit, setLimit] = useState(50);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [discovered, setDiscovered] = useState(false);
  const providerId = id.trim();
  const duplicate = !saved && Object.hasOwn(providers, providerId);
  const valid = /^[a-z0-9][a-z0-9-]{0,63}$/u.test(providerId) && baseUrl.trim();
  const needsKey = preset === 'ollama-cloud' && !saved?.hasApiKey;
  const filtered = models.filter((model) =>
    model.id.toLowerCase().includes(filter.toLowerCase()),
  );

  const discover = async () => {
    setBusy(true);
    setError(null);
    try {
      const provider = await actions.putProvider(providerId, {
        api: existing?.api ?? 'openai-completions',
        baseUrl: baseUrl.trim(),
        envName:
          existing?.envName ??
          `MOLTNET_PROVIDER_${providerId.replaceAll('-', '_').toUpperCase()}_API_KEY`,
        models: saved?.models ?? [],
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      });
      setSaved(provider);
      setApiKey('');
      onChanged();
      const found = await actions.discoverModels(providerId);
      // Keep configured models (including their metadata) even if a provider's
      // discovery endpoint no longer lists them.
      const merged = new Map(found.map((model) => [model.id, model]));
      for (const model of provider.models) merged.set(model.id, model);
      setModels([...merged.values()]);
      setSelected(
        new Set(
          provider.models.length
            ? provider.models.map((model) => model.id)
            : found.length === 1
              ? [found[0].id]
              : [],
        ),
      );
      setDiscovered(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setApiKey('');
      setBusy(false);
    }
  };

  const saveModels = async () => {
    if (!saved) return;
    setBusy(true);
    setError(null);
    try {
      await actions.putProvider(providerId, {
        api: saved.api,
        baseUrl: saved.baseUrl,
        envName: saved.envName,
        models: models.filter((model) => selected.has(model.id)),
      });
      onChanged();
      onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack gap={4}>
      <Text as="h2" variant="bodyLarge" weight="semibold">
        {existingId ? `Models for ${existingId}` : 'Add a provider'}
      </Text>
      {!saved ? (
        <Select
          label="Provider type"
          value={preset}
          disabled={busy}
          onChange={(event) => {
            const next = PRESETS.find(
              (entry) => entry.id === event.target.value,
            );
            if (!next) return;
            setPreset(next.id);
            setId(next.id === 'custom' ? '' : next.id);
            setBaseUrl(next.baseUrl);
            setApiKey('');
            setError(null);
          }}
        >
          {PRESETS.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.label}
            </option>
          ))}
        </Select>
      ) : null}
      <Input
        label="Provider ID"
        value={id}
        disabled={busy || Boolean(saved)}
        hint="Use this ID in your runtime profiles: lowercase letters, digits, and hyphens only."
        error={
          duplicate
            ? 'This provider already exists. Use its Configure models action.'
            : undefined
        }
        onChange={(event) => setId(event.target.value)}
      />
      <Input
        label="Base URL"
        type="url"
        value={baseUrl}
        disabled={busy || Boolean(saved)}
        onChange={(event) => setBaseUrl(event.target.value)}
      />
      {preset !== 'ollama' ? (
        <Input
          label={needsKey ? 'API key' : 'API key (optional)'}
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={apiKey}
          disabled={busy}
          hint={
            saved?.hasApiKey
              ? 'A key is stored. Leave blank to keep it.'
              : 'Stored on this Mac and sent only to this provider.'
          }
          onChange={(event) => setApiKey(event.target.value)}
        />
      ) : (
        <Text variant="caption" color="secondary">
          Ollama must be running on this Mac. Local models do not need an API
          key.
        </Text>
      )}
      {error ? (
        <InlineNotice tone="error" title="Provider setup needs attention">
          {error}
        </InlineNotice>
      ) : null}
      <Stack direction="row" gap={2} wrap>
        <Button
          variant="secondary"
          disabled={!valid || duplicate || (needsKey && !apiKey.trim()) || busy}
          loading={busy}
          loadingLabel="Working"
          onClick={() => void discover()}
        >
          {saved ? 'Discover models' : 'Save and discover models'}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={onDone}>
          {saved ? 'Done' : 'Cancel'}
        </Button>
      </Stack>
      {!saved ? (
        <Text variant="caption" color="muted">
          This saves the connection first, then asks the provider for its
          models.
        </Text>
      ) : null}
      {discovered && models.length === 0 ? (
        <div role="status">
          <Text variant="caption">
            No models found. For local Ollama, pull a model in Ollama, then
            discover again.
          </Text>
        </div>
      ) : null}
      {models.length > 0 ? (
        <Stack gap={3}>
          <Text as="h3" variant="body" weight="semibold">
            Models available to runtime profiles
          </Text>
          <Input
            label="Filter models"
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value);
              setLimit(50);
            }}
          />
          <div role="group" aria-label="Available models">
            <Stack gap={2}>
              {filtered.slice(0, limit).map((model) => (
                <label key={model.id}>
                  <input
                    type="checkbox"
                    checked={selected.has(model.id)}
                    disabled={busy}
                    onChange={() =>
                      setSelected((current) => {
                        const next = new Set(current);
                        if (next.has(model.id)) next.delete(model.id);
                        else next.add(model.id);
                        return next;
                      })
                    }
                  />{' '}
                  {model.id}
                </label>
              ))}
            </Stack>
          </div>
          {filtered.length > limit ? (
            <Button variant="ghost" onClick={() => setLimit(limit + 50)}>
              Show more models
            </Button>
          ) : null}
          <Button
            disabled={busy || selected.size === 0}
            onClick={() => void saveModels()}
          >
            Save selected models ({selected.size})
          </Button>
        </Stack>
      ) : null}
    </Stack>
  );
}
