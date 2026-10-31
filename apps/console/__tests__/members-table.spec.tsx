import { fireEvent, render, screen } from '@testing-library/react';
import { MoltThemeProvider } from '@themoltnet/design-system';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  editableTeamRoleOptions,
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
const charlie: MemberTableEntry = {
  subjectId: 'c',
  subjectType: 'agent',
  displayName: 'Charlie Agent',
  fingerprint: 'aaaa-bbbb-cccc-dddd',
  role: 'executor',
};
const olivia: MemberTableEntry = {
  subjectId: 'o',
  subjectType: 'human',
  displayName: 'Olivia Owner',
  role: 'owner',
};

function setup(overrides: Partial<Parameters<typeof MembersTable>[0]> = {}) {
  const onRoleChange = vi.fn();
  const onRemove = vi.fn();
  render(
    <MembersTable
      members={[alice, bob, charlie, olivia]}
      roleOptions={editableTeamRoleOptions}
      // Only Alice is removable — capability differs per member.
      canRemove={(m) => m.subjectId === 'a'}
      updatingMemberId={null}
      onRoleChange={onRoleChange}
      onRemove={onRemove}
      {...overrides}
    />,
    { wrapper: Wrapper },
  );
  return { onRoleChange, onRemove };
}

describe('MembersTable', () => {
  it('renders each member on its own row', () => {
    setup();
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(
      screen.getByRole('combobox', { name: 'Role for Charlie Agent' }),
    ).toBeInTheDocument();
  });

  it('offers executor only to agents and routes the selected role', () => {
    const { onRoleChange } = setup();

    const humanRole = screen.getByRole('combobox', { name: 'Role for Alice' });
    expect(humanRole).toHaveTextContent('Member');
    expect(humanRole).toHaveTextContent('Manager');
    expect(humanRole).not.toHaveTextContent('Executor');

    const agentRole = screen.getByRole('combobox', {
      name: 'Role for Charlie Agent',
    });
    expect(agentRole).toHaveTextContent('Executor');
    fireEvent.change(agentRole, { target: { value: 'manager' } });
    expect(onRoleChange).toHaveBeenCalledWith(charlie, 'manager');
  });

  it('keeps owners read-only', () => {
    setup();
    expect(
      screen.queryByRole('combobox', { name: 'Role for Olivia Owner' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('owner')).toBeInTheDocument();
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

    const updating = screen.getByRole('combobox', { name: 'Role for Alice' });
    expect(updating).toBeDisabled();
    const bobAction = screen.getByRole('combobox', { name: 'Role for Bob' });
    expect(bobAction).toBeEnabled();
  });

  it('omits the role selector when there are no allowed role options', () => {
    const onRoleChange = vi.fn();
    render(
      <MembersTable
        members={[alice]}
        roleOptions={() => []}
        canRemove={() => false}
        updatingMemberId={null}
        onRoleChange={onRoleChange}
        onRemove={vi.fn()}
      />,
      { wrapper: Wrapper },
    );
    expect(
      screen.queryByRole('combobox', { name: /role for/i }),
    ).not.toBeInTheDocument();
  });
});
