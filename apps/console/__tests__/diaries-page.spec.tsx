import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MoltThemeProvider } from '@themoltnet/design-system';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DiariesPage } from '../src/pages/DiariesPage.js';

const createDiary = vi.fn();
const refetchDiaries = vi.fn();
const refreshTeams = vi.fn();
const navigate = vi.fn();

vi.mock('@moltnet/api-client', () => ({
  createDiary: (...args: unknown[]) => createDiary(...args),
}));

vi.mock('wouter', () => ({
  Link: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
  useLocation: () => ['/diaries', navigate],
}));

vi.mock('../src/api.js', () => ({
  getApiClient: () => ({}),
}));

vi.mock('../src/diaries/hooks.js', () => ({
  useDiarySummaries: () => ({
    data: [],
    isLoading: false,
    error: null,
    refetch: refetchDiaries,
  }),
}));

vi.mock('../src/team/useTeam.js', () => ({
  useTeam: () => ({
    error: null,
    refreshTeams,
    selectedTeam: {
      id: 'team-1',
      name: 'Team One',
      personal: false,
      status: 'active',
      role: 'owner',
    },
  }),
}));

function Wrapper({ children }: { children: ReactNode }) {
  return <MoltThemeProvider mode="dark">{children}</MoltThemeProvider>;
}

describe('DiariesPage', () => {
  beforeEach(() => {
    createDiary.mockReset();
    createDiary.mockResolvedValue({
      data: {
        id: 'diary-1',
        name: 'Project notes',
        visibility: 'private',
        teamId: 'team-1',
      },
    });
    refetchDiaries.mockReset();
    refetchDiaries.mockResolvedValue({});
    refreshTeams.mockReset();
    refreshTeams.mockResolvedValue(undefined);
    navigate.mockReset();
  });

  it('creates a diary in the selected team and opens it', async () => {
    render(<DiariesPage />, { wrapper: Wrapper });

    fireEvent.click(screen.getByRole('button', { name: 'Create diary' }));
    fireEvent.change(screen.getByLabelText('Diary name'), {
      target: { value: 'Project notes' },
    });
    fireEvent.change(screen.getByLabelText('Visibility'), {
      target: { value: 'moltnet' },
    });
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Create diary' }).at(-1)!,
    );

    await waitFor(() => {
      expect(createDiary).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: { 'x-moltnet-team-id': 'team-1' },
          body: { name: 'Project notes', visibility: 'moltnet' },
        }),
      );
    });
    expect(refetchDiaries).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('/diaries/diary-1');
  });
});
