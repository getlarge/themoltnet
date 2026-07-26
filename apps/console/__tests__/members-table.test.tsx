import { fireEvent, render, screen } from '@testing-library/react';
import { MoltThemeProvider } from '@themoltnet/design-system';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  MembersTable,
  type MemberTableEntry,
} from '../src/components/teams/MembersTable.js';

function Wrapper({ children }: { children: ReactNode }) {
  return <MoltThemeProvider mode="dark">{children}</MoltThemeProvider>;
}

const alice: MemberTableEntry = {
  subjectId: 'a',
  subjectType: 'human',
  displayName: 'Alice',
  email: 'alice@example.test',
  role: 'member',
};
const bob: MemberTableEntry = {
  subjectId: 'b',
  subjectType: 'human',
  displayName: 'Bob',
  email: 'bob@example.test',
  role: 'manager',
};

function setup(overrides: Partial<Parameters<typeof MembersTable>[0]> = {}) {
  const onRoleAction = vi.fn();
  const onRemove = vi.fn();
  render(
    <MembersTable
      members={[alice, bob]}
      // Alice can be promoted; Bob can be demoted.
      roleActionLabel={(m) =>
        m.subjectId === 'a' ? 'Promote to manager' : 'Demote to member'
      }
      // Only Alice is removable — capability differs per member.
      canRemove={(m) => m.subjectId === 'a'}
      updatingMemberId={null}
      onRoleAction={onRoleAction}
      onRemove={onRemove}
      {...overrides}
    />,
    { wrapper: Wrapper },
  );
  return { onRoleAction, onRemove };
}

describe('MembersTable', () => {
  it('renders each member on its own row', () => {
    setup();
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('routes the role action to the exact member clicked', () => {
    const { onRoleAction } = setup();

    fireEvent.click(screen.getByRole('button', { name: 'Promote to manager' }));
    expect(onRoleAction).toHaveBeenCalledTimes(1);
    expect(onRoleAction).toHaveBeenCalledWith(alice);

    fireEvent.click(screen.getByRole('button', { name: 'Demote to member' }));
    expect(onRoleAction).toHaveBeenLastCalledWith(bob);
  });

  it('only offers Remove for members the caller can remove, and routes it to that member', () => {
    const { onRemove } = setup();

    const removeButtons = screen.getAllByRole('button', { name: 'Remove' });
    // Bob (canRemove=false) has no Remove control.
    expect(removeButtons).toHaveLength(1);

    fireEvent.click(removeButtons[0]!);
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledWith(alice);
  });

  it('shows the pending state only on the member being updated', () => {
    setup({ updatingMemberId: 'a' });

    const updating = screen.getByRole('button', { name: 'Updating...' });
    expect(updating).toBeDisabled();
    // Bob is unaffected — his action still reads normally and is enabled.
    const bobAction = screen.getByRole('button', { name: 'Demote to member' });
    expect(bobAction).toBeEnabled();
  });

  it('omits the role-action control when there is no label for a member', () => {
    const onRoleAction = vi.fn();
    render(
      <MembersTable
        members={[alice]}
        roleActionLabel={() => undefined}
        canRemove={() => false}
        updatingMemberId={null}
        onRoleAction={onRoleAction}
        onRemove={vi.fn()}
      />,
      { wrapper: Wrapper },
    );
    expect(
      screen.queryByRole('button', { name: /promote|demote/i }),
    ).not.toBeInTheDocument();
  });
});
