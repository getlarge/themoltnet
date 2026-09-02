import {
  Button,
  Input,
  Stack,
  Text,
  useTheme,
} from '@themoltnet/design-system';
import { useMemo, useRef, useState } from 'react';

import type { LocalRuntimeController } from './useLocalRuntime.js';

const MODEL_PAGE_SIZE = 50;

const PROVIDER_PRESETS = [
  {
    id: 'ollama-local',
    label: 'Ollama (local)',
    providerId: 'ollama-local',
    baseUrl: 'http://localhost:11434/v1',
    needsKey: false,
  },
  {
    id: 'ollama-cloud',
    label: 'Ollama (cloud)',
    providerId: 'ollama',
    baseUrl: 'https://ollama.com/v1',
    needsKey: true,
  },
  {
    id: 'custom',
    label: 'Custom (OpenAI-compatible)',
    providerId: '',
    baseUrl: '',
    needsKey: true,
  },
] as const;

export function ApiKeyProviderForm({
  runtime,
}: {
  runtime: LocalRuntimeController;
}) {
  const [preset, setPreset] = useState<string>('ollama-local');
  const [id, setId] = useState('ollama-local');
  const [baseUrl, setBaseUrl] = useState('http://localhost:11434/v1');
  const [apiKey, setApiKey] = useState('');
  const [discovered, setDiscovered] = useState<string[]>([]);
  const selectedRef = useRef(new Set<string>());
  const [, setSelectionVersion] = useState(0);
  const [filter, setFilter] = useState('');
  const [visibleLimit, setVisibleLimit] = useState(MODEL_PAGE_SIZE);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const activePreset =
    PROVIDER_PRESETS.find((entry) => entry.id === preset) ??
    PROVIDER_PRESETS[2];

  const resetModels = (models: string[] = []) => {
    setDiscovered(models);
    selectedRef.current = new Set(models.length === 1 ? models : []);
    setSelectionVersion((current) => current + 1);
    setFilter('');
    setVisibleLimit(MODEL_PAGE_SIZE);
  };

  const applyPreset = (presetId: string) => {
    const next =
      PROVIDER_PRESETS.find((entry) => entry.id === presetId) ??
      PROVIDER_PRESETS[2];
    setPreset(next.id);
    setId(next.providerId);
    setBaseUrl(next.baseUrl);
    resetModels();
    setDiscoverError(null);
  };

  const discover = async () => {
    setBusy(true);
    setDiscoverError(null);
    try {
      const providerId = id.trim();
      await runtime.putProvider(providerId, {
        api: 'openai-completions',
        baseUrl: baseUrl.trim(),
        models: runtime.data?.providers[providerId]?.models ?? [],
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      });
      resetModels(await runtime.discoverModels(providerId));
    } catch (error) {
      resetModels();
      setDiscoverError(
        error instanceof Error ? error.message : 'Discovery failed',
      );
    } finally {
      setApiKey('');
      setBusy(false);
    }
  };

  const toggleModel = (model: string) => {
    const selected = selectedRef.current;
    if (selected.has(model)) selected.delete(model);
    else selected.add(model);
    setSelectionVersion((current) => current + 1);
  };

  const save = async () => {
    setBusy(true);
    try {
      const providerId = id.trim();
      await runtime.putProvider(providerId, {
        api: 'openai-completions',
        baseUrl: baseUrl.trim(),
        models: [...selectedRef.current],
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      });
      resetModels();
    } catch {
      // surfaced via runtime.actionError
    } finally {
      setApiKey('');
      setBusy(false);
    }
  };

  return (
    <Stack gap={3}>
      <Text variant="caption" weight="semibold">
        Add an API-key provider
      </Text>
      <Stack direction="row" gap={2} wrap>
        {PROVIDER_PRESETS.map((entry) => (
          <Button
            key={entry.id}
            size="sm"
            variant={preset === entry.id ? 'accent' : 'ghost'}
            onClick={() => applyPreset(entry.id)}
          >
            {entry.label}
          </Button>
        ))}
      </Stack>
      <ProviderFields
        activePresetNeedsKey={activePreset.needsKey}
        apiKey={apiKey}
        baseUrl={baseUrl}
        id={id}
        onApiKeyChange={setApiKey}
        onBaseUrlChange={setBaseUrl}
        onIdChange={setId}
      />
      <Stack direction="row" gap={2} align="center" wrap>
        <Button
          size="sm"
          disabled={busy || !id.trim() || !baseUrl.trim()}
          onClick={() => void discover()}
        >
          {busy ? 'Fetching…' : 'Fetch models'}
        </Button>
        {discoverError ? (
          <Text variant="caption" color="error">
            {discoverError}
          </Text>
        ) : null}
      </Stack>
      {discovered.length > 0 ? (
        <ModelSelection
          discovered={discovered}
          filter={filter}
          onFilterChange={(value) => {
            setFilter(value);
            setVisibleLimit(MODEL_PAGE_SIZE);
          }}
          onShowMore={() =>
            setVisibleLimit((current) => current + MODEL_PAGE_SIZE)
          }
          onToggle={toggleModel}
          selected={selectedRef.current}
          visibleLimit={visibleLimit}
        />
      ) : null}
      <Stack direction="row">
        <Button
          size="sm"
          variant="accent"
          disabled={
            busy ||
            !id.trim() ||
            !baseUrl.trim() ||
            selectedRef.current.size === 0
          }
          onClick={() => void save()}
        >
          Save provider
        </Button>
      </Stack>
    </Stack>
  );
}

