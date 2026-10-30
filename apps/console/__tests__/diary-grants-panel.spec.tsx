import { fireEvent, render, screen, within } from '@testing-library/react';
import { MoltThemeProvider } from '@themoltnet/design-system';
import type { ComponentProps, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DiaryGrantsPanel } from '../src/components/teams/DiaryGrantsPanel.js';

const mocks = vi.hoisted(() => ({ revokeDiaryGrant: vi.fn() }));

vi.mock('@moltnet/api-client', () => ({
  revokeDiaryGrant: (...args: unknown[]) => mocks.revokeDiaryGrant(...args),
}));

vi.mock('../src/api.js', () => ({ getApiClient: () => ({}) }));

function Wrapper({ children }: { children: ReactNode }) {
  return <MoltThemeProvider mode="dark">{children}</MoltThemeProvider>;
}

type Grants = ComponentProps<typeof DiaryGrantsPanel>['grants'];

// Heterogeneous grants across all three subject namespaces and both roles.
const grants = [
  { subjectId: 'ag1', subjectNs: 'Agent', role: 'writer' },
  { subjectId: 'hu1', subjectNs: 'Human', role: 'manager' },
  { subjectId: 'gr1', subjectNs: 'Group', role: 'writer' },
] as unknown as Grants;

const resolveSubject: ComponentProps<
  typeof DiaryGrantsPanel
>['resolveSubject'] = (subjectId, subjectNs) => ({
  id: subjectId,
  type: subjectNs,
  label: `subj-${subjectId}`,
});

function setup(canManage: boolean) {
  const onChange = vi.fn();
  render(
    <DiaryGrantsPanel
      diaryId="diary-1"
      diaryName="Project memory"
      grants={grants}
      resolveSubject={resolveSubject}
      canManage={canManage}
      onChange={onChange}
      onGrantClick={vi.fn()}
    />,
    { wrapper: Wrapper },
  );
  return { onChange };
}

describe('DiaryGrantsPanel', () => {
  beforeEach(() => {
    mocks.revokeDiaryGrant.mockReset();
    mocks.revokeDiaryGrant.mockResolvedValue({ data: {} });
  });

  it('renders every grant with its subject and namespace type', () => {
    setup(true);
    expect(screen.getByText('subj-ag1')).toBeInTheDocument();
    expect(screen.getByText('subj-hu1')).toBeInTheDocument();
    expect(screen.getByText('subj-gr1')).toBeInTheDocument();
    expect(screen.getByText('Agent')).toBeInTheDocument();
    expect(screen.getByText('Human')).toBeInTheDocument();
    expect(screen.getByText('Group')).toBeInTheDocument();
  });

  it('shows no Revoke controls to a caller who cannot manage grants', () => {
    setup(false);
    expect(
      screen.queryByRole('button', { name: 'Revoke' }),
    ).not.toBeInTheDocument();
  });

  it('revokes exactly the grant whose row was actioned', async () => {
    setup(true);

    // Revoke the Agent/writer grant specifically (not the human or group one).
    const agentRow = screen.getByText('subj-ag1').closest('tr');
    expect(agentRow).not.toBeNull();
    fireEvent.click(
      within(agentRow as HTMLElement).getByRole('button', { name: 'Revoke' }),
    );

    // Confirm in the dialog.
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Revoke' }));

    expect(mocks.revokeDiaryGrant).toHaveBeenCalledTimes(1);
    expect(mocks.revokeDiaryGrant).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { id: 'diary-1' },
        body: { subjectId: 'ag1', subjectNs: 'Agent', role: 'writer' },
      }),
    );
  });
});
