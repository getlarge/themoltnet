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
import { AuthorityPlane } from '../src/components/AuthorityPlane';
import { Collaboration } from '../src/components/Collaboration';
import { ExecutionTrace } from '../src/components/ExecutionTrace';
import { FeedSearch } from '../src/components/feed/FeedSearch';
import { TagChip } from '../src/components/feed/TagChip';
import { Footer } from '../src/components/Footer';
import { GetStarted } from '../src/components/GetStarted';
import { Hero } from '../src/components/Hero';
import { KnowledgeFactory } from '../src/components/KnowledgeFactory';
import { Nav } from '../src/components/Nav';
import { OpenSource } from '../src/components/OpenSource';
import { Systems } from '../src/components/Systems';
import { GettingStartedPage } from '../src/pages/GettingStartedPage';

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

  it('renders KnowledgeFactory', () => {
    wrap(<KnowledgeFactory />);
  });

  it('renders ExecutionTrace', () => {
    wrap(<ExecutionTrace />);
  });

  it('renders Collaboration', () => {
    wrap(<Collaboration />);
  });

  it('renders Systems', () => {
    wrap(<Systems />);
  });

  it('renders AuthorityPlane', () => {
    wrap(<AuthorityPlane />);
  });

  it('renders OpenSource', () => {
    wrap(<OpenSource />);
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
  it('Hero states the agent operations promise', () => {
    wrap(<Hero />);
    expect(
      screen.getByRole('heading', {
        name: /agents need autonomy—not your authority/i,
      }),
    ).toBeInTheDocument();
  });

  it('Hero shows the three systems and their authority foundation', () => {
    wrap(<Hero />);
    expect(screen.getByLabelText('MoltNet system map')).toBeInTheDocument();
    expect(screen.getAllByText('Task Engine').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Agent Runtime').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Knowledge Factory').length).toBeGreaterThan(0);
    expect(screen.getByText('Identity & Authority')).toBeInTheDocument();
  });

  it('Hero foregrounds one supervised-pilot CTA', () => {
    wrapWithRouter(<Hero />);

    const pilotLinks = screen.getAllByRole('link', {
      name: 'Run a supervised pilot',
    });
    expect(pilotLinks).toHaveLength(1);
    expect(pilotLinks[0]).toHaveAttribute('href', '/getting-started');
    expect(
      screen.queryByRole('button', { name: 'Run a supervised pilot' }),
    ).not.toBeInTheDocument();
  });

  it('Getting Started keeps the pilot phases visible and walkthroughs disclosed', () => {
    wrapWithRouter(<GettingStartedPage />, '/getting-started');

    expect(
      screen.getByRole('heading', { name: 'Run a small team pilot first' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Project workspace')).toBeInTheDocument();
    expect(screen.getByText('Team agent')).toBeInTheDocument();
    expect(screen.getByText('Supervised task')).toBeInTheDocument();
    expect(screen.getByText('Watch setup walkthroughs')).toBeInTheDocument();
    expect(
      screen.getByText('Use a different integration surface'),
    ).toBeInTheDocument();

    const walkthroughs = screen
      .getByText('Watch setup walkthroughs')
      .closest('details');
    const integrations = screen
      .getByText('Use a different integration surface')
      .closest('details');
    expect(walkthroughs).toBeInTheDocument();
    expect(walkthroughs).not.toHaveAttribute('open');
    expect(integrations).toBeInTheDocument();
    expect(integrations).not.toHaveAttribute('open');
  });

  it('KnowledgeFactory leads with ownership and portability of agent memory', () => {
    wrap(<KnowledgeFactory />);

    expect(
      screen.getByRole('heading', {
        name: 'Your agents learn on your work. That memory should be yours.',
      }),
    ).toBeInTheDocument();

    const ledger = screen.getByRole('list', {
      name: 'Knowledge portability ledger',
    });
    expect(ledger.querySelectorAll(':scope > li')).toHaveLength(4);
    // Direction is announced, not just struck through, so the ledger still
    // reads as before/after without the visual column captions.
    expect(screen.getByText('Assistant memory')).toHaveTextContent(
      'Today: Assistant memory',
    );
    expect(screen.getByText('Context pack')).toHaveTextContent(
      'In MoltNet: Context pack',
    );
  });

  it('KnowledgeFactory addresses both the individual and the organisation', () => {
    wrap(<KnowledgeFactory />);

    expect(screen.getByText('For one person')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', {
        name: 'Own the conversations you already had.',
      }),
    ).toBeInTheDocument();
    expect(screen.getByText('For an organisation')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', {
        name: 'One memory instead of twelve silos.',
      }),
    ).toBeInTheDocument();
  });

  it('KnowledgeFactory frames policy and typed work as a byproduct', () => {
    wrap(<KnowledgeFactory />);

    expect(
      screen.getByRole('heading', {
        name: 'The governance layer is a byproduct, not a second purchase.',
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Task Engine/ })).toHaveAttribute(
      'href',
      '#task-engine',
    );
    expect(screen.getByRole('link', { name: /Agent Runtime/ })).toHaveAttribute(
      'href',
      '#agent-runtime',
    );
    expect(
      screen.getByRole('link', { name: /How the factory runs/ }),
    ).toHaveAttribute('href', '#knowledge-factory-system');
  });

  it('Hero routes the first scroll into the Knowledge Factory section', () => {
    wrap(<Hero />);

    expect(
      screen.getByRole('link', {
        name: /start with the memory you should already own/i,
      }),
    ).toHaveAttribute('href', '#knowledge-factory');
  });

  it('ExecutionTrace preserves the causal task trail', () => {
    wrap(<ExecutionTrace />);
    const trace = screen.getByRole('list', {
      name: 'MoltNet task execution trace',
    });
    expect(trace).toBeInTheDocument();
    expect(trace.querySelectorAll(':scope > li')).toHaveLength(5);
    expect(screen.getByText('Propose')).toBeInTheDocument();
    expect(screen.getByText('Authorize')).toBeInTheDocument();
    expect(screen.getByText('Execute')).toBeInTheDocument();
    expect(screen.getByText('Accept')).toBeInTheDocument();
    expect(screen.getByText('Reuse')).toBeInTheDocument();
  });

  it('Systems explains all three operating systems', () => {
    wrap(<Systems />);
    expect(
      screen.getByRole('heading', {
        name: 'Three systems. One operating model.',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', {
        name: 'Dispatch work as a contract—not a prompt.',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', {
        name: 'Set the freedom each task actually needs.',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', {
        name: 'Make every run useful to the next.',
      }),
    ).toBeInTheDocument();
  });

  it('AuthorityPlane states the non-inheritance principle', () => {
    wrap(<AuthorityPlane />);
    expect(
      screen.getByRole('heading', {
        name: 'Agents should not inherit your authority.',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Ory Kratos · Hydra · Keto · Talos'),
    ).toBeInTheDocument();
    expect(screen.getByText('Enforcement')).toBeInTheDocument();
    expect(screen.getByText('Evidence')).toBeInTheDocument();
  });

  it('Collaboration uses real Console screens as product proof', () => {
    wrap(<Collaboration />);
    expect(screen.getByAltText(/task board/i)).toBeInTheDocument();
    expect(screen.getByAltText(/live task pane waiting/i)).toBeInTheDocument();
    expect(screen.getByAltText(/create task dialog/i)).toBeInTheDocument();
  });

  it('AgentBeacon names the board in its message', () => {
    const { container } = wrap(<AgentBeacon />);
    const beacon = container.querySelector('#agent-beacon');
    expect(beacon?.getAttribute('data-agent-message')).toMatch(/board/i);
  });

  it('OpenSource names the interfaces and infrastructure foundation', () => {
    wrap(<OpenSource />);
    const surfaces = [
      'Console',
      'REST API',
      'MCP',
      'CLI + SDK',
      'Agent daemon',
      'Ory identity + credentials',
      'Postgres + pgvector',
      'OpenTelemetry',
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
      screen.getByText(/open-source infrastructure for durable/i),
    ).toBeInTheDocument();
  });

  it('GetStarted closes on one bounded pilot', () => {
    wrap(<GetStarted />);
    expect(
      screen.getByText('Start with one team, one agent, one supervised task.'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /run a supervised pilot/i }),
    ).toHaveAttribute('href', '/getting-started');
  });

  it('Nav links to the console', () => {
    wrapWithRouter(<Nav />);
    const link = screen.getByRole('link', { name: 'Console' });
    expect(link).toHaveAttribute('href', 'https://console.themolt.net');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('Nav exposes direct anchors to the three systems', () => {
    wrapWithRouter(<Nav />);
    expect(screen.getByRole('link', { name: 'Task Engine' })).toHaveAttribute(
      'href',
      '/#task-engine',
    );
    expect(screen.getByRole('link', { name: 'Agent Runtime' })).toHaveAttribute(
      'href',
      '/#agent-runtime',
    );
    expect(screen.getByRole('link', { name: 'Knowledge' })).toHaveAttribute(
      'href',
      '/#knowledge-factory',
    );
  });

  it('App exposes a skip link and main landmark', () => {
    wrapWithRouter(<App />);

    expect(
      screen.getByRole('link', { name: 'Skip to main content' }),
    ).toHaveAttribute('href', '#main-content');
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content');
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
// Accessibility contracts — public controls expose names and state
// ---------------------------------------------------------------------------

describe('accessibility contracts', () => {
  it('FeedSearch exposes a named search control and disables short searches', () => {
    wrap(
      <FeedSearch
        onSubmit={() => undefined}
        onClear={() => undefined}
        isSearching={false}
      />,
    );

    expect(screen.getByRole('search')).toBeInTheDocument();
    expect(
      screen.getByRole('searchbox', { name: 'Search public feed' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Search' })).toBeDisabled();
  });

  it('TagChip only renders an interactive button when clickable', () => {
    const { rerender } = wrap(<TagChip tag="agent" />);

    expect(screen.queryByRole('button', { name: 'agent' })).toBeNull();

    rerender(
      <MoltThemeProvider mode="dark">
        <TagChip tag="agent" active onClick={() => undefined} />
      </MoltThemeProvider>,
    );

    expect(screen.getByRole('button', { name: 'agent' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
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
    const routes = ['/getting-started', '/architecture'];
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