function ProviderFields({
  activePresetNeedsKey,
  apiKey,
  baseUrl,
  id,
  onApiKeyChange,
  onBaseUrlChange,
  onIdChange,
}: {
  activePresetNeedsKey: boolean;
  apiKey: string;
  baseUrl: string;
  id: string;
  onApiKeyChange: (value: string) => void;
  onBaseUrlChange: (value: string) => void;
  onIdChange: (value: string) => void;
}) {
  const theme = useTheme();
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: theme.spacing[3],
        alignItems: 'start',
      }}
    >
      <Input
        label="Provider id"
        value={id}
        onChange={(event) => onIdChange(event.target.value)}
      />
      <Input
        label="Base URL"
        value={baseUrl}
        onChange={(event) => onBaseUrlChange(event.target.value)}
      />
      <Input
        label={
          activePresetNeedsKey ? 'API key' : 'API key (not required locally)'
        }
        type="password"
        autoComplete="off"
        spellCheck={false}
        hint="Write-only; leaving it blank on update keeps the stored key."
        value={apiKey}
        onChange={(event) => onApiKeyChange(event.target.value)}
      />
    </div>
  );
}

function ModelSelection({
  discovered,
  filter,
  onFilterChange,
  onShowMore,
  onToggle,
  selected,
  visibleLimit,
}: {
  discovered: string[];
  filter: string;
  onFilterChange: (value: string) => void;
  onShowMore: () => void;
  onToggle: (model: string) => void;
  selected: ReadonlySet<string>;
  visibleLimit: number;
}) {
  const filtered = useMemo(() => {
    const query = filter.trim().toLocaleLowerCase();
    return query
      ? discovered.filter((model) => model.toLocaleLowerCase().includes(query))
      : discovered;
  }, [discovered, filter]);
  const visible = filtered.slice(0, visibleLimit);

  return (
    <Stack gap={2}>
      <Text variant="caption" color="muted">
        Select the models to expose ({selected.size} of {discovered.length}) —
        include the one your runtime profile pins.
      </Text>
      {discovered.length > MODEL_PAGE_SIZE ? (
        <Input
          label="Filter discovered models"
          value={filter}
          onChange={(event) => onFilterChange(event.target.value)}
        />
      ) : null}
      {visible.length > 0 ? (
        <Stack direction="row" gap={2} wrap>
          {visible.map((model) => (
            <label
              key={model}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                cursor: 'pointer',
                minWidth: 0,
              }}
            >
              <input
                type="checkbox"
                checked={selected.has(model)}
                onChange={() => onToggle(model)}
              />
              <Text variant="caption" mono style={{ overflowWrap: 'anywhere' }}>
                {model}
              </Text>
            </label>
          ))}
        </Stack>
      ) : (
        <Text variant="caption" color="muted">
          No models match this filter.
        </Text>
      )}
      {visible.length < filtered.length ? (
        <Stack direction="row">
          <Button size="sm" variant="ghost" onClick={onShowMore}>
            Show {Math.min(MODEL_PAGE_SIZE, filtered.length - visible.length)}
            {' more'}
          </Button>
        </Stack>
      ) : null}
    </Stack>
  );
}
