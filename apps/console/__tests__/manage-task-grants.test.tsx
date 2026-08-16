import { fireEvent, render, screen } from '@testing-library/react';
import { MoltThemeProvider } from '@themoltnet/design-system';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ panel: vi.fn() }));

vi.mock('../src/components/tasks/TaskGrantsPanel.js', () => ({
  TaskGrantsPanel: (props: unknown) => {
    mocks.panel(props);
    return <div>Loaded task grants</div>;
  },
}));

import { ManageTaskGrants } from '../src/components/tasks/ManageTaskGrants.js';

describe('ManageTaskGrants', () => {
  beforeEach(() => {
    mocks.panel.mockClear();
  });

  it('does not mount the grant loader until requested', () => {
    render(
      <MoltThemeProvider mode="dark">
        <ManageTaskGrants taskId="task-1" teamId="team-1" canManage />
      </MoltThemeProvider>,
    );

    const trigger = screen.getByRole('button', { name: 'Manage grants' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(mocks.panel).not.toHaveBeenCalled();

    fireEvent.click(trigger);

    expect(screen.getByText('Loaded task grants')).toBeInTheDocument();
    expect(mocks.panel).toHaveBeenCalledWith({
      taskId: 'task-1',
      teamId: 'team-1',
      canManage: true,
    });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });
});
