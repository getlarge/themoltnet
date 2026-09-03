/**
 * Integration tests for the Local runtime page: real page + real
 * useLocalRuntime hook + real Agent Server client against a mocked loopback fetch.
 * Covers the manual-test papercuts: surfaced errors, explicit sign-in link
 * (no popup-blocked window.open), login cancel, and the profile picker.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LocalRuntimePage } from '../src/pages/LocalRuntimePage.js';
import { createTestWrapper } from './test-query-client.js';

const AGENT_SERVER = 'http://127.0.0.1:17374';

vi.mock('../src/api.js', () => ({ getApiClient: () => ({}) }));
const createAgentEnrollment = vi.hoisted(() => vi.fn());
const updateTeamMemberRole = vi.hoisted(() => vi.fn());
vi.mock('@moltnet/api-client', () => ({
  createAgentEnrollment: (...args: unknown[]) => createAgentEnrollment(...args),
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
        identityId: 'id-1',
        fingerprint: 'FP-1',
        apiUrl: 'https://api.example',
        teamId: undefined as string | undefined,
        createdAt: 't',
        hasAgentKey: true,
        hasPrivateKey: true,
      },
    ],
    providers: {
      ollama: {
        api: 'openai-completions',
        baseUrl: 'https://ollama.com/v1',
        envName: 'MOLTNET_PROVIDER_OLLAMA_API_KEY',
        models: ['qwen3'],
        hasApiKey: true,
      },
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
  requests.length = 0;
  profilesState.items = [];
  sessionStorage.setItem(
    `moltnet-agent-server-token::${AGENT_SERVER}`,
    'paired-token-for-tests',
  );
  handlers = {
    'GET /health': () => jsonResponse({ status: 'ok' }),
    'GET /v1/status': () => jsonResponse(agentServerState.status),
  };
  installFetch();
});

function renderPage() {
  return render(<LocalRuntimePage />, { wrapper: createTestWrapper() });
}

describe('LocalRuntimePage', () => {
  it('connects with a stored token and renders all sections from /v1/status', async () => {
    renderPage();
    expect(await screen.findByText('Connected')).toBeInTheDocument();
    expect((await screen.findAllByText('existing-bot')).length).toBeGreaterThan(
      0,
    );
    expect(screen.getByText('Anthropic')).toBeInTheDocument();
    expect(screen.getByText('ollama')).toBeInTheDocument();
    expect(screen.getByText(/No runs yet/)).toBeInTheDocument();
    // Token travels in the pairing header, never as browser credentials.
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
    renderPage();
    expect(await screen.findByText('Not running')).toBeInTheDocument();
    expect(
      screen.getByText('npx @themoltnet/agent-daemon server'),
    ).toBeInTheDocument();
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
    renderPage();
    await screen.findAllByText('existing-bot');
    fireEvent.change(screen.getByLabelText('Agent name'), {
      target: { value: 'legreffier-local' },
    });
    // The token is required: the button stays disabled until it is filled.
    expect(
      screen.getByRole('button', { name: 'Create identity' }),
    ).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Invitation code/), {
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
    renderPage();
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
    renderPage();
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
    renderPage();
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
    renderPage();
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
          identityId: 'new-id-1',
          fingerprint: 'FP-2',
          apiUrl: 'https://api.example',
          teamId: 'team-1',
          createdAt: 't',
        },
        201,
      );
    renderPage();
    await screen.findAllByText('existing-bot');
    fireEvent.change(screen.getByLabelText('Agent name'), {
      target: { value: 'course-bot' },
    });
    fireEvent.change(screen.getByLabelText(/Invitation code/), {
      target: { value: 'enrol-xyz' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create identity' }));
    await waitFor(() =>
      expect(updateTeamMemberRole).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { id: 'team-1', subjectId: 'new-id-1' },
          body: { role: 'executor' },
        }),
      ),
    );
    expect(
      await screen.findByText(/joined Team One as an executor/),
    ).toBeInTheDocument();
  });

  it('generates an invitation code into the form for the selected team', async () => {
    createAgentEnrollment.mockResolvedValue({
      data: { token: 'enrol-123', expiresAt: '2030-01-01T00:00:00Z' },
    });
    renderPage();
    await screen.findAllByText('existing-bot');
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Generate invitation code for Team One',
      }),
    );
    await waitFor(() =>
      expect(
        (screen.getByLabelText(/Invitation code/) as HTMLInputElement).value,
      ).toBe('enrol-123'),
    );
    expect(createAgentEnrollment).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: { 'x-moltnet-team-id': 'team-1' },
      }),
    );
  });

  it('blocks starting a run for an agent bound to another team', async () => {
    agentServerState.status.agents[0] = {
      ...agentServerState.status.agents[0],
      teamId: 'personal-team-9',
    };
    renderPage();
    await screen.findAllByText(/existing-bot/);
    const agentSelect = screen.getByLabelText('Agent');
    fireEvent.change(agentSelect, { target: { value: 'existing-bot' } });
    expect(await screen.findByText(/bound to team/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start run' })).toBeDisabled();
    delete (agentServerState.status.agents[0] as { teamId?: string }).teamId;
  });

  it('discovers models from a preset and saves only the selected ones', async () => {
    handlers['POST /v1/providers/ollama-local/discover-models'] = () =>
      jsonResponse({ models: ['llama3.3:70b', 'qwen3-coder:480b-cloud'] });
    handlers['PUT /v1/providers/ollama-local'] = (init) =>
      jsonResponse({
        api: 'openai-completions',
        baseUrl: 'http://localhost:11434/v1',
        envName: 'MOLTNET_PROVIDER_OLLAMA_LOCAL_API_KEY',
        models: JSON.parse(String(init?.body)).models,
        hasApiKey: false,
      });
    renderPage();
    await screen.findAllByText('existing-bot');

    // Preset pre-fills the endpoint; no hand-typed base URL needed.
    fireEvent.click(screen.getByRole('button', { name: 'Ollama (local)' }));
    expect((screen.getByLabelText('Base URL') as HTMLInputElement).value).toBe(
      'http://localhost:11434/v1',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Fetch models' }));
    const modelCheckbox = await screen.findByRole('checkbox', {
      name: 'qwen3-coder:480b-cloud',
    });
    fireEvent.click(modelCheckbox);
    fireEvent.click(screen.getByRole('button', { name: 'Save provider' }));

    await waitFor(() => {
      const put = requests
        .filter(
          (entry) =>
            entry.method === 'PUT' &&
            entry.url.endsWith('/v1/providers/ollama-local'),
        )
        .at(-1);
      expect(put?.body).toMatchObject({
        baseUrl: 'http://localhost:11434/v1',
        envName: 'MOLTNET_PROVIDER_OLLAMA_LOCAL_API_KEY',
        models: ['qwen3-coder:480b-cloud'],
      });
    });
    const discovery = requests.find((entry) =>
      entry.url.endsWith('/v1/providers/ollama-local/discover-models'),
    );
    expect(discovery?.body).toBeUndefined();
    const stagedProvider = requests.find(
      (entry) =>
        entry.method === 'PUT' &&
        entry.url.endsWith('/v1/providers/ollama-local'),
    );
    expect(stagedProvider?.body).toMatchObject({
      baseUrl: 'http://localhost:11434/v1',
      models: [],
    });
  });

  it('renders large discovery results in bounded, filterable pages', async () => {
    const models = Array.from(
      { length: 120 },
      (_value, index) => `model-${String(index).padStart(3, '0')}`,
    );
    handlers['POST /v1/providers/ollama-local/discover-models'] = () =>
      jsonResponse({ models });
    handlers['PUT /v1/providers/ollama-local'] = () =>
      jsonResponse({
        api: 'openai-completions',
        baseUrl: 'http://localhost:11434/v1',
        envName: 'MOLTNET_PROVIDER_OLLAMA_LOCAL_API_KEY',
        models: [],
        hasApiKey: false,
      });
    renderPage();
    await screen.findAllByText('existing-bot');
    fireEvent.click(screen.getByRole('button', { name: 'Fetch models' }));

    await screen.findByLabelText('Filter discovered models');
    expect(screen.getAllByRole('checkbox')).toHaveLength(50);
    fireEvent.click(screen.getByRole('button', { name: 'Show 50 more' }));
    expect(screen.getAllByRole('checkbox')).toHaveLength(100);
    fireEvent.change(screen.getByLabelText('Filter discovered models'), {
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
    renderPage();
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
});
