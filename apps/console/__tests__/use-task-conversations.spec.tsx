import { act, renderHook, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useTaskConversations } from '../src/tasks/useTaskConversations.js';

const mocks = vi.hoisted(() => ({
  getTaskConversation: vi.fn(),
  useQuery: vi.fn(),
  watch: vi.fn(),
  refetch: vi.fn(),
}));

vi.mock('@moltnet/api-client', () => ({
  getTaskConversation: mocks.getTaskConversation,
}));

vi.mock('@moltnet/api-client/query', () => ({
  listTaskConversationsOptions: () => ({ queryKey: ['conversations'] }),
}));

vi.mock('@tanstack/react-query', () => ({ useQuery: mocks.useQuery }));

vi.mock('../src/tasks/conversation-stream.js', () => ({
  isLiveAttemptStatus: (status?: string) =>
    status === 'claimed' || status === 'running',
  watchConversationSnapshots: mocks.watch,
  readConversation: async (options: unknown) => {
    const response = await mocks.getTaskConversation(options);
    if (!response.data) throw new Error('read failed');
    return response.data;
  },
  isPermanentConversationError: () => false,
}));

const client = { kind: 'console-client' } as never;
const base = {
  client,
  teamId: 'team',
  taskId: 'task',
  attemptN: 1,
};

function snapshot(text: string, nextBeforeEntryId: string | null = null) {
  return {
    conversationId: '1',
    cursor: text,
    attemptStatus: 'running',
    live: {},
    nextBeforeEntryId,
    messages: [
      {
        id: '5/0',
        entryId: '5',
        entryKind: 'pi.message',
        inherited: false,
        status: 'completed',
        message: { role: 'assistant', content: [{ type: 'text', text }] },
      },
    ],
  };
}

