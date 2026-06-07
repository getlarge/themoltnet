import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MoltThemeProvider } from '@themoltnet/design-system';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DashboardLayout } from '../src/layout/DashboardLayout.js';
import { Header } from '../src/layout/Header.js';
import { Sidebar } from '../src/layout/Sidebar.js';
import { TeamDetailPage } from '../src/pages/TeamDetailPage.js';

const testState = vi.hoisted(() => ({
  isMobile: false,
  isTablet: false,
  location: '/tasks',
  navigate: vi.fn(),
  search: '',
}));

const apiMocks = vi.hoisted(() => ({
  getTeam: vi.fn(),
  listDiaries: vi.fn(),
  listGroups: vi.fn(),
  listTeamInvites: vi.fn(),
}));

vi.mock('wouter', () => ({
  Link: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
  useLocation: () => [testState.location, testState.navigate],
  useSearch: () => testState.search,
}));

vi.mock('@moltnet/api-client', () => ({
  deleteGroup: vi.fn(),
  deleteTeamInvite: vi.fn(),
  getTeam: apiMocks.getTeam,
  listDiaries: apiMocks.listDiaries,
  listGroups: apiMocks.listGroups,
  listTeamInvites: apiMocks.listTeamInvites,
  removeTeamMember: vi.fn(),
  updateTeamMemberRole: vi.fn(),
}));

vi.mock('../src/auth/useAuth.js', () => ({
  useAuth: () => ({
    email: 'agent@example.com',
    logout: vi.fn(),
    username: 'agent',
  }),
}));

vi.mock('../src/api.js', () => ({
  getApiClient: () => ({}),
}));

vi.mock('../src/components/TeamSelector.js', () => ({
  TeamSelector: () => <div data-testid="team-selector" />,
}));

vi.mock('../src/config.js', () => ({
  getConfig: () => ({
    docsUrl: 'https://docs.example.com',
    kratosUrl: 'https://auth.example.com',
  }),
}));

vi.mock('../src/hooks/useIsMobile.js', () => ({
  useIsMobile: () => testState.isMobile,
  useIsTablet: () => testState.isTablet,
}));

vi.mock('../src/team/useTeam.js', () => ({
  useTeam: () => ({
    refreshTeams: vi.fn(),
    teams: [{ id: 'team-1', role: 'owner' }],
  }),
}));

function Wrapper({ children }: { children: ReactNode }) {
  return <MoltThemeProvider mode="dark">{children}</MoltThemeProvider>;
}

