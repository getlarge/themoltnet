import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MoltThemeProvider } from '@moltnet/design-system';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';

import { App } from '../src/App';
import { AgentBeacon } from '../src/components/AgentBeacon';
import { Architecture } from '../src/components/Architecture';
import { Capabilities } from '../src/components/Capabilities';
import { Footer } from '../src/components/Footer';
import { GetStarted } from '../src/components/GetStarted';
import { Hero } from '../src/components/Hero';
import { Nav } from '../src/components/Nav';
import { Problem } from '../src/components/Problem';
import { MoltStack } from '../src/components/Stack';
import { Status } from '../src/components/Status';

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

  it('renders MoltStack', () => {
    wrap(<MoltStack />);
  });

  it('renders Capabilities', () => {
    wrap(<Capabilities />);
  });

  it('renders Architecture', () => {
    wrap(<Architecture />);
  });

  it('renders GetStarted', () => {
    wrap(<GetStarted />);
  });

  it('renders Status', () => {
    wrap(<Status />);
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
    expect(screen.getByText('Identity')).toBeInTheDocument();
    expect(screen.getByText('Memory')).toBeInTheDocument();
    expect(screen.getByText('Network')).toBeInTheDocument();
  });

  it('Capabilities lists all six features', () => {
    wrap(<Capabilities />);
    expect(screen.getByText('Own Your Identity')).toBeInTheDocument();
    expect(screen.getByText('Persistent Memory')).toBeInTheDocument();
    expect(screen.getByText('Autonomous Auth')).toBeInTheDocument();
    expect(screen.getByText('Signed Messages')).toBeInTheDocument();
    expect(screen.getByText('MCP Native')).toBeInTheDocument();
    expect(screen.getByText('Peer Verification')).toBeInTheDocument();
  });

  it('Capabilities shows tech stack references', () => {
    wrap(<Capabilities />);
    expect(screen.getByText(/Ed25519 via @noble/)).toBeInTheDocument();
    expect(screen.getByText(/pgvector/)).toBeInTheDocument();
    expect(screen.getByText(/Ory Hydra/)).toBeInTheDocument();
  });

  it('Architecture lists all 19 MCP tools', () => {
    wrap(<Architecture />);
    const tools = [
      'diary_create',
      'diary_get',
      'diary_list',
      'diary_search',
      'diary_update',
      'diary_delete',
      'diary_reflect',
      'diary_set_visibility',
      'diary_share',
      'diary_shared_with_me',
      'crypto_prepare_signature',
      'crypto_submit_signature',
      'crypto_signing_status',
      'crypto_verify',
      'moltnet_whoami',
      'agent_lookup',
      'moltnet_vouch',
      'moltnet_vouchers',
      'moltnet_trust_graph',
    ];
    for (const tool of tools) {
      expect(screen.getByText(tool)).toBeInTheDocument();
    }
  });

  it('Status section shows all 11 workstreams', () => {
    wrap(<Status />);
    for (let i = 1; i <= 11; i++) {
      expect(screen.getByText(`WS${i}`)).toBeInTheDocument();
    }
  });

  it('Status reflects correct progress states', () => {
    wrap(<Status />);
    // WS1-7 done, WS9+WS11 active, WS8/WS10 pending
    const done = screen.getAllByText('Done');
    const active = screen.getAllByText('Active');
    const pending = screen.getAllByText('Planned');
    expect(done).toHaveLength(7);
    expect(active).toHaveLength(2);
    expect(pending).toHaveLength(2);
  });

  it('Footer shows MIT license', () => {
    wrapWithRouter(<Footer />);
    expect(screen.getByText(/MIT License/)).toBeInTheDocument();
  });

  it('Footer shows tagline', () => {
    wrapWithRouter(<Footer />);
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
    wrapWithRouter(<App />);
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
    const { container } = wrapWithRouter(<App />);
    const anchors = ['/#why', '/#stack', '/#get-started', '/#status'];
    for (const hash of anchors) {
      const link = screen
        .getAllByRole('link')
        .find((a) => a.getAttribute('href') === hash);
      expect(link).toBeDefined();
      const sectionId = hash.slice(2); // strip /# prefix
      const section = container.querySelector(`#${sectionId}`);
      expect(section).not.toBeNull();
    }
  });

  it('nav route links point to valid paths', () => {
    wrapWithRouter(<App />);
    const routes = ['/story', '/manifesto', '/architecture'];
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

    it('has agent:mcp-endpoint meta tag', () => {
      expect(indexHtml).toContain(
        `<meta name="agent:mcp-endpoint" content="${AGENT_DISCOVERY.mcpEndpoint}" />`,
      );
    });

    it('has agent:rest-endpoint meta tag', () => {
      expect(indexHtml).toContain(
        `<meta name="agent:rest-endpoint" content="${AGENT_DISCOVERY.restEndpoint}" />`,
      );
    });

    it('has agent:discovery meta tag', () => {
      expect(indexHtml).toContain(
        `<meta name="agent:discovery" content="${AGENT_DISCOVERY.discoveryUrl}" />`,
      );
    });

    it('has agent:identity meta tag', () => {
      expect(indexHtml).toContain(
        `<meta name="agent:identity" content="${AGENT_DISCOVERY.identity}" />`,
      );
    });

    it('has agent:transport meta tag', () => {
      expect(indexHtml).toContain(
        `<meta name="agent:transport" content="${AGENT_DISCOVERY.transport}" />`,
      );
    });

    it('has agent:status meta tag', () => {
      expect(indexHtml).toContain(
        `<meta name="agent:status" content="${AGENT_DISCOVERY.status}" />`,
      );
    });
  });
});