describe('useTaskConversations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useQuery.mockReturnValue({
      refetch: mocks.refetch,
      data: {
        items: [
          { conversationId: '1', parentConversationId: null, kind: 'main' },
        ],
      },
    });
    mocks.watch.mockImplementation(() => new Promise(() => {}));
    mocks.getTaskConversation.mockResolvedValue({ data: snapshot('final') });
  });

  it('follows live attempts and aborts the stream on unmount', () => {
    const { unmount } = renderHook(() =>
      useTaskConversations({ ...base, attemptStatus: 'running' }),
    );

    expect(mocks.watch).toHaveBeenCalledTimes(1);
    const { signal, conversationId, teamId } = mocks.watch.mock.calls[0][0];
    expect({ conversationId, teamId }).toEqual({
      conversationId: '1',
      teamId: 'team',
    });
    expect(signal.aborted).toBe(false);

    unmount();

    expect(signal.aborted).toBe(true);
  });

  it('stops streaming and reads once when the attempt turns terminal', async () => {
    const { rerender, result } = renderHook(
      (status: string) =>
        useTaskConversations({ ...base, attemptStatus: status }),
      { initialProps: 'running' },
    );
    const { signal } = mocks.watch.mock.calls[0][0];

    rerender('completed');

    expect(signal.aborted).toBe(true);
    expect(mocks.watch).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(result.current.threads?.[0]?.messages).toHaveLength(1),
    );
    expect(mocks.getTaskConversation).toHaveBeenCalledTimes(1);
  });

  it('replaces messages with each snapshot', async () => {
    const { result } = renderHook(() =>
      useTaskConversations({ ...base, attemptStatus: 'running' }),
    );
    const { onSnapshot } = mocks.watch.mock.calls[0][0];

    onSnapshot(snapshot('first'));
    onSnapshot(snapshot('second'));

    await waitFor(() =>
      expect(result.current.threads?.[0]?.messages[0]?.message).toMatchObject({
        content: [{ text: 'second' }],
      }),
    );
    expect(result.current.threads?.[0]?.messages).toHaveLength(1);
  });

  it('loads older entries on demand with the snapshot cursor', async () => {
    mocks.getTaskConversation.mockResolvedValue({
      data: {
        ...snapshot('older'),
        nextBeforeEntryId: null,
        messages: [
          {
            ...snapshot('older').messages[0],
            id: '2/0',
            entryId: '2',
          },
        ],
      },
    });
    const { result } = renderHook(() =>
      useTaskConversations({ ...base, attemptStatus: 'running' }),
    );
    mocks.watch.mock.calls[0][0].onSnapshot(snapshot('latest', '5'));
    await waitFor(() =>
      expect(result.current.threads?.[0]?.onLoadOlder).toBeDefined(),
    );

    result.current.threads?.[0]?.onLoadOlder?.();

    await waitFor(() =>
      expect(result.current.threads?.[0]?.messages.map((m) => m.id)).toEqual([
        '2/0',
        '5/0',
      ]),
    );
    expect(mocks.getTaskConversation).toHaveBeenCalledWith(
      expect.objectContaining({ query: { beforeEntryId: '5' } }),
    );
    expect(result.current.threads?.[0]?.onLoadOlder).toBeUndefined();
  });

  it('reports no conversation for attempts without one', () => {
    mocks.useQuery.mockReturnValue({
      refetch: mocks.refetch,
      data: { items: [] },
    });

    const { result } = renderHook(() =>
      useTaskConversations({ ...base, attemptStatus: 'completed' }),
    );

    expect(result.current.threads).toEqual([]);
    expect(result.current.error).toBeUndefined();
    expect(mocks.watch).not.toHaveBeenCalled();
    expect(mocks.getTaskConversation).not.toHaveBeenCalled();
  });
  it('preserves a message leaving the live window while the first history read is pending', async () => {
    let resolve!: (value: unknown) => void;
    mocks.getTaskConversation.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const { result } = renderHook(() =>
      useTaskConversations({ ...base, attemptStatus: 'running' }),
    );
    const { onSnapshot } = mocks.watch.mock.calls[0][0];
    act(() => onSnapshot(snapshot('boundary', '5')));
    act(() => result.current.threads![0].onLoadOlder!());
    act(() =>
      onSnapshot({
        ...snapshot('advanced', '6'),
        messages: [
          { ...snapshot('advanced').messages[0], id: '6/0', entryId: '6' },
        ],
      }),
    );
    await act(async () =>
      resolve({
        data: {
          ...snapshot('older'),
          messages: [
            { ...snapshot('older').messages[0], id: '2/0', entryId: '2' },
          ],
        },
      }),
    );
    expect(
      result.current.threads![0].messages.map((message) => message.id),
    ).toEqual(['2/0', '5/0', '6/0']);
    expect(result.current.threads![0].onLoadOlder).toBeUndefined();
  });

  it('refreshes discovery when the stream reports completion even if the attempt prop stays running', async () => {
    const { result } = renderHook(() =>
      useTaskConversations({ ...base, attemptStatus: 'running' }),
    );
    act(() =>
      mocks.watch.mock.calls[0][0].onSnapshot({
        ...snapshot('done'),
        attemptStatus: 'completed',
      }),
    );
    await waitFor(() => expect(mocks.refetch).toHaveBeenCalledTimes(1));
    expect(mocks.watch.mock.calls[0][0].signal.aborted).toBe(true);
    expect(result.current.threads![0].messages).toHaveLength(1);
    expect(result.current.threads![0].live).toBe(false);
  });

  it('reads subagents only after expansion and aborts their pending read on collapse', async () => {
    mocks.useQuery.mockReturnValue({
      refetch: mocks.refetch,
      data: {
        items: [
          { conversationId: '1', kind: 'main', parentConversationId: null },
          { conversationId: '2', kind: 'subagent', parentConversationId: '1' },
          { conversationId: '3', kind: 'subagent', parentConversationId: '1' },
        ],
      },
    });
    mocks.getTaskConversation.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() =>
      useTaskConversations({ ...base, attemptStatus: 'running' }),
    );
    expect(mocks.watch).toHaveBeenCalledTimes(1);
    expect(mocks.getTaskConversation).not.toHaveBeenCalled();
    act(() => {
      result.current.threads![1].onExpandedChange!(true);
      result.current.threads![2].onExpandedChange!(true);
    });
    expect(mocks.getTaskConversation).toHaveBeenCalledTimes(1);
    const { signal } = mocks.getTaskConversation.mock.calls[0][0];
    act(() => {
      result.current.threads![1].onExpandedChange!(false);
      result.current.threads![2].onExpandedChange!(false);
    });
    expect(signal.aborted).toBe(true);
  });

  it('drops previous-attempt state and ignores its pending callbacks', () => {
    const { result, rerender } = renderHook(
      (attemptN: number) =>
        useTaskConversations({ ...base, attemptN, attemptStatus: 'running' }),
      { initialProps: 1 },
    );
    const old = mocks.watch.mock.calls[0][0];
    act(() => old.onSnapshot(snapshot('old')));
    rerender(2);
    act(() => old.onSnapshot(snapshot('late old')));
    expect(old.signal.aborted).toBe(true);
    expect(result.current.threads![0].messages).toEqual([]);
  });

  it.each([404, 503])('reports discovery %s and provides retry', (status) => {
    mocks.useQuery.mockReturnValue({
      refetch: mocks.refetch,
      error: { status },
    });
    const { result } = renderHook(() =>
      useTaskConversations({ ...base, attemptStatus: 'running' }),
    );
    expect(result.current.error).toBe('Conversations could not be loaded.');
    act(() => result.current.retry());
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
  });
  it('advances an empty history page and keeps history requests usable in StrictMode', async () => {
    mocks.getTaskConversation.mockResolvedValue({
      data: { ...snapshot('empty', '2'), messages: [] },
    });
    const { result } = renderHook(
      () => useTaskConversations({ ...base, attemptStatus: 'running' }),
      { wrapper: StrictMode },
    );
    act(() =>
      mocks.watch.mock.calls.at(-1)![0].onSnapshot(snapshot('latest', '5')),
    );
    act(() => result.current.threads![0].onLoadOlder!());
    await waitFor(() =>
      expect(result.current.threads![0].loadingOlder).toBe(false),
    );
    expect(mocks.getTaskConversation.mock.calls[0][0].signal.aborted).toBe(
      false,
    );
    act(() => result.current.threads![0].onLoadOlder!());
    expect(mocks.getTaskConversation.mock.calls[1][0].query).toEqual({
      beforeEntryId: '2',
    });
  });
  it.each([false, true])(
    'keeps a skipped window reachable with an in-flight history read: %s',
    async (inFlight) => {
      const page = (start: number, end: number, cursor: string | null) => ({
        ...snapshot('page', cursor),
        messages: Array.from({ length: end - start + 1 }, (_, i) => ({
          ...snapshot('page').messages[0],
          id: `${start + i}/0`,
          entryId: String(start + i),
        })),
      });
      let resolve!: (value: unknown) => void;
      mocks.getTaskConversation.mockReturnValueOnce(
        new Promise((done) => {
          resolve = done;
        }),
      );
      const { result } = renderHook(() =>
        useTaskConversations({ ...base, attemptStatus: 'running' }),
      );
      const { onSnapshot } = mocks.watch.mock.calls[0][0];
      act(() => onSnapshot(page(6, 105, '6')));
      act(() => result.current.threads![0].onLoadOlder!());
      if (!inFlight) await act(async () => resolve({ data: page(1, 5, null) }));
      act(() => onSnapshot(page(151, 250, '151')));
      if (inFlight) await act(async () => resolve({ data: page(1, 5, null) }));
      expect(result.current.threads![0].onLoadOlder).toBeDefined();
      mocks.getTaskConversation.mockResolvedValueOnce({
        data: page(51, 150, '51'),
      });
      act(() => result.current.threads![0].onLoadOlder!());
      await waitFor(() =>
        expect(result.current.threads![0].loadingOlder).toBe(false),
      );
      expect(mocks.getTaskConversation.mock.calls.at(-1)![0].query).toEqual({
        beforeEntryId: '151',
      });
      expect(
        result.current.threads![0].messages.map((m) => Number(m.entryId)),
      ).toEqual(Array.from({ length: 250 }, (_, i) => i + 1));
    },
  );
});