describe('console layout accessibility', () => {
  afterEach(() => {
    testState.isMobile = false;
    testState.isTablet = false;
    testState.location = '/tasks';
    testState.search = '';
    testState.navigate.mockReset();
    apiMocks.getTeam.mockReset();
    apiMocks.listDiaries.mockReset();
    apiMocks.listGroups.mockReset();
    apiMocks.listTeamInvites.mockReset();
    localStorage.clear();
  });

  it('exposes the sidebar toggle relationship and expanded state', () => {
    const onMenuClick = vi.fn();

    render(
      <Header
        menuControls="console-sidebar"
        menuExpanded={false}
        onMenuClick={onMenuClick}
        showMenuButton
      />,
      { wrapper: Wrapper },
    );

    const toggle = screen.getByRole('button', { name: 'Toggle sidebar' });

    expect(toggle.getAttribute('aria-controls')).toBe('console-sidebar');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(toggle);
    expect(onMenuClick).toHaveBeenCalledTimes(1);
  });

  it('labels primary navigation and marks the active route', () => {
    render(<Sidebar id="console-sidebar" />, { wrapper: Wrapper });

    expect(
      screen.getByRole('complementary', { name: 'Console navigation' }),
    ).toBeDefined();
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeDefined();

    const tasks = screen.getByRole('button', { name: 'Tasks' });
    expect(tasks.getAttribute('aria-current')).toBe('page');
  });

  it('keeps collapsed navigation buttons named beyond their initials', () => {
    render(<Sidebar collapsed id="console-sidebar" />, { wrapper: Wrapper });

    expect(screen.getByRole('button', { name: 'Tasks' }).textContent).toBe('T');
    expect(
      screen.getByRole('button', { name: 'Documentation' }).textContent,
    ).toBe('D');
    expect(screen.getByRole('button', { name: 'Settings' }).textContent).toBe(
      'S',
    );
  });

  it('renders a skip link targeting focusable main content', async () => {
    render(
      <DashboardLayout>
        <h1>Tasks</h1>
      </DashboardLayout>,
      { wrapper: Wrapper },
    );

    const skipLink = screen.getByRole('link', {
      name: 'Skip to main content',
    });
    const main = screen.getByRole('main');

    expect(skipLink.getAttribute('href')).toBe('#main-content');
    expect(main.getAttribute('id')).toBe('main-content');
    expect(main.getAttribute('tabindex')).toBe('-1');

    await waitFor(() => expect(document.activeElement).toBe(main));
  });

  it('focuses main content and closes mobile navigation after route changes', async () => {
    testState.isMobile = true;

    const { rerender } = render(
      <DashboardLayout>
        <h1>Tasks</h1>
      </DashboardLayout>,
      { wrapper: Wrapper },
    );

    fireEvent.click(screen.getByRole('button', { name: 'Toggle sidebar' }));
    expect(
      screen.getByRole('dialog', { name: 'Navigation menu' }),
    ).toBeDefined();

    testState.location = '/diaries';
    rerender(
      <Wrapper>
        <DashboardLayout>
          <h1>Diaries</h1>
        </DashboardLayout>
      </Wrapper>,
    );

    const main = screen.getByRole('main');

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Navigation menu' })).toBe(
        null,
      ),
    );
    expect(document.activeElement).toBe(main);
  });

  it('exposes the mobile navigation drawer as a modal dialog', () => {
    testState.isMobile = true;

    render(
      <DashboardLayout>
        <h1>Tasks</h1>
      </DashboardLayout>,
      { wrapper: Wrapper },
    );

    const toggle = screen.getByRole('button', { name: 'Toggle sidebar' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(toggle);

    const dialog = screen.getByRole('dialog', { name: 'Navigation menu' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(screen.getByRole('complementary').getAttribute('id')).toBe(
      'console-sidebar',
    );
    expect(toggle.getAttribute('aria-controls')).toBe('console-sidebar');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });

  it('links team tabs to their panels', async () => {
    apiMocks.getTeam.mockResolvedValue({
      data: {
        id: 'team-1',
        members: [
          {
            displayName: 'Agent One',
            email: 'agent@example.com',
            fingerprint: 'abc123',
            role: 'owner',
            subjectId: 'agent-1',
            subjectType: 'Agent',
          },
        ],
        name: 'Team One',
        personal: false,
      },
    });
    apiMocks.listDiaries.mockResolvedValue({ data: { items: [] } });
    apiMocks.listGroups.mockResolvedValue({ data: { items: [] } });
    apiMocks.listTeamInvites.mockResolvedValue({ data: { items: [] } });

    render(<TeamDetailPage id="team-1" />, { wrapper: Wrapper });

    expect(
      await screen.findByRole('tablist', { name: 'Team sections' }),
    ).toBeDefined();

    const membersTab = screen.getByRole('tab', { name: 'Members' });
    const groupsTab = screen.getByRole('tab', { name: 'Groups' });
    const diariesTab = screen.getByRole('tab', { name: 'Diaries' });
    const invitesTab = screen.getByRole('tab', { name: 'Invites' });

    expect(membersTab.getAttribute('aria-selected')).toBe('true');
    expect(membersTab.getAttribute('aria-controls')).toBe('team-members-panel');
    expect(groupsTab.getAttribute('aria-controls')).toBe('team-groups-panel');
    expect(diariesTab.getAttribute('aria-controls')).toBe('team-diaries-panel');
    expect(invitesTab.getAttribute('aria-controls')).toBe('team-invites-panel');
    expect(document.getElementById('team-members-panel')?.role).toBe(
      'tabpanel',
    );
  });
});
