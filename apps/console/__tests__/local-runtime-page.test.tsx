import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { MoltThemeProvider } from '@themoltnet/design-system';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LocalRuntimePage } from '../src/pages/LocalRuntimePage.js';

const mocks = vi.hoisted(() => ({
  createAgent: vi.fn(),
  disconnect: vi.fn(),
  pair: vi.fn(),
  putProvider: vi.fn(),
  retry: vi.fn(),
  startRun: vi.fn(),
  stopRun: vi.fn(),
  streamLogs: vi.fn(),
  runtime: {} as Record<string, unknown>,
}));

vi.mock('@moltnet/api-client/query', () => ({
  listRuntimeProfilesOptions: () => ({ queryKey: ['profiles'] }),
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: { items: [] } }),
}));

vi.mock('../src/api.js', () => ({
  getApiClient: () => ({ kind: 'test-client' }),
}));

vi.mock('../src/team/useTeam.js', () => ({
  useTeam: () => ({
    selectedTeam: { id: 'team-1', name: 'Team', role: 'owner' },
  }),
}));

vi.mock('../src/runtime-local/useLocalRuntime.js', () => ({
  useLocalRuntime: () => mocks.runtime,
}));

function renderPage() {
  return render(
    <MoltThemeProvider mode="dark">
      <LocalRuntimePage />
    </MoltThemeProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const action of [
    mocks.createAgent,
    mocks.putProvider,
    mocks.startRun,
    mocks.stopRun,
  ]) {
    action.mockResolvedValue(undefined);
  }
  mocks.streamLogs.mockImplementation(
    (_runId: string, _onLine: (line: string) => void, signal: AbortSignal) =>
      new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => resolve(), { once: true });
      }),
  );
  Object.assign(mocks.runtime, {
    status: 'connected',
    serveUrl: 'http://127.0.0.1:17374',
    actionError: null,
    connectionError: null,
    pairingApprovalUrl: null,
    pair: mocks.pair,
    retry: mocks.retry,
    disconnect: mocks.disconnect,
    createAgent: mocks.createAgent,
    putProvider: mocks.putProvider,
    startRun: mocks.startRun,
    stopRun: mocks.stopRun,
    streamLogs: mocks.streamLogs,
    data: {
      version: 'test',
      platform: 'darwin',
      agents: [
        {
          kind: 'managed',
          agentName: 'course-bot',
          createdAt: 't',
          fingerprint: 'FP-1',
        },
      ],
      providers: {},
      runs: [
        {
          id: 'run-1',
          agent: 'course-bot',
          teamId: 'team-1',
          profiles: ['profile-1'],
          taskTypes: ['freeform'],
          mode: 'poll',
          status: 'running',
          startedAt: 't',
          active: true,
        },
      ],
    },
  });
});

afterEach(() => vi.useRealTimers());

describe('LocalRuntimePage', () => {
  it('opens fallback pairing approval without an opener', () => {
    Object.assign(mocks.runtime, {
      status: 'pairing',
      data: undefined,
      pairingApprovalUrl: 'http://127.0.0.1:17374/pairings/pair-1',
    });
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Open approval' }));

    expect(open).toHaveBeenCalledWith(
      'http://127.0.0.1:17374/pairings/pair-1',
      '_blank',
      'popup,noopener,noreferrer',
    );
  });

  it('keeps enrollment/provider secrets write-only across submissions', async () => {
    mocks.createAgent.mockRejectedValueOnce(new Error('registration failed'));
    renderPage();
    const enrollment = screen.getByLabelText('Enrollment token (optional)');
    expect(enrollment).toHaveAttribute('type', 'password');
    fireEvent.change(screen.getByLabelText('Agent name'), {
      target: { value: 'new-bot' },
    });
    fireEvent.change(enrollment, { target: { value: 'join-secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create identity' }));

    await waitFor(() =>
      expect(mocks.createAgent).toHaveBeenCalledWith({
        kind: 'managed',
        name: 'new-bot',
        enrollmentToken: 'join-secret',
      }),
    );
    await waitFor(() => expect(enrollment).toHaveValue(''));

    fireEvent.change(screen.getByLabelText('Models (comma-separated)'), {
      target: { value: 'model-a, model-b' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save provider' }));
    await waitFor(() =>
      expect(mocks.putProvider).toHaveBeenLastCalledWith('ollama', {
        api: 'openai-completions',
        baseUrl: 'https://ollama.com/v1',
        envName: 'OLLAMA_API_KEY',
        models: ['model-a', 'model-b'],
      }),
    );

    fireEvent.change(screen.getByLabelText('API key'), {
      target: { value: 'provider-secret' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save provider' }));
    await waitFor(() =>
      expect(mocks.putProvider).toHaveBeenLastCalledWith(
        'ollama',
        expect.objectContaining({ apiKey: 'provider-secret' }),
      ),
    );
    await waitFor(() =>
      expect(screen.getByLabelText('API key')).toHaveValue(''),
    );
  });

  it('starts, stops, and tears down a selected run log stream', async () => {
    renderPage();
    fireEvent.change(screen.getByLabelText('Agent'), {
      target: { value: 'course-bot' },
    });
    fireEvent.change(screen.getByLabelText('Runtime profile'), {
      target: { value: 'profile-1' },
    });
    fireEvent.change(screen.getByLabelText('Task types'), {
      target: { value: 'freeform, fulfill_brief' },
    });
    fireEvent.change(screen.getByLabelText('Mode'), {
      target: { value: 'drain' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Start run' }));

    await waitFor(() =>
      expect(mocks.startRun).toHaveBeenCalledWith({
        agent: 'course-bot',
        teamId: 'team-1',
        profiles: ['profile-1'],
        taskTypes: ['freeform', 'fulfill_brief'],
        mode: 'drain',
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(mocks.stopRun).toHaveBeenCalledWith('run-1');

    fireEvent.click(screen.getByRole('button', { name: 'Logs' }));
    await waitFor(() => expect(mocks.streamLogs).toHaveBeenCalled());
    const signal = mocks.streamLogs.mock.calls[0]?.[2] as AbortSignal;
    expect(signal.aborted).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Hide logs' }));
    expect(signal.aborted).toBe(true);
  });

  it('replaces a failed log snapshot when automatic retry reconnects', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mocks.streamLogs
      .mockImplementationOnce(
        (_runId: string, onLine: (line: string) => void) => {
          onLine('stale replay');
          return Promise.reject(new Error('stream offline'));
        },
      )
      .mockImplementation(
        (
          _runId: string,
          onLine: (line: string) => void,
          signal: AbortSignal,
        ) => {
          onLine('fresh replay');
          return new Promise<void>((resolve) => {
            signal.addEventListener('abort', () => resolve(), { once: true });
          });
        },
      );
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Logs' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'stream offline Retrying in 1s',
      ),
    );
    await act(() => vi.advanceTimersByTimeAsync(1_100));
    await waitFor(() => expect(mocks.streamLogs).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByLabelText('Logs for run run-1')).toHaveTextContent(
      'fresh replay',
    );
    expect(screen.getByLabelText('Logs for run run-1')).not.toHaveTextContent(
      'stale replay',
    );
  });
});
