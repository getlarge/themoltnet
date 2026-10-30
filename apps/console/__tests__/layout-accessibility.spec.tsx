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

    const toggle = screen.getByRole('button', { name: 'Expand sidebar' });

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

    const tasks = screen.getByRole('link', { name: 'Task board' });
    expect(tasks.getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Signing' })).toBeInTheDocument();
  });

  it('keeps signing discoverable when the local companion is offline', () => {
    testState.location = '/signing';

    render(<Sidebar id="console-sidebar" />, { wrapper: Wrapper });

    const signing = screen.getByRole('link', { name: 'Signing' });
    expect(signing).toHaveAttribute('aria-current', 'page');
  });

  it('groups runtime profiles, policies, and keys under Agent Runtime', () => {
    testState.location = '/runtime/agent-keys';

    render(<Sidebar id="console-sidebar" />, { wrapper: Wrapper });

    expect(
      screen.getByRole('region', { name: 'Agent Runtime' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Agent keys' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: 'Profiles' })).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Tool policies' }),
    ).toBeInTheDocument();
  });

  it('keeps collapsed navigation links and actions named', () => {
    render(<Sidebar collapsed id="console-sidebar" />, { wrapper: Wrapper });

    expect(
      screen.getByRole('link', { name: 'Task board' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Documentation' }).textContent,
    ).toBe('');
    expect(screen.getByRole('button', { name: 'Settings' }).textContent).toBe(
      '',
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

  it('keeps scrolling inside the viewport-bound application shell', () => {
    render(
      <DashboardLayout>
        <div style={{ height: '200vh' }}>Long page</div>
      </DashboardLayout>,
      { wrapper: Wrapper },
    );

    const main = screen.getByRole('main');
    const shell = main.parentElement?.parentElement;
    const sidebar = screen.getByRole('complementary', {
      name: 'Console navigation',
    });

    expect(shell).not.toBeNull();
    expect(shell).toHaveStyle({ height: '100dvh', overflow: 'hidden' });
    expect(main).toHaveStyle({
      minHeight: '0',
      overflowX: 'auto',
      overflowY: 'auto',
    });
    expect(sidebar).toHaveStyle({ height: '100%', minHeight: '0' });
  });

  it('allows tablet operators to expand the compact sidebar', () => {
    testState.isTablet = true;

    render(
      <DashboardLayout>
        <h1>Tasks</h1>
      </DashboardLayout>,
      { wrapper: Wrapper },
    );

    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));

    expect(
      screen.getByRole('button', { name: 'Collapse sidebar' }),
    ).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('team-selector')).toBeInTheDocument();
  });

  it('focuses main content and closes mobile navigation after route changes', async () => {
    testState.isMobile = true;

    const { rerender } = render(
      <DashboardLayout>
        <h1>Tasks</h1>
      </DashboardLayout>,
      { wrapper: Wrapper },
    );

    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));
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

    const toggle = screen.getByRole('button', { name: 'Expand sidebar' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(toggle);

    const dialog = screen.getByRole('dialog', { name: 'Navigation menu' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(screen.getByRole('complementary').getAttribute('id')).toBe(
      'console-sidebar',
    );
    expect(toggle.getAttribute('aria-controls')).toBe('console-sidebar');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(
      document.getElementById('main-content')?.parentElement,
    ).toHaveAttribute('inert');
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('closes the mobile drawer with Escape and restores the menu trigger', async () => {
    testState.isMobile = true;

    render(
      <DashboardLayout>
        <h1>Tasks</h1>
      </DashboardLayout>,
      { wrapper: Wrapper },
    );

    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    expect(
      screen.getByRole('dialog', { name: 'Navigation menu' }),
    ).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Navigation menu' }),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.getByRole('button', { name: 'Expand sidebar' }),
    ).toHaveFocus();
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
