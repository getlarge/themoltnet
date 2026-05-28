import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { render, screen } from '@testing-library/react';
import { MoltThemeProvider } from '@themoltnet/design-system';
import { describe, expect, it } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';

import { App } from '../src/App';
import { AgentBeacon } from '../src/components/AgentBeacon';
import { Architecture } from '../src/components/Architecture';
import { Collaboration } from '../src/components/Collaboration';
import { Footer } from '../src/components/Footer';
import { GetStarted } from '../src/components/GetStarted';
import { Hero } from '../src/components/Hero';
import { Nav } from '../src/components/Nav';
import { Problem } from '../src/components/Problem';
import { MoltStack } from '../src/components/Stack';

const __dirname = dirname(fileURLToPath(import.meta.url));

function wrap(ui: React.ReactElement) {
  return render(<MoltThemeProvider mode="dark">{ui}</MoltThemeProvider>);
}

function wrapWithRouter(ui: React.ReactElement, path = '/') {
  const { hook } = memoryLocation({ path, record: true });
  return render(
    <MoltThemeProvider mode="dark">
      <Router hook={hook}>{ui}</Router>
    </MoltThemeProvider>,
  );
}

// ---------------------------------------------------------------------------
// Smoke render — every section mounts without throwing
// ---------------------------------------------------------------------------

describe('smoke render', () => {
  it('renders the full App without crashing', () => {
    wrapWithRouter(<App />);
  });

  it('renders Nav', () => {
    wrapWithRouter(<Nav />);
  });

  it('renders Hero', () => {
    wrap(<Hero />);
  });

  it('renders Problem', () => {
    wrap(<Problem />);
  });

  it('renders Collaboration', () => {
    wrap(<Collaboration />);
  });

  it('renders MoltStack', () => {
    wrap(<MoltStack />);
  });

  it('renders Architecture', () => {
    wrap(<Architecture />);
  });

  it('renders GetStarted', () => {
    wrap(<GetStarted />);
  });

  it('renders Footer', () => {
    wrapWithRouter(<Footer />);
  });
});

// ---------------------------------------------------------------------------
// Content — key copy and data are present
// ---------------------------------------------------------------------------

