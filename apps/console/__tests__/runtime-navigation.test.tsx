import { fireEvent, render, screen } from '@testing-library/react';
import { MoltThemeProvider } from '@themoltnet/design-system';
import { type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RuntimeNavigation } from '../src/components/RuntimeNavigation.js';

const routerState = vi.hoisted(() => ({
  location: '/runtime/profiles',
  navigate: vi.fn(),
}));

vi.mock('wouter', () => ({
  useLocation: () => [routerState.location, routerState.navigate],
}));

function Wrapper({ children }: { children: ReactNode }) {
  return <MoltThemeProvider mode="dark">{children}</MoltThemeProvider>;
}

describe('RuntimeNavigation', () => {
  afterEach(() => {
    routerState.location = '/runtime/profiles';
    routerState.navigate.mockReset();
  });

  it('marks the deep-linked section and routes all three controls', () => {
    routerState.location = '/runtime/policies';
    render(<RuntimeNavigation />, { wrapper: Wrapper });

    expect(screen.getByRole('button', { name: 'Policies' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(
      screen.getByRole('button', { name: 'Profiles' }),
    ).not.toHaveAttribute('aria-current');

    fireEvent.click(screen.getByRole('button', { name: 'Profiles' }));
    fireEvent.click(screen.getByRole('button', { name: 'Policies' }));
    fireEvent.click(screen.getByRole('button', { name: 'Agent keys' }));

    expect(routerState.navigate.mock.calls).toEqual([
      ['/runtime/profiles'],
      ['/runtime/policies'],
      ['/runtime/agent-keys'],
    ]);
  });
});
