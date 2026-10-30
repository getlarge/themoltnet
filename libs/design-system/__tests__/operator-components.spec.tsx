import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  DescriptionList,
  EmptyState,
  InlineNotice,
  MoltThemeProvider,
  PageHeader,
  RecordTrace,
  Select,
  SideNavigation,
} from '../src/index.js';

function renderWithTheme(ui: React.ReactElement) {
  return render(<MoltThemeProvider>{ui}</MoltThemeProvider>);
}

describe('operator design-system components', () => {
  it('renders grouped semantic navigation with a current link', () => {
    const onNavigate = vi.fn((_, event: React.MouseEvent) =>
      event.preventDefault(),
    );
    renderWithTheme(
      <SideNavigation
        groups={[
          {
            id: 'tasks',
            label: 'Task Engine',
            items: [
              {
                id: 'board',
                label: 'Task board',
                href: '/tasks',
                current: true,
              },
            ],
          },
        ]}
        onNavigate={onNavigate}
      />,
    );

    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeDefined();
    expect(screen.getByRole('region', { name: 'Task Engine' })).toBeDefined();
    const link = screen.getByRole('link', { name: 'Task board' });
    expect(link).toHaveAttribute('aria-current', 'page');
    fireEvent.click(link);
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it('keeps collapsed links named while hiding their visible label', () => {
    renderWithTheme(
      <SideNavigation
        collapsed
        groups={[
          {
            id: 'runtime',
            label: 'Agent Runtime',
            items: [
              {
                id: 'profiles',
                label: 'Profiles',
                href: '/profiles',
                icon: 'R',
              },
            ],
          },
        ]}
      />,
    );

    expect(screen.getByRole('link', { name: 'Profiles' })).toHaveAttribute(
      'title',
      'Profiles',
    );
  });

  it('renders one page heading and semantic metadata', () => {
    renderWithTheme(
      <>
        <PageHeader
          eyebrow="Task Engine"
          title="Execution record"
          description="Inspect the evidence attached to this task."
        />
        <DescriptionList
          ariaLabel="Task evidence"
          items={[
            { label: 'Policy snapshot', value: 'sha256:abc', mono: true },
          ]}
        />
      </>,
    );

    expect(
      screen.getByRole('heading', { level: 1, name: 'Execution record' }),
    ).toBeDefined();
    expect(screen.getByRole('term')).toHaveTextContent('Policy snapshot');
    expect(screen.getByRole('definition')).toHaveTextContent('sha256:abc');
  });

  it('exposes a labelled trace with textual state', () => {
    renderWithTheme(
      <RecordTrace
        ariaLabel="Task execution record"
        steps={[
          {
            id: 'claim',
            label: 'Claim',
            context: 'Identity & Authority',
            status: 'Accepted',
            statusTone: 'identity',
            details: [{ label: 'Agent', value: 'legreffier' }],
          },
        ]}
      />,
    );

    expect(
      screen.getByRole('list', { name: 'Task execution record' }),
    ).toBeDefined();
    expect(screen.getByText('Accepted')).toBeVisible();
  });

  it('connects select hints and errors to the native control', () => {
    renderWithTheme(
      <Select label="Attempt" hint="Choose an attempt" error="Unavailable">
        <option value="1">Attempt 1</option>
      </Select>,
    );

    const select = screen.getByRole('combobox', { name: 'Attempt' });
    expect(select).toHaveAttribute('aria-invalid', 'true');
    expect(select.getAttribute('aria-describedby')?.split(' ')).toHaveLength(2);
  });

  it('provides explicit empty and error states', () => {
    renderWithTheme(
      <>
        <EmptyState title="No tasks" description="Create a task to begin." />
        <InlineNotice tone="error" title="Runtime unavailable">
          Retry the profile query.
        </InlineNotice>
      </>,
    );

    expect(screen.getByText('No tasks')).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Retry the profile query',
    );
  });
});
