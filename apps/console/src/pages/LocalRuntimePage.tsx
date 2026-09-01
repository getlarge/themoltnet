/**
 * Local runtime page (#2062 Part C): manage `moltnet-agent serve` daemons on
 * this machine — pair, configure agents/providers (secret write-only), and
 * start/stop/observe runs. Works only in a browser on the machine running
 * `serve` (loopback), by design.
 */
import { listRuntimeProfilesOptions } from '@moltnet/api-client/query';
import { useQuery } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Card,
  Divider,
  Input,
  Stack,
  Text,
  useTheme,
} from '@themoltnet/design-system';
import { Fragment, useState } from 'react';

import { getApiClient } from '../api.js';
import { runLogPanelId, RunLogTail } from '../runtime-local/RunLogTail.js';
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
    <Stack gap={5}>
      <ConnectionStrip runtime={runtime} />
      {runtime.actionError ? (
        <div role="alert">
          <Text variant="caption" color="error">
            {runtime.actionError}
          </Text>
        </div>
      ) : null}
      {runtime.status === 'connected' && runtime.data ? (
        <Stack gap={5}>
          <AgentsSection runtime={runtime} />
          <ProvidersSection runtime={runtime} />
          <RunsSection runtime={runtime} />
        </Stack>
      ) : null}
    </Stack>
  );
}

// ── connection ─────────────────────────────────────────────────────────────

function ConnectionStrip({ runtime }: { runtime: LocalRuntimeController }) {
  if (runtime.status === 'connected') {
    return (
      <Card padding="sm">
        <Stack direction="row" gap={3} align="center" justify="space-between">
          <Stack direction="row" gap={3} align="center">
            <Badge variant="success">Connected</Badge>
            <Text variant="caption" color="muted">
              Supervisor {runtime.data?.version ?? ''} at{' '}
              <Text as="span" mono>
                {runtime.serveUrl}
              </Text>
            </Text>
          </Stack>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => runtime.disconnect()}
          >
            Forget pairing
          </Button>
        </Stack>
      </Card>
    );
  }
  if (runtime.status === 'unavailable') {
    return (
      <Card padding="lg">
        <Stack gap={4}>
          <Stack direction="row" gap={3} align="center">
            <Badge variant="error">Not running</Badge>
            <Text weight="medium">
              No local supervisor at{' '}
              <Text as="span" mono>
                {runtime.serveUrl}
              </Text>
            </Text>
          </Stack>
          <Stack gap={2}>
            <Text variant="caption" color="muted">
              Start it on this machine, then retry:
            </Text>
            <Text mono variant="caption">
              npx @themoltnet/agent-daemon serve
            </Text>
          </Stack>
          <Stack direction="row">
            <Button size="sm" onClick={() => void runtime.retry()}>
              Retry connection
            </Button>
          </Stack>
          {runtime.connectionError ? (
            <div role="alert">
              <Text variant="caption" color="error">
                {runtime.connectionError}
              </Text>
            </div>
          ) : null}
        </Stack>
      </Card>
    );
  }
  if (runtime.status === 'unpaired' || runtime.status === 'pairing') {
    const pairing = runtime.status === 'pairing';
    return (
      <Card padding="sm">
        <Stack direction="row" gap={3} align="center" justify="space-between">
          <Stack direction="row" gap={3} align="center">
            <Badge variant="warning">
              {pairing ? 'Awaiting approval' : 'Not paired'}
            </Badge>
            <Text variant="caption" color="muted">
              {pairing
                ? 'Approve the connection in the tab that just opened.'
                : 'Pair this console with the supervisor running on this machine.'}
            </Text>
          </Stack>
          <Button
            size="sm"
            variant="accent"
            disabled={pairing}
            onClick={() => void runtime.pair()}
          >
            {pairing ? 'Waiting…' : 'Connect'}
          </Button>
        </Stack>
      </Card>
    );
  }
  return (
    <Card padding="sm">
      <Text variant="caption" color="muted">
        Looking for a local supervisor at {runtime.serveUrl}…
      </Text>
    </Card>
  );
}

// ── shared section chrome ──────────────────────────────────────────────────

function SectionCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card padding="lg">
      <Stack gap={5}>
        <Stack gap={1}>
          <Text variant="h4" as="h2">
            {title}
          </Text>
          <Text variant="caption" color="muted">
            {description}
          </Text>
        </Stack>
        {children}
      </Stack>
    </Card>
  );
}

function FieldGrid({
  children,
  min = 200,
}: {
  children: React.ReactNode;
  min?: number;
}) {
  const theme = useTheme();
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`,
        gap: theme.spacing[3],
        alignItems: 'start',
      }}
    >
      {children}
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
}) {
  const theme = useTheme();
  return (
    <label style={{ display: 'grid', gap: theme.spacing[1], minWidth: 0 }}>
      <Text variant="caption" weight="medium">
        {label}
      </Text>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        style={{
          minHeight: 38,
          padding: `${theme.spacing[2]} ${theme.spacing[3]}`,
          border: `1px solid ${theme.color.border.DEFAULT}`,
          borderRadius: theme.radius.md,
          background: theme.color.bg.surface,
          color: theme.color.text.DEFAULT,
          font: 'inherit',
        }}
      >
        {placeholder ? <option value="">{placeholder}</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function ListRow({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: theme.spacing[3],
        padding: `${theme.spacing[2]} 0`,
        borderTop: `1px solid ${theme.color.border.DEFAULT}`,
        minWidth: 0,
      }}
    >
      {children}
    </div>
  );
}

// ── agents ─────────────────────────────────────────────────────────────────

function AgentsSection({ runtime }: { runtime: LocalRuntimeController }) {
  const [name, setName] = useState('');
  const [enrollmentToken, setEnrollmentToken] = useState('');
  const [configDir, setConfigDir] = useState('');
  const [busy, setBusy] = useState(false);
  const agents = runtime.data?.agents ?? [];

  const submit = async (kind: 'managed' | 'external') => {
    setBusy(true);
    try {
      if (kind === 'managed') {
        await runtime.createAgent({
          kind,
          name: name.trim(),
          ...(enrollmentToken.trim()
            ? { enrollmentToken: enrollmentToken.trim() }
            : {}),
        });
      } else {
        await runtime.createAgent({
          kind,
          name: name.trim(),
          configDir: configDir.trim(),
        });
      }
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
    <SectionCard
      title="Agents"
      description="Identities this machine can run daemons as. Keys are generated and stored locally — they never reach the browser or leave this machine."
    >
      {agents.length > 0 ? (
        <Stack gap={0}>
          {agents.map((agent) => (
            <ListRow key={agent.agentName}>
              <Text weight="medium">{agent.agentName}</Text>
              <Badge variant={agent.kind === 'managed' ? 'info' : 'default'}>
                {agent.kind}
              </Badge>
              <Text
                variant="caption"
                color="muted"
                mono
                style={{
                  marginLeft: 'auto',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {agent.fingerprint ?? agent.configDir ?? ''}
              </Text>
            </ListRow>
          ))}
        </Stack>
      ) : null}

      <Stack gap={3}>
        <Text variant="caption" weight="semibold">
          Create a new identity
        </Text>
        <FieldGrid>
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
        </FieldGrid>
        <Stack direction="row">
          <Button
            size="sm"
            variant="accent"
            disabled={busy || !name.trim()}
            onClick={() => void submit('managed')}
          >
            Create identity
          </Button>
        </Stack>
      </Stack>

      <Divider />

      <Stack gap={3}>
        <Text variant="caption" weight="semibold">
          Or attach an existing agent
        </Text>
        <FieldGrid min={280}>
          <Input
            label=".moltnet/<agent> directory path"
            hint="Attached by path and verified against the API; secrets are never copied."
            value={configDir}
            onChange={(event) => setConfigDir(event.target.value)}
          />
        </FieldGrid>
        <Stack direction="row">
          <Button
            size="sm"
            disabled={busy || !name.trim() || !configDir.trim()}
            onClick={() => void submit('external')}
          >
            Attach existing
          </Button>
        </Stack>
      </Stack>
    </SectionCard>
  );
}

// ── providers ──────────────────────────────────────────────────────────────

function ProvidersSection({ runtime }: { runtime: LocalRuntimeController }) {
  const [id, setId] = useState('ollama');
  const [baseUrl, setBaseUrl] = useState('https://ollama.com/v1');
  const [models, setModels] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const providers = Object.entries(runtime.data?.providers ?? {});
  const subscriptions = runtime.data?.subscriptions ?? [];
  const login = runtime.subscriptionLogin;

  const submit = async () => {
    setBusy(true);
    try {
      await runtime.putProvider(id.trim(), {
        api: 'openai-completions',
        baseUrl: baseUrl.trim(),
        models: models
          .split(',')
          .map((model) => model.trim())
          .filter(Boolean),
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      });
    } catch {
      // surfaced via runtime.actionError
    } finally {
      setApiKey('');
      setBusy(false);
    }
  };

  return (
    <SectionCard
      title="LLM providers"
      description="What the daemons think with. Subscription sign-ins run on this machine; API keys are write-only and referenced by env var, never by value."
    >
      {subscriptions.length > 0 ? (
        <Stack gap={0}>
          {subscriptions.map((subscription) => (
            <ListRow key={subscription.id}>
              <Text weight="medium">{subscription.name}</Text>
              <Badge variant={subscription.connected ? 'success' : 'default'}>
                {subscription.connected ? 'connected' : 'not connected'}
              </Badge>
              <div style={{ marginLeft: 'auto' }}>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={login?.status === 'pending'}
                  onClick={() =>
                    void runtime.connectSubscription(subscription.id)
                  }
                >
                  {subscription.connected ? 'Reconnect' : 'Connect'}
                </Button>
              </div>
            </ListRow>
          ))}
        </Stack>
      ) : null}
      {login?.status === 'pending' ? (
        <Stack direction="row" gap={3} align="center" wrap>
          {login.userCode ? (
            <Text variant="caption">
              Enter code{' '}
              <Text as="span" mono weight="semibold">
                {login.userCode}
              </Text>{' '}
              at{' '}
              <a href={login.verificationUri} target="_blank" rel="noopener">
                {login.verificationUri}
              </a>
            </Text>
          ) : login.authUrl ? (
            <Button
              size="sm"
              variant="accent"
              onClick={() => window.open(login.authUrl, '_blank', 'noopener')}
            >
              Open sign-in page
            </Button>
          ) : (
            <Text variant="caption" color="muted">
              Starting the sign-in flow…
            </Text>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void runtime.cancelSubscription(login.providerId)}
          >
            Cancel
          </Button>
        </Stack>
      ) : null}

      {providers.length > 0 ? (
        <Stack gap={0}>
          {providers.map(([providerId, provider]) => (
            <ListRow key={providerId}>
              <Text weight="medium" mono>
                {providerId}
              </Text>
              <Text
                variant="caption"
                color="muted"
                style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {provider.baseUrl} · {provider.models.length} model
                {provider.models.length === 1 ? '' : 's'}
              </Text>
              <div style={{ marginLeft: 'auto' }}>
                <Badge variant={provider.hasApiKey ? 'success' : 'warning'}>
                  {provider.hasApiKey ? 'key stored' : 'no key'}
                </Badge>
              </div>
            </ListRow>
          ))}
        </Stack>
      ) : null}

      <Divider />

      <Stack gap={3}>
        <Text variant="caption" weight="semibold">
          Add an API-key provider
        </Text>
        <FieldGrid>
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
            label="Models (comma-separated)"
            hint="Must include the model your runtime profile pins."
            value={models}
            onChange={(event) => setModels(event.target.value)}
          />
          <Input
            label="API key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            hint="Write-only; leaving it blank on update keeps the stored key."
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
          />
        </FieldGrid>
        <Stack direction="row">
          <Button
            size="sm"
            variant="accent"
            disabled={busy || !id.trim() || !baseUrl.trim()}
            onClick={() => void submit()}
          >
            Save provider
          </Button>
        </Stack>
      </Stack>
    </SectionCard>
  );
}

// ── runs ───────────────────────────────────────────────────────────────────

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
  const profileOptions = (
    (profilesQuery.data?.items ?? []) as { name?: string; id: string }[]
  ).map((entry) => ({
    value: entry.name ?? entry.id,
    label: entry.name ? `${entry.name} · ${entry.id.slice(0, 8)}` : entry.id,
  }));

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
    <SectionCard
      title="Runs"
      description={
        selectedTeam
          ? `Daemon processes on this machine polling the ${selectedTeam.name} task queue.`
          : 'Select a team to start runs.'
      }
    >
      <Stack gap={3}>
        <FieldGrid min={160}>
          <SelectField
            label="Agent"
            value={agent}
            onChange={setAgent}
            placeholder="Select…"
            options={agents.map((entry) => ({
              value: entry.agentName,
              label: entry.agentName,
            }))}
          />
          {profileOptions.length > 0 ? (
            <SelectField
              label="Runtime profile"
              value={profile}
              onChange={setProfile}
              placeholder="Select…"
              options={profileOptions}
            />
          ) : (
            <Input
              label="Runtime profile"
              hint="No profiles in this team yet — create one under Profiles, or paste a UUID."
              value={profile}
              onChange={(event) => setProfile(event.target.value)}
            />
          )}
          <Input
            label="Task types"
            hint="Comma-separated, e.g. freeform"
            value={taskTypes}
            onChange={(event) => setTaskTypes(event.target.value)}
          />
          <SelectField
            label="Mode"
            value={mode}
            onChange={(value) => setMode(value as StartRunBody['mode'])}
            options={[
              { value: 'poll', label: 'poll — keep polling' },
              { value: 'drain', label: 'drain — stop when empty' },
            ]}
          />
        </FieldGrid>
        <Stack direction="row">
          <Button
            size="sm"
            variant="accent"
            disabled={busy || !agent || !profile.trim() || !selectedTeam?.id}
            onClick={() => void start()}
          >
            Start run
          </Button>
        </Stack>
      </Stack>

      {runs.length > 0 ? (
        <Stack gap={0}>
          {runs.map((run) => (
            <Fragment key={run.id}>
              <RunRow
                run={run}
                onStop={() => runtime.stopRun(run.id).catch(() => undefined)}
                onToggleLogs={() =>
                  setLogRunId((current) => (current === run.id ? null : run.id))
                }
                logsOpen={logRunId === run.id}
              />
              {logRunId === run.id ? (
                <RunLogTail runtime={runtime} runId={run.id} />
              ) : null}
            </Fragment>
          ))}
        </Stack>
      ) : (
        <Text variant="caption" color="muted">
          No runs yet. Start one above; it idles until a matching task lands in
          the queue.
        </Text>
      )}
    </SectionCard>
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
  const variant =
    run.status === 'running'
      ? ('success' as const)
      : run.status === 'failed'
        ? ('error' as const)
        : ('default' as const);
  return (
    <ListRow>
      <Badge variant={variant}>{run.status}</Badge>
      <Stack gap={1} style={{ minWidth: 0, flex: 1 }}>
        <Stack direction="row" gap={2} align="center" wrap>
          <Text weight="medium">{run.agent}</Text>
          <Text variant="caption" color="muted">
            {run.mode} · {run.profiles.join(', ')} · {run.taskTypes.join(', ')}
          </Text>
        </Stack>
        <Text variant="caption" color="muted" mono>
          {run.id} · started {formatRunTimestamp(run.startedAt)}
          {run.endedAt ? ` · ended ${formatRunTimestamp(run.endedAt)}` : ''}
          {run.pid !== undefined ? ` · pid ${run.pid}` : ''}
          {run.exitCode !== undefined
            ? ` · exit ${run.exitCode === null ? 'signal' : run.exitCode}`
            : ''}
        </Text>
      </Stack>
      <div
        style={{
          marginLeft: 'auto',
          display: 'flex',
          gap: 4,
          flexShrink: 0,
        }}
      >
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={logsOpen}
          aria-controls={runLogPanelId(run.id)}
          onClick={onToggleLogs}
        >
          {logsOpen ? 'Hide logs' : 'Logs'}
        </Button>
        {run.active ? (
          <Button variant="ghost" size="sm" onClick={onStop}>
            Stop
          </Button>
        ) : null}
      </div>
    </ListRow>
  );
}

function formatRunTimestamp(value: string): string {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: 'short',
        timeStyle: 'medium',
      }).format(timestamp)
    : value;
}
