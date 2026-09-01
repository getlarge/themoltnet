/**
 * Local runtime page (#2062 Part C): manage `moltnet-agent serve` daemons on
 * this machine — pair, configure agents/providers (secret write-only), and
 * start/stop/observe runs. Works only in a browser on the machine running
 * `serve` (loopback), by design.
 */
import { listRuntimeProfilesOptions } from '@moltnet/api-client/query';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button, Input, Stack, Text } from '@themoltnet/design-system';
import { useEffect, useRef, useState } from 'react';

import { getApiClient } from '../api.js';
import type {
  ServeRunView,
  StartRunBody,
} from '../runtime-local/serve-client.js';
import {
  type LocalRuntimeController,
  useLocalRuntime,
} from '../runtime-local/useLocalRuntime.js';
import { useTeam } from '../team/useTeam.js';

export function LocalRuntimePage() {
  const runtime = useLocalRuntime();

  return (
    <Stack gap={6}>
      <CompanionBanner runtime={runtime} />
      {runtime.actionError ? (
        <Text variant="caption" color="error">
          {runtime.actionError}
        </Text>
      ) : null}
      {runtime.status === 'connected' && runtime.data ? (
        <Stack gap={6}>
          <AgentsSection runtime={runtime} />
          <ProvidersSection runtime={runtime} />
          <RunsSection runtime={runtime} />
        </Stack>
      ) : null}
    </Stack>
  );
}

function CompanionBanner({ runtime }: { runtime: LocalRuntimeController }) {
  if (runtime.status === 'connected') {
    return (
      <Stack direction="row" gap={3} align="center">
        <Badge variant="success">connected</Badge>
        <Text variant="caption" color="muted">
          Supervisor {runtime.data?.version ?? ''} at {runtime.serveUrl}
        </Text>
        <Button variant="ghost" size="sm" onClick={() => runtime.disconnect()}>
          Forget pairing
        </Button>
      </Stack>
    );
  }
  if (runtime.status === 'unavailable') {
    return (
      <Stack gap={3}>
        <Stack direction="row" gap={3} align="center">
          <Badge variant="error">not running</Badge>
          <Text variant="caption">
            No serve supervisor at {runtime.serveUrl}. Start it on this machine:
          </Text>
        </Stack>
        <Text variant="caption" mono>
          npx @themoltnet/agent-daemon serve
        </Text>
        <Stack direction="row" gap={2}>
          <Button size="sm" onClick={() => void runtime.retry()}>
            Retry
          </Button>
        </Stack>
      </Stack>
    );
  }
  if (runtime.status === 'unpaired' || runtime.status === 'pairing') {
    return (
      <Stack direction="row" gap={3} align="center">
        <Badge variant="warning">
          {runtime.status === 'pairing' ? 'awaiting approval' : 'not paired'}
        </Badge>
        <Text variant="caption">
          {runtime.status === 'pairing'
            ? 'Approve the connection in the tab that just opened.'
            : 'Pair this console with the local supervisor.'}
        </Text>
        <Button
          size="sm"
          variant="accent"
          disabled={runtime.status === 'pairing'}
          onClick={() => void runtime.pair()}
        >
          {runtime.status === 'pairing' ? 'Waiting…' : 'Connect'}
        </Button>
      </Stack>
    );
  }
  return (
    <Text variant="caption" color="muted">
      Looking for a local supervisor at {runtime.serveUrl}…
    </Text>
  );
}

