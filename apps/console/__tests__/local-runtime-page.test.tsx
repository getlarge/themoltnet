vi.mock('../src/runtime-local/local-control-oauth.js', () => ({
  authorizeLocalControl: vi.fn().mockImplementation(async () => ({
    accessToken: 'paired-token-for-tests',
    expiresAt: Date.now() + 900_000,
  })),
}));
/**
 * Integration tests for the Local runtime page: real page + real
 * useLocalRuntime hook + real Agent Server client against a mocked loopback fetch.
 * Covers the manual-test papercuts: surfaced errors, explicit sign-in link
 * (no popup-blocked window.open), login cancel, and the profile picker.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LocalRuntimePage } from '../src/pages/LocalRuntimePage.js';
import { authorizeLocalControl } from '../src/runtime-local/local-control-oauth.js';
import { localControlTokens } from '../src/runtime-local/local-control-token-cache.js';
import type { AgentServerProviderModel } from '../src/runtime-local/agent-server-response-validation.js';
import { createTestWrapper } from './test-query-client.js';

const AGENT_SERVER = 'http://127.0.0.1:17374';

vi.mock('../src/api.js', () => ({ getApiClient: () => ({}) }));
const updateTeamMemberRole = vi.hoisted(() => vi.fn());
vi.mock('@moltnet/api-client', () => ({
  updateTeamMemberRole: (...args: unknown[]) => updateTeamMemberRole(...args),
}));
vi.mock('../src/config.js', () => ({
  getConfig: () => ({ agentServerUrl: 'http://127.0.0.1:17374' }),
}));
const profilesState = vi.hoisted(() => ({
  items: [] as { id: string; name?: string }[],
}));
vi.mock('@moltnet/api-client/query', () => ({
  listRuntimeProfilesOptions: () => ({
    queryKey: ['runtime-profiles'],
    queryFn: async () => ({ items: profilesState.items }),
  }),
}));
vi.mock('../src/team/useTeam.js', () => ({
  useTeam: () => ({
    error: null,
    refreshTeams: vi.fn(),
    selectedTeam: {
      id: 'team-1',
      name: 'Team One',
      personal: false,
      role: 'owner',
    },
  }),
}));

type Handler = (init?: RequestInit) => Response | Promise<Response>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const agentServerState = {
  status: {
    version: 'test',
    platform: 'darwin',
    subscriptions: [
      { id: 'anthropic', name: 'Anthropic', connected: false },
      { id: 'openai-codex', name: 'OpenAI Codex', connected: true },
    ],
    agents: [
      {
        kind: 'managed',
        agentName: 'existing-bot',
        subjectId: 'agent-1',
        fingerprint: 'FP-1',
        apiUrl: 'https://api.example',
        teamId: undefined as string | undefined,
        createdAt: 't',
        hasAgentKey: true,
        hasPrivateKey: true,
      },
    ],
    identities: [
      { alias: 'legreffier', activated: false, hasAgentKey: true },
      { alias: 'oauth-only', activated: false, hasAgentKey: false },
    ],
    selectedIdentity: 'legreffier',
    providers: {
      ollama: {
        api: 'openai-completions',
        baseUrl: 'https://ollama.com/v1',
        envName: 'MOLTNET_PROVIDER_OLLAMA_API_KEY',
        models: [{ id: 'qwen3' }] as AgentServerProviderModel[],
        hasApiKey: true,
      },
    },
    runtimeSettings: {
      heartbeatIntervalMs: 60_000,
      warmRetentionSec: 1800,
    },
    runs: [],
  },
};

let handlers: Record<string, Handler>;
const requests: { method: string; url: string; body: unknown }[] = [];

function installFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      requests.push({
        method,
        url,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      const key = `${method} ${url.replace(AGENT_SERVER, '')}`;
      const handler = handlers[key];
      if (!handler) return jsonResponse({ code: 'not_found' }, 404);
      return handler(init);
    }),
  );
}

beforeEach(() => {
  localControlTokens.clear();
  vi.mocked(authorizeLocalControl).mockClear();
  requests.length = 0;
  profilesState.items = [];
  vi.spyOn(window, 'open').mockReturnValue(null);
  handlers = {
    'GET /health': () => jsonResponse({ status: 'ok' }),
    'GET /v1/status': () => jsonResponse(agentServerState.status),
  };
  installFetch();
});

async function renderPage(connect = true) {
  const view = render(<LocalRuntimePage />, { wrapper: createTestWrapper() });
  if (connect) {
    fireEvent.click(await screen.findByRole('button', { name: 'Connect' }));
    await screen.findByText('LLM providers');
    vi.mocked(window.open).mockClear();
  }
  return view;
}

describe('LocalRuntimePage', () => {
  it('reuses the approved token after leaving and returning to the page', async () => {
    const first = await renderPage();
    expect(await screen.findByText('Connected')).toBeInTheDocument();
    first.unmount();
    await renderPage(false);
    expect(await screen.findByText('Connected')).toBeInTheDocument();
    expect(authorizeLocalControl).toHaveBeenCalledTimes(1);
  });

  it('discards a cached token rejected after a server restart', async () => {
    const first = await renderPage();
    expect(await screen.findByText('Connected')).toBeInTheDocument();
    first.unmount();
    handlers['GET /v1/status'] = () => jsonResponse({}, 401);
    await renderPage(false);
    expect(await screen.findByText('Sign-in required')).toBeInTheDocument();
    expect(authorizeLocalControl).toHaveBeenCalledTimes(1);
    expect(
      localControlTokens.get(JSON.stringify([undefined, AGENT_SERVER])),
    ).toBeNull();
  });

  it('connects with a tab-memory token and renders all sections from /v1/status', async () => {
    await renderPage();
    expect(await screen.findByText('Connected')).toBeInTheDocument();
    expect((await screen.findAllByText('existing-bot')).length).toBeGreaterThan(
      0,
    );
    expect(screen.getByText('Anthropic')).toBeInTheDocument();
    expect(screen.getByText('ollama')).toBeInTheDocument();
    expect(screen.getByText(/No runs yet/)).toBeInTheDocument();
    // Token travels in the local-control header, never as browser credentials.
    const statusCall = (
      fetch as unknown as ReturnType<typeof vi.fn>
    ).mock.calls.find(([url]) => String(url).endsWith('/v1/status'));
    expect(statusCall?.[1]?.credentials).toBe('omit');
    expect(
      (statusCall?.[1]?.headers as Record<string, string>)[
        'x-moltnet-agent-server-token'
      ],
    ).toBe('paired-token-for-tests');
  });

  it('shows the install instructions when no supervisor answers', async () => {
    handlers['GET /health'] = () => {
      throw new Error('connection refused');
    };
    await renderPage(false);
    expect(await screen.findByText('Not running')).toBeInTheDocument();
    expect(
      screen.getByRole('link', {
        name: 'Download MoltNet Agent for Mac',
      }),
    ).toHaveAttribute(
      'href',
      'https://themolt.net/download/desktop/macos-arm64',
    );
    expect(
      screen.getByRole('link', { name: 'View terminal installation' }),
    ).toHaveAttribute('href', 'https://themolt.net/download#install');
  });

  it('surfaces the Agent Server error when creating an identity fails', async () => {
    handlers['POST /v1/agents'] = () =>
      jsonResponse(
        {
          code: 'internal_error',
          message: 'Agent key management is not configured',
        },
        500,
      );
    await renderPage();
    await screen.findAllByText('existing-bot');
    fireEvent.change(screen.getByLabelText('Agent name'), {
      target: { value: 'legreffier-local' },
    });
    // The token is required: the button stays disabled until it is filled.
    expect(
      screen.getByRole('button', { name: 'Create identity' }),
    ).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Team invite code/), {
      target: { value: 'enrol-abc' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create identity' }));
    expect(
      await screen.findByText('Agent key management is not configured'),
    ).toBeInTheDocument();
  });

  it('renders an explicit sign-in link for a redirect login instead of auto-opening', async () => {
    handlers['POST /v1/subscriptions/anthropic/login'] = () =>
      jsonResponse(
        {
          providerId: 'anthropic',
          status: 'pending',
          authUrl: 'https://claude.ai/oauth/authorize?x=1',
        },
        201,
      );
    handlers['GET /v1/subscriptions/anthropic/login'] = () =>
      jsonResponse({ providerId: 'anthropic', status: 'pending' });
    const open = vi.fn();
    vi.stubGlobal('open', open);
    await renderPage();
    await screen.findByText('Anthropic');
    fireEvent.click(screen.getAllByRole('button', { name: 'Connect' })[0]);
    expect(
      await screen.findByRole('button', { name: 'Open sign-in page' }),
    ).toBeInTheDocument();
    // Nothing auto-opened outside the user gesture.
    expect(open).not.toHaveBeenCalled();
  });

  it('cancels a pending login and clears the pending row', async () => {
    handlers['POST /v1/subscriptions/anthropic/login'] = () =>
      jsonResponse(
        { providerId: 'anthropic', status: 'pending', authUrl: 'https://x' },
        201,
      );
    handlers['DELETE /v1/subscriptions/anthropic/login'] = () =>
      jsonResponse({ providerId: 'anthropic', status: 'cancelled' });
    await renderPage();
    await screen.findByText('Anthropic');
    fireEvent.click(screen.getAllByRole('button', { name: 'Connect' })[0]);
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Open sign-in page' }),
      ).not.toBeInTheDocument(),
    );
    expect(
      requests.some(
        (entry) =>
          entry.method === 'DELETE' &&
          entry.url.endsWith('/v1/subscriptions/anthropic/login'),
      ),
    ).toBe(true);
  });

  it('keeps a pending login visible when server cancellation fails', async () => {
    handlers['POST /v1/subscriptions/anthropic/login'] = () =>
      jsonResponse(
        { providerId: 'anthropic', status: 'pending', authUrl: 'https://x' },
        201,
      );
    handlers['DELETE /v1/subscriptions/anthropic/login'] = () =>
      jsonResponse(
        {
          code: 'internal_error',
          message: 'Could not cancel the provider sign-in.',
        },
        500,
      );
    await renderPage();
    await screen.findByText('Anthropic');
    fireEvent.click(screen.getAllByRole('button', { name: 'Connect' })[0]);
    await screen.findByRole('button', { name: 'Open sign-in page' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(
      await screen.findByText('Could not cancel the provider sign-in.'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Open sign-in page' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('shows a failed login error immediately', async () => {
    handlers['POST /v1/subscriptions/openai-codex/login'] = () =>
      jsonResponse(
        {
          providerId: 'openai-codex',
          status: 'failed',
          error: 'device flow refused',
        },
        201,
      );
    await renderPage();
    await screen.findByText('OpenAI Codex');
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }));
    expect(await screen.findByText('device flow refused')).toBeInTheDocument();
  });

  it('escalates a freshly created managed agent to team executor', async () => {
    updateTeamMemberRole.mockResolvedValue({ data: { role: 'executor' } });
    handlers['POST /v1/agents'] = () =>
      jsonResponse(
        {
          kind: 'managed',
          agentName: 'course-bot',
          // Distinct on purpose: the team-member path parameter is the Keto
          // subject (agents.id), not the Kratos identity.
          subjectId: 'new-agent-1',
          fingerprint: 'FP-2',
          apiUrl: 'https://api.example',
          teamId: 'team-1',
          createdAt: 't',
        },
        201,
      );
    await renderPage();
    await screen.findAllByText('existing-bot');
    fireEvent.change(screen.getByLabelText('Agent name'), {
      target: { value: 'course-bot' },
    });
    fireEvent.change(screen.getByLabelText(/Team invite code/), {
      target: { value: 'enrol-xyz' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create identity' }));
    await waitFor(() =>
      expect(updateTeamMemberRole).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { id: 'team-1', subjectId: 'new-agent-1' },
          body: { role: 'executor' },
        }),
      ),
    );
    expect(
      await screen.findByText(/joined Team One as an executor/),
    ).toBeInTheDocument();
  });

  it('attaches the current central identity without asking for a path', async () => {
    handlers['POST /v1/agents'] = () =>
      jsonResponse(
        {
          kind: 'external',
          agentName: 'legreffier',
          subjectId: 'agent-central',
          fingerprint: 'FP-CENTRAL',
          createdAt: 't',
        },
        201,
      );
    await renderPage();
    expect(await screen.findByText(/Current identity:/)).toHaveTextContent(
      'legreffier',
    );
    expect(screen.queryByLabelText(/\.moltnet/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Attach identity' }));

    await waitFor(() =>
      expect(
        requests.find(
          (entry) =>
            entry.method === 'POST' && entry.url.endsWith('/v1/agents'),
        )?.body,
      ).toEqual({ kind: 'external', identityAlias: 'legreffier' }),
    );
  });

  it('shows actionable agent-key guidance when attaching an identity fails', async () => {
    handlers['POST /v1/agents'] = () =>
      jsonResponse(
        {
          code: 'verification_failed',
          message:
            'agent key rejected (401): the key is revoked, expired, or not authorized for the requested team — re-provision the key.',
        },
        400,
      );
    await renderPage();
    await screen.findByText(/Current identity:/);

    fireEvent.click(screen.getByRole('button', { name: 'Attach identity' }));

    expect(
      await screen.findByText(
        /agent key rejected \(401\).*re-provision the key/u,
      ),
    ).toBeInTheDocument();
  });

  it('lets Agent Server resolve an enrolled team instead of blocking on the primary key team', async () => {
    agentServerState.status.agents[0] = {
      ...agentServerState.status.agents[0],
      teamId: 'personal-team-9',
    };
    await renderPage();
    await screen.findAllByText(/existing-bot/);
    const agentSelect = screen.getByLabelText('Agent');
    fireEvent.change(agentSelect, { target: { value: 'existing-bot' } });
    fireEvent.change(screen.getByLabelText('Runtime profile'), {
      target: { value: 'profile-for-selected-team' },
    });
    expect(screen.queryByText(/bound to team/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start run' })).toBeEnabled();
    delete (agentServerState.status.agents[0] as { teamId?: string }).teamId;
  });

  it('does not replace a legacy provider endpoint through a new preset', async () => {
    renderPage();
    await screen.findAllByText('existing-bot');
    fireEvent.change(screen.getByLabelText('Provider type'), {
      target: { value: 'ollama' },
    });
    expect(
      screen.getByRole('button', {
        name: 'Save connection and discover models',
      }),
    ).toBeDisabled();
    expect(
      screen.getByText(/This provider already exists/),
    ).toBeInTheDocument();
    expect(requests.some((request) => request.method === 'PUT')).toBe(false);
  });

  it('discovers models from a preset and saves only the selected ones', async () => {
    handlers['GET /v1/status'] = () =>
      jsonResponse({ ...agentServerState.status, providers: {} });
    handlers['POST /v1/providers/ollama/discover-models'] = () =>
      jsonResponse({
        models: [
          { id: 'llama3.3:70b' },
          { id: 'qwen3-coder:480b-cloud', input: ['text', 'image'] },
        ],
      });
    handlers['PUT /v1/providers/ollama'] = (init) =>
      jsonResponse({
        api: 'openai-completions',
        baseUrl: 'http://localhost:11434/v1',
        envName: 'MOLTNET_PROVIDER_OLLAMA_API_KEY',
        models: JSON.parse(String(init?.body)).models,
        hasApiKey: false,
      });
    await renderPage();
    await screen.findAllByText('existing-bot');

    // Preset pre-fills the endpoint; no hand-typed base URL needed.
    fireEvent.change(screen.getByLabelText('Provider type'), {
      target: { value: 'ollama' },
    });
    expect((screen.getByLabelText('Base URL') as HTMLInputElement).value).toBe(
      'http://localhost:11434/v1',
    );

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Save connection and discover models',
      }),
    );
    const modelCheckbox = await screen.findByRole('checkbox', {
      // The image chip is inside the label, so it joins the accessible name;
      // that is deliberate, so a screen reader announces the capability.
      name: /^qwen3-coder:480b-cloud/u,
    });
    fireEvent.click(modelCheckbox);
    fireEvent.click(screen.getByRole('button', { name: /Save models for/ }));

    await waitFor(() => {
      const put = requests
        .filter(
          (entry) =>
            entry.method === 'PUT' &&
            entry.url.endsWith('/v1/providers/ollama'),
        )
        .at(-1);
      expect(put?.body).toMatchObject({
        baseUrl: 'http://localhost:11434/v1',
        envName: 'MOLTNET_PROVIDER_OLLAMA_API_KEY',
        // The daemon detected the modality; the console saves it back
        // untouched rather than re-deriving it.
        models: [{ id: 'qwen3-coder:480b-cloud', input: ['text', 'image'] }],
      });
    });
    const discovery = requests.find((entry) =>
      entry.url.endsWith('/v1/providers/ollama/discover-models'),
    );
    expect(discovery?.body).toBeUndefined();
    const stagedProvider = requests.find(
      (entry) =>
        entry.method === 'PUT' && entry.url.endsWith('/v1/providers/ollama'),
    );
    expect(stagedProvider?.body).toMatchObject({
      baseUrl: 'http://localhost:11434/v1',
      models: [],
    });
  });

  it('pre-fills an existing provider for edits and can remove it', async () => {
    handlers['DELETE /v1/providers/ollama'] = () =>
      new Response(null, { status: 204 });
    await renderPage();
    await screen.findAllByText('existing-bot');

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByText('Configure Ollama (local)')).toBeInTheDocument();
    expect(screen.getByText('Provider ID: ollama')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Save models for/ }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Remove provider' }));
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Remove provider' }).at(-1)!,
    );
    await waitFor(() =>
      expect(
        requests.some(
          (entry) =>
            entry.method === 'DELETE' &&
            entry.url.endsWith('/v1/providers/ollama'),
        ),
      ).toBe(true),
    );
  });

  it('keeps declared input modalities when an existing provider is saved', async () => {
    // A vision model declared elsewhere (moltnet-agent providers set
    // --model-input). Saving from the console must not silently strip it.
    agentServerState.status.providers.ollama.models = [
      { id: 'qwen3' },
      { id: 'qwen3.5:397b', input: ['text', 'image'] },
    ];
    handlers['PUT /v1/providers/ollama'] = (init) =>
      jsonResponse({
        api: 'openai-completions',
        baseUrl: 'https://ollama.com/v1',
        envName: 'MOLTNET_PROVIDER_OLLAMA_API_KEY',
        models: JSON.parse(String(init?.body)).models,
        hasApiKey: true,
      });
    await renderPage();
    await screen.findAllByText('existing-bot');

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByText('Configure Ollama (local)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Save models for/ }));

    await waitFor(() => {
      const put = requests
        .filter(
          (entry) =>
            entry.method === 'PUT' &&
            entry.url.endsWith('/v1/providers/ollama'),
        )
        .at(-1);
      expect(put?.body).toMatchObject({
        models: expect.arrayContaining([
          { id: 'qwen3.5:397b', input: ['text', 'image'] },
        ]),
      });
    });
  });

  it('saves an operator text-only override even when discovery detects vision', async () => {
    agentServerState.status.providers.ollama.models = [
      { id: 'qwen3.5:397b', input: ['text'] },
    ] as AgentServerProviderModel[];
    // The daemon resolves the override server-side, so what discovery returns
    // is already the answer the console must save back untouched.
    handlers['POST /v1/providers/ollama/discover-models'] = () =>
      jsonResponse({ models: [{ id: 'qwen3.5:397b', input: ['text'] }] });
    handlers['PUT /v1/providers/ollama'] = (init) =>
      jsonResponse({
        api: 'openai-completions',
        baseUrl: 'https://ollama.com/v1',
        envName: 'MOLTNET_PROVIDER_OLLAMA_API_KEY',
        models: JSON.parse(String(init?.body)).models,
        hasApiKey: true,
      });
    await renderPage();
    await screen.findAllByText('existing-bot');

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh models' }));
    await screen.findByRole('checkbox', { name: /qwen3\.5:397b/u });
    expect(
      screen.getByRole('checkbox', { name: /qwen3\.5:397b/u }),
    ).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: /Save models for/ }));

    await waitFor(() => {
      const put = requests
        .filter(
          (entry) =>
            entry.method === 'PUT' &&
            entry.url.endsWith('/v1/providers/ollama'),
        )
        .at(-1);
      // Re-deriving from stored state instead of round-tripping the entry
      // would be the regression this pins.
      expect(put?.body).toMatchObject({
        models: [{ id: 'qwen3.5:397b', input: ['text'] }],
      });
    });
  });

  it('renders large discovery results in bounded, filterable pages', async () => {
    handlers['GET /v1/status'] = () =>
      jsonResponse({ ...agentServerState.status, providers: {} });
    const models = Array.from({ length: 120 }, (_value, index) => ({
      id: `model-${String(index).padStart(3, '0')}`,
    }));
    handlers['POST /v1/providers/ollama/discover-models'] = () =>
      jsonResponse({ models });
    handlers['PUT /v1/providers/ollama'] = () =>
      jsonResponse({
        api: 'openai-completions',
        baseUrl: 'http://localhost:11434/v1',
        envName: 'MOLTNET_PROVIDER_OLLAMA_API_KEY',
        models: [],
        hasApiKey: false,
      });
    await renderPage();
    await screen.findAllByText('existing-bot');
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Save connection and discover models',
      }),
    );

    await screen.findByLabelText('Filter models');
    expect(screen.getAllByRole('checkbox')).toHaveLength(50);
    fireEvent.click(screen.getByRole('button', { name: 'Show more models' }));
    expect(screen.getAllByRole('checkbox')).toHaveLength(100);
    fireEvent.change(screen.getByLabelText('Filter models'), {
      target: { value: 'model-119' },
    });
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    expect(
      screen.getByRole('checkbox', { name: 'model-119' }),
    ).toBeInTheDocument();
  });

  it('offers the team runtime profiles as a picker with id suffixes', async () => {
    profilesState.items = [
      { id: '11111111-aaaa-bbbb-cccc-000000000001', name: 'course-profile' },
      { id: '22222222-aaaa-bbbb-cccc-000000000002', name: 'review-profile' },
    ];
    await renderPage();
    await screen.findAllByText('existing-bot');
    // The picker swaps in once the async profiles query resolves.
    expect(
      await screen.findByRole('option', { name: 'course-profile · 11111111' }),
    ).toBeInTheDocument();
    const select = screen.getByLabelText('Runtime profile');
    expect(select.tagName).toBe('SELECT');
    fireEvent.change(select, { target: { value: 'review-profile' } });
    expect((select as HTMLSelectElement).value).toBe('review-profile');
  });

  it('starts a run with one registered task type from a selector', async () => {
    profilesState.items = [
      { id: '11111111-aaaa-bbbb-cccc-000000000001', name: 'course-profile' },
    ];
    handlers['POST /v1/runs'] = () =>
      jsonResponse(
        {
          id: 'run-1',
          agent: 'existing-bot',
          teamId: 'team-1',
          profiles: ['course-profile'],
          taskTypes: ['pr_review'],
          mode: 'poll',
          status: 'running',
          active: true,
          startedAt: 't',
        },
        201,
      );
    await renderPage();
    await screen.findByRole('option', {
      name: 'course-profile · 11111111',
    });
    const profile = await screen.findByLabelText('Runtime profile');
    await waitFor(() =>
      expect(screen.getByLabelText('Agent')).toHaveValue('existing-bot'),
    );
    fireEvent.change(profile, { target: { value: 'course-profile' } });
    fireEvent.change(screen.getByLabelText('Task type'), {
      target: { value: 'pr_review' },
    });
    expect(screen.getByLabelText('Agent')).toHaveValue('existing-bot');
    expect(profile).toHaveValue('course-profile');
    expect(screen.getByLabelText('Task type')).toHaveValue('pr_review');
    const startButton = screen.getByRole('button', { name: 'Start run' });
    await waitFor(() => expect(startButton).toBeEnabled());
    fireEvent.click(startButton);

    await waitFor(() =>
      expect(
        requests.find(
          (entry) => entry.method === 'POST' && entry.url.endsWith('/v1/runs'),
        )?.body,
      ).toMatchObject({
        agent: 'existing-bot',
        profiles: ['course-profile'],
        taskTypes: ['pr_review'],
      }),
    );
  });
});
