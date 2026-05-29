import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CreateTaskDialog } from '../src/components/tasks/CreateTaskDialog.js';
import { createTestWrapper } from './test-query-client.js';

function renderDialog(
  props?: Partial<React.ComponentProps<typeof CreateTaskDialog>>,
) {
  return render(
    <CreateTaskDialog
      open
      teamId="team-1"
      diaries={[{ id: 'diary-1', name: 'My Diary' }]}
      candidateTasks={[]}
      onClose={() => {}}
      onCreated={() => {}}
      {...props}
    />,
    { wrapper: createTestWrapper() },
  );
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

  it('renders the diary picker with the provided diaries', () => {
    renderDialog();
    expect(screen.getByLabelText(/diary/i)).toBeInTheDocument();
    expect(
      screen.getByRole('option', { name: 'My Diary' }),
    ).toBeInTheDocument();
  });
});
