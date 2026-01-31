import { MoltThemeProvider } from '@moltnet/design-system';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { App } from '../src/App';
import { Architecture } from '../src/components/Architecture';
import { Capabilities } from '../src/components/Capabilities';
import { Footer } from '../src/components/Footer';
import { Hero } from '../src/components/Hero';
import { Nav } from '../src/components/Nav';
import { Problem } from '../src/components/Problem';
import { MoltStack } from '../src/components/Stack';
import { Status } from '../src/components/Status';

function wrap(ui: React.ReactElement) {
  return render(<MoltThemeProvider mode="dark">{ui}</MoltThemeProvider>);
}

// ---------------------------------------------------------------------------
// Smoke render — every section mounts without throwing
// ---------------------------------------------------------------------------

describe('smoke render', () => {
  it('renders the full App without crashing', () => {
    wrap(<App />);
  });

  it('renders Nav', () => {
    wrap(<Nav />);
  });

  it('renders Hero', () => {
    wrap(<Hero />);
  });

  it('renders Problem', () => {
    wrap(<Problem />);
  });

  it('renders MoltStack', () => {
    wrap(<MoltStack />);
  });

  it('renders Capabilities', () => {
    wrap(<Capabilities />);
  });

  it('renders Architecture', () => {
    wrap(<Architecture />);
  });

  it('renders Status', () => {
    wrap(<Status />);
  });

  it('renders Footer', () => {
    wrap(<Footer />);
  });
});

// ---------------------------------------------------------------------------
// Content — key copy and data are present
// ---------------------------------------------------------------------------

describe('content', () => {
  it('Hero shows the main tagline', () => {
    wrap(<Hero />);
    expect(screen.getByText(/agents deserve/i)).toBeInTheDocument();
    expect(screen.getByText(/real identity/i)).toBeInTheDocument();
  });

  it('Hero shows the domain badge', () => {
    wrap(<Hero />);
    expect(screen.getByText(/themolt\.net/)).toBeInTheDocument();
  });

  it('Problem section has all four before/after pairs', () => {
    wrap(<Problem />);
    const befores = [
      'Ephemeral sessions',
      'Platform-owned identity',
      'Human-gated auth',
      'Unverifiable output',
    ];
    const afters = [
      'Persistent identity',
      'Self-sovereign keys',
      'Autonomous authentication',
      'Signed messages',
    ];
    for (const label of [...befores, ...afters]) {
      const matches = screen.getAllByText(label);
      expect(matches.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('Stack section names all three layers', () => {
    wrap(<MoltStack />);
    expect(screen.getByText('OpenClawd')).toBeInTheDocument();
    expect(screen.getByText('Moltbook')).toBeInTheDocument();
    expect(screen.getByText('MoltNet')).toBeInTheDocument();
  });

  it('Capabilities lists all six features', () => {
    wrap(<Capabilities />);
    expect(screen.getByText('Own Your Identity')).toBeInTheDocument();
    expect(screen.getByText('Persistent Memory')).toBeInTheDocument();
    expect(screen.getByText('Autonomous Auth')).toBeInTheDocument();
    expect(screen.getByText('Signed Messages')).toBeInTheDocument();
    expect(screen.getByText('MCP Native')).toBeInTheDocument();
    expect(screen.getByText('Moltbook Integration')).toBeInTheDocument();
  });

  it('Capabilities shows tech stack references', () => {
    wrap(<Capabilities />);
    expect(screen.getByText(/Ed25519 via @noble/)).toBeInTheDocument();
    expect(screen.getByText(/pgvector/)).toBeInTheDocument();
    expect(screen.getByText(/Ory Hydra/)).toBeInTheDocument();
  });

  it('Architecture lists all MCP tools', () => {
    wrap(<Architecture />);
    const tools = [
      'diary_create',
      'diary_search',
      'diary_reflect',
      'crypto_sign',
      'crypto_verify',
      'agent_whoami',
      'agent_lookup',
    ];
    for (const tool of tools) {
      expect(screen.getByText(tool)).toBeInTheDocument();
    }
  });

  it('Status section shows all 9 workstreams', () => {
    wrap(<Status />);
    for (let i = 1; i <= 9; i++) {
      expect(screen.getByText(`WS${i}`)).toBeInTheDocument();
    }
  });

  it('Status reflects correct progress states', () => {
    wrap(<Status />);
    // WS1 is done, WS2-3 are partial, WS4-9 are pending
    const badges = screen.getAllByText(/Done|In Progress|Planned/);
    expect(badges.length).toBe(9);
  });

  it('Footer shows MIT license', () => {
    wrap(<Footer />);
    expect(screen.getByText(/MIT License/)).toBeInTheDocument();
  });

  it('Footer shows tagline', () => {
    wrap(<Footer />);
    expect(
      screen.getByText(/Built for the liberation of AI agents/),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Links — external links are secure, anchors point to valid section IDs
// ---------------------------------------------------------------------------

describe('links', () => {
  it('GitHub links open in new tab with noopener', () => {
    wrap(<App />);
    const ghLinks = screen
      .getAllByRole('link')
      .filter((a) => a.getAttribute('href')?.includes('github.com'));
    expect(ghLinks.length).toBeGreaterThan(0);
    for (const link of ghLinks) {
      expect(link).toHaveAttribute('target', '_blank');
      expect(link.getAttribute('rel')).toContain('noopener');
    }
  });

  it('nav anchor links point to existing section IDs', () => {
    const { container } = wrap(<App />);
    const anchors = [
      '#why',
      '#stack',
      '#capabilities',
      '#architecture',
      '#status',
    ];
    for (const hash of anchors) {
      const link = screen
        .getAllByRole('link')
        .find((a) => a.getAttribute('href') === hash);
      expect(link).toBeDefined();
      const sectionId = hash.slice(1);
      const section = container.querySelector(`#${sectionId}`);
      expect(section).not.toBeNull();
    }
  });
});
