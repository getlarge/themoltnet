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

  it('shows an inline error when onSubmit rejects', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('Boom'));
    renderDialog({ onSubmit });

    fireEvent.change(screen.getByLabelText('Brief'), {
      target: { value: 'Will fail' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create task/i }));

    expect(await screen.findByText('Boom')).toBeInTheDocument();
  });
});