function AgentsSection({ runtime }: { runtime: LocalRuntimeController }) {
  const [name, setName] = useState('');
  const [enrollmentToken, setEnrollmentToken] = useState('');
  const [configDir, setConfigDir] = useState('');
  const [busy, setBusy] = useState(false);
  const agents = runtime.data?.agents ?? [];

  const submit = async (kind: 'managed' | 'external') => {
    setBusy(true);
    try {
      await runtime.createAgent({
        kind,
        name: name.trim(),
        ...(kind === 'managed' && enrollmentToken.trim()
          ? { enrollmentToken: enrollmentToken.trim() }
          : {}),
        ...(kind === 'external' ? { configDir: configDir.trim() } : {}),
      });
      setName('');
      setEnrollmentToken('');
      setConfigDir('');
    } catch {
      // surfaced via runtime.actionError
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack gap={3}>
      <Text variant="h4" as="h2">
        Agents
      </Text>
      {agents.length === 0 ? (
        <Text variant="caption" color="muted">
          No agents yet. Create a fresh identity (the key never leaves this
          machine) or attach an existing .moltnet config by path.
        </Text>
      ) : (
        <Stack gap={2}>
          {agents.map((agent) => (
            <Stack key={agent.agentName} direction="row" gap={3} align="center">
              <Badge variant={agent.kind === 'managed' ? 'info' : 'default'}>
                {agent.kind}
              </Badge>
              <Text variant="caption" weight="medium">
                {agent.agentName}
              </Text>
              <Text variant="caption" color="muted" mono>
                {agent.fingerprint ?? agent.configDir ?? ''}
              </Text>
            </Stack>
          ))}
        </Stack>
      )}
      <Stack direction="row" gap={2} align="flex-end" wrap>
        <Input
          label="Agent name"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <Input
          label="Enrollment token (optional)"
          hint="Joins the issuing team instead of self-registering."
          value={enrollmentToken}
          onChange={(event) => setEnrollmentToken(event.target.value)}
        />
        <Button
          size="sm"
          variant="accent"
          disabled={busy || !name.trim()}
          onClick={() => void submit('managed')}
        >
          Create identity
        </Button>
      </Stack>
      <Stack direction="row" gap={2} align="flex-end" wrap>
        <Input
          label="Existing .moltnet/<agent> path"
          hint="Attached by path and verified against the API; secrets are never copied."
          value={configDir}
          onChange={(event) => setConfigDir(event.target.value)}
        />
        <Button
          size="sm"
          disabled={busy || !name.trim() || !configDir.trim()}
          onClick={() => void submit('external')}
        >
          Attach existing
        </Button>
      </Stack>
    </Stack>
  );
}

function ProvidersSection({ runtime }: { runtime: LocalRuntimeController }) {
  const [id, setId] = useState('ollama');
  const [baseUrl, setBaseUrl] = useState('https://ollama.com/v1');
  const [envName, setEnvName] = useState('OLLAMA_API_KEY');
  const [models, setModels] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const providers = Object.entries(runtime.data?.providers ?? {});

  const submit = async () => {
    setBusy(true);
    try {
      await runtime.putProvider(id.trim(), {
        api: 'openai-completions',
        baseUrl: baseUrl.trim(),
        envName: envName.trim(),
        models: models
          .split(',')
          .map((model) => model.trim())
          .filter(Boolean),
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      });
      setApiKey('');
    } catch {
      // surfaced via runtime.actionError
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack gap={3}>
      <Text variant="h4" as="h2">
        LLM providers
      </Text>
      {providers.length > 0 ? (
        <Stack gap={2}>
          {providers.map(([providerId, provider]) => (
            <Stack key={providerId} direction="row" gap={3} align="center">
              <Text variant="caption" weight="medium">
                {providerId}
              </Text>
              <Text variant="caption" color="muted">
                {provider.baseUrl} · {provider.models.length} model
                {provider.models.length === 1 ? '' : 's'}
              </Text>
              <Badge variant={provider.hasApiKey ? 'success' : 'warning'}>
                {provider.hasApiKey ? 'key stored' : 'no key'}
              </Badge>
            </Stack>
          ))}
        </Stack>
      ) : (
        <Text variant="caption" color="muted">
          No providers yet. The key is stored on this machine only; the
          generated Pi config references it by env var, never by value.
        </Text>
      )}
      <Stack direction="row" gap={2} align="flex-end" wrap>
        <Input
          label="Provider id"
          value={id}
          onChange={(event) => setId(event.target.value)}
        />
        <Input
          label="Base URL"
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
        />
        <Input
          label="Key env var"
          value={envName}
          onChange={(event) => setEnvName(event.target.value)}
        />
        <Input
          label="Models (comma-separated)"
          hint="Must include the model your runtime profile pins."
          value={models}
          onChange={(event) => setModels(event.target.value)}
        />
        <Input
          label="API key"
          type="password"
          hint="Write-only; leaving it blank on update keeps the stored key."
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
        />
        <Button
          size="sm"
          variant="accent"
          disabled={busy || !id.trim() || !baseUrl.trim() || !envName.trim()}
          onClick={() => void submit()}
        >
          Save provider
        </Button>
      </Stack>
    </Stack>
  );
}

function RunsSection({ runtime }: { runtime: LocalRuntimeController }) {
  const { selectedTeam } = useTeam();
  const [agent, setAgent] = useState('');
  const [profile, setProfile] = useState('');
  const [taskTypes, setTaskTypes] = useState('freeform');
  const [mode, setMode] = useState<StartRunBody['mode']>('poll');
  const [busy, setBusy] = useState(false);
  const [logRunId, setLogRunId] = useState<string | null>(null);
  const runs = runtime.data?.runs ?? [];
  const agents = runtime.data?.agents ?? [];

  const profilesQuery = useQuery({
    ...listRuntimeProfilesOptions({
      client: getApiClient(),
      headers: { 'x-moltnet-team-id': selectedTeam?.id ?? '' },
    }),
    enabled: Boolean(selectedTeam?.id),
  });
  const profileNames = (
    (profilesQuery.data?.items ?? []) as { name?: string; id: string }[]
  ).map((entry) => entry.name ?? entry.id);

  const start = async () => {
    if (!selectedTeam?.id) return;
    setBusy(true);
    try {
      await runtime.startRun({
        agent,
        teamId: selectedTeam.id,
        profiles: [profile.trim()],
        taskTypes: taskTypes
          .split(',')
          .map((taskType) => taskType.trim())
          .filter(Boolean),
        mode,
      });
    } catch {
      // surfaced via runtime.actionError
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack gap={3}>
      <Text variant="h4" as="h2">
        Runs
      </Text>
      {!selectedTeam ? (
        <Text variant="caption" color="muted">
          Select a team to start runs.
        </Text>
      ) : null}
      <Stack direction="row" gap={2} align="flex-end" wrap>
        <label>
          <Text variant="caption" color="muted">
            Agent
          </Text>
          <select
            value={agent}
            onChange={(event) => setAgent(event.target.value)}
            style={{ display: 'block', minWidth: 160, padding: 6 }}
          >
            <option value="">Select…</option>
            {agents.map((entry) => (
              <option key={entry.agentName} value={entry.agentName}>
                {entry.agentName}
              </option>
            ))}
          </select>
        </label>
        <Input
          label="Runtime profile"
          hint={
            profileNames.length > 0
              ? `Known: ${profileNames.slice(0, 4).join(', ')}${profileNames.length > 4 ? ', …' : ''}`
              : 'Profile UUID or team-scoped name.'
          }
          value={profile}
          onChange={(event) => setProfile(event.target.value)}
        />
        <Input
          label="Task types"
          value={taskTypes}
          onChange={(event) => setTaskTypes(event.target.value)}
        />
        <label>
          <Text variant="caption" color="muted">
            Mode
          </Text>
          <select
            value={mode}
            onChange={(event) =>
              setMode(event.target.value as StartRunBody['mode'])
            }
            style={{ display: 'block', minWidth: 100, padding: 6 }}
          >
            <option value="poll">poll</option>
            <option value="drain">drain</option>
          </select>
        </label>
        <Button
          size="sm"
          variant="accent"
          disabled={busy || !agent || !profile.trim() || !selectedTeam?.id}
          onClick={() => void start()}
        >
          Start run
        </Button>
      </Stack>
      <Stack gap={2}>
        {runs.map((run) => (
          <RunRow
            key={run.id}
            run={run}
            onStop={() => void runtime.stopRun(run.id)}
            onToggleLogs={() =>
              setLogRunId((current) => (current === run.id ? null : run.id))
            }
            logsOpen={logRunId === run.id}
          />
        ))}
        {runs.length === 0 ? (
          <Text variant="caption" color="muted">
            No runs yet.
          </Text>
        ) : null}
      </Stack>
      {logRunId ? <LogTail runtime={runtime} runId={logRunId} /> : null}
    </Stack>
  );
}

function RunRow({
  run,
  onStop,
  onToggleLogs,
  logsOpen,
}: {
  run: ServeRunView;
  onStop: () => void;
  onToggleLogs: () => void;
  logsOpen: boolean;
}) {
  const tone =
    run.status === 'running'
      ? 'success'
      : run.status === 'failed'
        ? 'error'
        : 'default';
  return (
    <Stack direction="row" gap={3} align="center">
      <Badge variant={tone}>{run.status}</Badge>
      <Text variant="caption" weight="medium">
        {run.agent}
      </Text>
      <Text variant="caption" color="muted">
        {run.mode} · {run.profiles.join(', ')} · {run.taskTypes.join(', ')}
      </Text>
      <Button variant="ghost" size="sm" onClick={onToggleLogs}>
        {logsOpen ? 'Hide logs' : 'Logs'}
      </Button>
      {run.active ? (
        <Button variant="ghost" size="sm" onClick={onStop}>
          Stop
        </Button>
      ) : null}
    </Stack>
  );
}

function LogTail({
  runtime,
  runId,
}: {
  runtime: LocalRuntimeController;
  runId: string;
}) {
  const [lines, setLines] = useState<string[]>([]);
  const preRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    setLines([]);
    const controller = new AbortController();
    void runtime
      .streamLogs(
        runId,
        (line) => {
          setLines((current) => [...current.slice(-500), line]);
        },
        controller.signal,
      )
      .catch(() => undefined);
    return () => controller.abort();
  }, [runtime, runId]);

  useEffect(() => {
    preRef.current?.scrollTo({ top: preRef.current.scrollHeight });
  }, [lines]);

  return (
    <pre
      ref={preRef}
      aria-label={`Logs for run ${runId}`}
      style={{
        maxHeight: 320,
        overflow: 'auto',
        fontSize: 12,
        lineHeight: 1.5,
        padding: 12,
        borderRadius: 8,
        border: '1px solid color-mix(in srgb, currentColor 20%, transparent)',
      }}
    >
      {lines.length > 0 ? lines.join('\n') : 'Waiting for output…'}
    </pre>
  );
}
