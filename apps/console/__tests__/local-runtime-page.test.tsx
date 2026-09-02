/**
 * Integration tests for the Local runtime page: real page + real
 * useLocalRuntime hook + real serve-client against a mocked loopback fetch.
 * Covers the manual-test papercuts: surfaced errors, explicit sign-in link
 * (no popup-blocked window.open), login cancel, and the profile picker.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LocalRuntimePage } from '../src/pages/LocalRuntimePage.js';
import { createTestWrapper } from './test-query-client.js';

const SERVE = 'http://127.0.0.1:17374';

vi.mock('../src/api.js', () => ({ getApiClient: () => ({}) }));
vi.mock('../src/config.js', () => ({
  getConfig: () => ({ serveUrl: 'http://127.0.0.1:17374' }),
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
    selectedTeam: { id: 'team-1', name: 'Team One', role: 'owner' },
  }),
}));

type Handler = (init?: RequestInit) => Response | Promise<Response>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const serveState = {
  status: {
    version: 'test',
    platform: 'darwin',
    subscriptions: [
      { id: 'anthropic', name: 'Anthropic', connected: false },
      { id: 'github-copilot', name: 'GitHub Copilot', connected: true },
    ],
    agents: [
      {
        kind: 'managed',
        agentName: 'existing-bot',
        identityId: 'id-1',
        fingerprint: 'FP-1',
        apiUrl: 'https://api.example',
        createdAt: 't',
        hasAgentKey: true,
        hasPrivateKey: true,
      },
    ],
    providers: {
      ollama: {
        api: 'openai-completions',
        baseUrl: 'https://ollama.com/v1',
        envName: 'OLLAMA_API_KEY',
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
      const key = `${method} ${url.replace(SERVE, '')}`;
      const handler = handlers[key];
      if (!handler) return jsonResponse({ code: 'not_found' }, 404);
      return handler(init);
    }),
  );
}

beforeEach(() => {
  requests.length = 0;
  profilesState.items = [];
  localStorage.setItem(
    `moltnet-serve-token::${SERVE}`,
    'paired-token-for-tests',
  );
  handlers = {
    'GET /health': () => jsonResponse({ status: 'ok' }),
    'GET /v1/status': () => jsonResponse(serveState.status),
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
        'x-moltnet-serve-token'
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
      screen.getByText('npx @themoltnet/agent-daemon serve'),
    ).toBeInTheDocument();
  });

  it('surfaces the serve error message when creating an identity fails', async () => {
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

  it('shows a failed login error immediately', async () => {
    handlers['POST /v1/subscriptions/github-copilot/login'] = () =>
      jsonResponse(
        {
          providerId: 'github-copilot',
          status: 'failed',
          error: 'device flow refused',
        },
        201,
      );
    renderPage();
    await screen.findByText('GitHub Copilot');
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }));
    expect(await screen.findByText('device flow refused')).toBeInTheDocument();
  });

  it('discovers models from a preset and saves only the selected ones', async () => {
    handlers['POST /v1/providers/ollama-local/discover-models'] = () =>
      jsonResponse({ models: ['llama3.3:70b', 'qwen3-coder:480b-cloud'] });
    handlers['PUT /v1/providers/ollama-local'] = (init) =>
      jsonResponse({
        api: 'openai-completions',
        baseUrl: 'http://localhost:11434/v1',
        envName: 'OLLAMA_API_KEY',
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
        envName: 'OLLAMA_API_KEY',
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