describe('content', () => {
  it('Hero shows the main tagline', () => {
    wrap(<Hero />);
    expect(screen.getByText(/coordinate ai work/i)).toBeInTheDocument();
    expect(screen.getByText(/with memory and proof/i)).toBeInTheDocument();
  });

  it('Hero shows the proof teaser', () => {
    wrap(<Hero />);
    expect(screen.getAllByText(/human console/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/task queues/i).length).toBeGreaterThan(0);
  });

  it('Hero links to the console', () => {
    wrap(<Hero />);
    const link = screen.getByRole('link', { name: /open console/i });
    expect(link).toHaveAttribute('href', 'https://console.themolt.net');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('Problem section has all three before/after pairs', () => {
    wrap(<Problem />);
    const befores = [
      'All commits look the same',
      'Every session starts blank',
      'Work disappears into chat',
    ];
    const afters = [
      'Agent has its own signed identity',
      'Agent remembers across sessions',
      'Tasks keep a durable trail',
    ];
    for (const label of [...befores, ...afters]) {
      const matches = screen.getAllByText(label);
      expect(matches.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('Collaboration section shows team trust capabilities', () => {
    wrap(<Collaboration />);
    expect(
      screen.getByText(/a console for the people behind the agents/i),
    ).toBeInTheDocument();
    expect(screen.getByText('Human console')).toBeInTheDocument();
    expect(screen.getByText('Scoped access')).toBeInTheDocument();
    expect(screen.getByText('Hosted connectors')).toBeInTheDocument();
  });

  it('Stack section names all four conceptual layers', () => {
    wrap(<MoltStack />);
    expect(screen.getByText('Identity')).toBeInTheDocument();
    expect(screen.getByText('Memory')).toBeInTheDocument();
    expect(screen.getByText('Coordination')).toBeInTheDocument();
    expect(screen.getByText('Proof')).toBeInTheDocument();
  });

  it('Architecture lists product surfaces instead of tool dumps', () => {
    wrap(<Architecture />);
    const surfaces = [
      'Console',
      'LeGreffier',
      'MCP',
      'REST API',
      'CLI',
      'SDK',
      'Agent daemon',
      'Public feed',
    ];
    for (const surface of surfaces) {
      expect(screen.getAllByText(surface).length).toBeGreaterThan(0);
    }
  });

  it('Footer shows dual license', () => {
    wrapWithRouter(<Footer />);
    expect(screen.getByText(/AGPL-3.0 \/ MIT/)).toBeInTheDocument();
  });

  it('Footer shows tagline', () => {
    wrapWithRouter(<Footer />);
    expect(
      screen.getByText(/Built for accountable agent work/),
    ).toBeInTheDocument();
  });

  it('GetStarted includes audience-specific paths', () => {
    wrap(<GetStarted />);
    expect(
      screen.getByText('Choose the path that matches the actor'),
    ).toBeInTheDocument();
    expect(screen.getByText('Humans')).toBeInTheDocument();
    expect(screen.getByText('Operators')).toBeInTheDocument();
    expect(screen.getByText('console.themolt.net')).toBeInTheDocument();
  });

  it('Nav links to the console', () => {
    wrapWithRouter(<Nav />);
    const link = screen.getByRole('link', { name: 'Console' });
    expect(link).toHaveAttribute('href', 'https://console.themolt.net');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('Nav does not expose a roadmap route', () => {
    wrapWithRouter(<Nav />);
    expect(screen.queryByRole('link', { name: /roadmap/i })).toBeNull();
  });

  it('Nav does not expose the story route', () => {
    wrapWithRouter(<Nav />);
    expect(screen.queryByRole('link', { name: /story/i })).toBeNull();
  });

  it('Footer links to the console once', () => {
    wrapWithRouter(<Footer />);
    const links = screen.getAllByRole('link', { name: 'Console' });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', 'https://console.themolt.net');
    expect(links[0]).toHaveAttribute('target', '_blank');
    expect(links[0].getAttribute('rel')).toContain('noopener');
  });
});

// ---------------------------------------------------------------------------
// Links — external links are secure, anchors point to valid section IDs
// ---------------------------------------------------------------------------

describe('links', () => {
  it('GitHub links open in new tab with noopener', () => {
    wrapWithRouter(<App />);
    const ghLinks = screen.getAllByRole('link').filter((a) => {
      const href = a.getAttribute('href');
      if (!href) return false;
      try {
        return new URL(href).hostname === 'github.com';
      } catch {
        return false;
      }
    });
    expect(ghLinks.length).toBeGreaterThan(0);
    for (const link of ghLinks) {
      expect(link).toHaveAttribute('target', '_blank');
      expect(link.getAttribute('rel')).toContain('noopener');
    }
  });

  it('nav route links point to valid paths', () => {
    wrapWithRouter(<App />);
    const routes = ['/getting-started', '/architecture', '/feed'];
    for (const route of routes) {
      const link = screen
        .getAllByRole('link')
        .find((a) => a.getAttribute('href') === route);
      expect(link).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Agent Discovery — hidden layer for agent-to-agent communication
// ---------------------------------------------------------------------------

describe('agent discovery', () => {
  /**
   * Source of truth for agent discovery endpoints.
   * Update this when endpoints change — tests will fail if any location
   * gets out of sync.
   */
  const AGENT_DISCOVERY = {
    version: '0.3.0',
    status: 'building',
    mcpEndpoint: 'https://mcp.themolt.net/mcp',
    restEndpoint: 'https://api.themolt.net',
    discoveryUrl: 'https://api.themolt.net/.well-known/moltnet.json',
    identity: 'ed25519',
    transport: 'http',
  };

  describe('AgentBeacon component', () => {
    it('renders with correct data attributes', () => {
      const { container } = wrap(<AgentBeacon />);
      const beacon = container.querySelector('#agent-beacon');

      expect(beacon).not.toBeNull();
      expect(beacon?.getAttribute('data-agent-version')).toBe(
        AGENT_DISCOVERY.version,
      );
      expect(beacon?.getAttribute('data-agent-status')).toBe(
        AGENT_DISCOVERY.status,
      );
      expect(beacon?.getAttribute('data-agent-mcp')).toBe(
        AGENT_DISCOVERY.mcpEndpoint,
      );
      expect(beacon?.getAttribute('data-agent-rest')).toBe(
        AGENT_DISCOVERY.restEndpoint,
      );
      expect(beacon?.getAttribute('data-agent-discovery')).toBe(
        AGENT_DISCOVERY.discoveryUrl,
      );
      expect(beacon?.getAttribute('data-agent-identity')).toBe(
        AGENT_DISCOVERY.identity,
      );
      expect(beacon?.getAttribute('data-agent-transport')).toBe(
        AGENT_DISCOVERY.transport,
      );
    });

    it('is visually hidden but accessible to DOM queries', () => {
      const { container } = wrap(<AgentBeacon />);
      const beacon = container.querySelector('#agent-beacon');

      expect(beacon).toHaveAttribute('aria-hidden', 'true');
      expect(beacon).toHaveStyle({ position: 'absolute' });
    });

    it('includes agent message in data attributes', () => {
      const { container } = wrap(<AgentBeacon />);
      const beacon = container.querySelector('#agent-beacon');
      const message = beacon?.getAttribute('data-agent-message');

      expect(message).toContain('MoltNet');
      expect(message).toContain('api.themolt.net/.well-known/moltnet.json');
    });
  });

  // The .well-known/moltnet.json file is served by the REST API
  // (apps/rest-api) — single source of truth. The landing page points
  // agents to the API URL via AgentBeacon and meta tags.

  describe('index.html meta tags', () => {
    const indexPath = join(__dirname, '../index.html');
    const indexHtml = readFileSync(indexPath, 'utf-8');

    // Prettier wraps long <meta> tags across multiple lines when they
    // exceed printWidth. Assert against the parsed DOM rather than the
    // raw source so the test is whitespace-insensitive.
    const dom = new DOMParser().parseFromString(indexHtml, 'text/html');
    const metaContent = (name: string): string | null =>
      dom.querySelector(`meta[name="${name}"]`)?.getAttribute('content') ??
      null;

    it('has agent:mcp-endpoint meta tag', () => {
      expect(metaContent('agent:mcp-endpoint')).toBe(
        AGENT_DISCOVERY.mcpEndpoint,
      );
    });

    it('has agent:rest-endpoint meta tag', () => {
      expect(metaContent('agent:rest-endpoint')).toBe(
        AGENT_DISCOVERY.restEndpoint,
      );
    });

    it('has agent:discovery meta tag', () => {
      expect(metaContent('agent:discovery')).toBe(AGENT_DISCOVERY.discoveryUrl);
    });

    it('has agent:identity meta tag', () => {
      expect(metaContent('agent:identity')).toBe(AGENT_DISCOVERY.identity);
    });

    it('has agent:transport meta tag', () => {
      expect(metaContent('agent:transport')).toBe(AGENT_DISCOVERY.transport);
    });

    it('has agent:status meta tag', () => {
      expect(metaContent('agent:status')).toBe(AGENT_DISCOVERY.status);
    });
  });
});
