import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MoltThemeProvider } from '@themoltnet/design-system';
import { describe, expect, it, vi } from 'vitest';

import {
  CreateTaskDialog,
  type CreateTaskRequest,
} from '../create-task-dialog.js';

function renderDialog(
  props?: Partial<React.ComponentProps<typeof CreateTaskDialog>>,
) {
  const onSubmit = props?.onSubmit ?? vi.fn().mockResolvedValue('task-1');
  const onCreated = props?.onCreated ?? vi.fn();
  render(
    <MoltThemeProvider mode="light">
      <CreateTaskDialog
        open
        teamId="team-1"
        diaries={[{ id: 'diary-1', name: 'My Diary' }]}
        candidateTasks={[]}
        availableTypes={['fulfill_brief', 'freeform']}
        onClose={() => {}}
        onSubmit={onSubmit}
        onCreated={onCreated}
        {...props}
      />
    </MoltThemeProvider>,
  );
  return { onSubmit, onCreated };
}

describe('CreateTaskDialog', () => {
  it('renders the freeform brief field and a create button', () => {
    renderDialog();
    expect(screen.getByLabelText(/brief/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /create task/i }),
    ).toBeInTheDocument();
  });

  it('disables submit until a brief is entered', () => {
    renderDialog();
    expect(screen.getByRole('button', { name: /create task/i })).toBeDisabled();
  });

  it('submits the assembled freeform request and reports the new id', async () => {
    const onSubmit = vi.fn().mockResolvedValue('new-task-id');
    const onCreated = vi.fn();
    renderDialog({ onSubmit, onCreated });

    fireEvent.change(screen.getByLabelText('Brief'), {
      target: { value: 'Do the thing' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create task/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const request = onSubmit.mock.calls[0][0] as CreateTaskRequest;
    expect(request.teamId).toBe('team-1');
    expect(request.diaryId).toBe('diary-1');
    expect(request.taskType).toBe('freeform');
    expect(request.input.brief).toBe('Do the thing');
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('new-task-id'));
  });

  it('submits task title and tags as top-level metadata', async () => {
    const onSubmit = vi.fn().mockResolvedValue('new-task-id');
    renderDialog({ onSubmit });

    fireEvent.change(screen.getByLabelText('Brief'), {
      target: { value: 'Do the thing' },
    });
    fireEvent.change(screen.getByLabelText(/title/i), {
      target: { value: 'Task cohort probe' },
    });
    fireEvent.change(screen.getByLabelText(/tags/i), {
      target: { value: 'observability, cohort, observability' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create task/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const request = onSubmit.mock.calls[0][0] as CreateTaskRequest;
    expect(request.title).toBe('Task cohort probe');
    expect(request.tags).toEqual(['observability', 'cohort']);
    expect(request.input).not.toHaveProperty('title');
  });

  it('shows an inline error when onSubmit rejects', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('Boom'));
    renderDialog({ onSubmit });

    fireEvent.change(screen.getByLabelText('Brief'), {
      target: { value: 'Will fail' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create task/i }));

    expect(await screen.findByText('Boom')).toBeInTheDocument();
  });

  it('includes authored success criteria in the request', async () => {
    const onSubmit = vi.fn().mockResolvedValue('t1');
    renderDialog({ onSubmit });

    fireEvent.change(screen.getByLabelText('Brief'), {
      target: { value: 'Gated task' },
    });
    // Success criteria is collapsed by default; reveal it.
    fireEvent.click(screen.getByRole('button', { name: /success criteria/i }));
    fireEvent.click(screen.getByRole('button', { name: /add assertion/i }));
    fireEvent.change(screen.getByLabelText('Assertion path'), {
      target: { value: 'commits.*.sha' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create task/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const request = onSubmit.mock.calls[0][0] as CreateTaskRequest;
    expect(request.input.successCriteria).toEqual({
      version: 1,
      assertions: [{ id: 'a1', path: 'commits.*.sha', op: 'exists' }],
    });
  });

  it('omits successCriteria when none authored', async () => {
    const onSubmit = vi.fn().mockResolvedValue('t1');
    renderDialog({ onSubmit });
    fireEvent.change(screen.getByLabelText('Brief'), {
      target: { value: 'Plain task' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create task/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const request = onSubmit.mock.calls[0][0] as CreateTaskRequest;
    expect(request.input.successCriteria).toBeUndefined();
  });

  it('omits execution from the payload when workspace stays default', async () => {
    const onSubmit = vi.fn().mockResolvedValue('task-1');
    renderDialog({ onSubmit });

    fireEvent.change(screen.getByLabelText('Brief'), {
      target: { value: 'probe' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create task/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const request = onSubmit.mock.calls[0][0] as CreateTaskRequest;
    expect(request.input.execution).toBeUndefined();
  });

  it('emits the chosen workspace mode in input.execution.workspace', async () => {
    const onSubmit = vi.fn().mockResolvedValue('task-1');
    renderDialog({ onSubmit });

    fireEvent.change(screen.getByLabelText('Brief'), {
      target: { value: 'scaffold candidate task type' },
    });
    fireEvent.change(screen.getByLabelText(/workspace/i), {
      target: { value: 'dedicated_worktree' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create task/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const request = onSubmit.mock.calls[0][0] as CreateTaskRequest;
    expect(request.input.execution).toEqual({
      workspace: 'dedicated_worktree',
    });
  });
});

describe('CreateTaskDialog continuation mode', () => {
  const continueFrom = {
    taskId: '11111111-1111-4111-8111-111111111111',
    attemptN: 2,
    sourceTitle: 'Round 1',
    correlationId: 'corr-1',
  };

  it('switches dialog title and submit label', () => {
    renderDialog({ continueFrom });

    expect(screen.getAllByText('Continue task').length).toBeGreaterThan(0);
    expect(
      screen.getByRole('button', { name: /continue task/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /create task/i }),
    ).not.toBeInTheDocument();
  });

  it('pre-fills title from the source attempt', () => {
    renderDialog({ continueFrom });
    expect(screen.getByLabelText(/title/i)).toHaveValue('Round 1');
  });

  it('hides workspace and depends-on fields', () => {
    renderDialog({ continueFrom });
    expect(screen.queryByLabelText(/workspace/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/depends on/i)).not.toBeInTheDocument();
  });

  it('packs continueFrom + parent-completed claim condition on submit', async () => {
    const onSubmit = vi.fn().mockResolvedValue('continuation-id');
    renderDialog({ continueFrom, onSubmit });

    fireEvent.change(screen.getByLabelText('Brief'), {
      target: { value: 'Next step' },
    });
    fireEvent.click(screen.getByRole('button', { name: /continue task/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const request = onSubmit.mock.calls[0][0] as CreateTaskRequest;
    expect(request.taskType).toBe('freeform');
    expect(request.correlationId).toBe('corr-1');
    expect(request.input.brief).toBe('Next step');
    expect(request.title).toBe('Round 1');
    expect(request.input).not.toHaveProperty('title');
    expect(request.input.execution).toBeUndefined();
    expect(request.input.continueFrom).toEqual({
      taskId: continueFrom.taskId,
      attemptN: 2,
    });
    expect(request.claimCondition).toEqual({
      op: 'task_status',
      taskId: continueFrom.taskId,
      statuses: ['completed'],
    });
  });
});
