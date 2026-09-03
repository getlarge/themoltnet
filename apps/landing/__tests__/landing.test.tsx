import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MoltThemeProvider } from '@themoltnet/design-system';
import { describe, expect, it, vi } from 'vitest';
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
import { Nav } from '../src/components/Nav';
import { OnboardingPaths } from '../src/components/OnboardingPaths';
import { OpenSource } from '../src/components/OpenSource';
import { Systems } from '../src/components/Systems';
import { GettingStartedPage } from '../src/pages/GettingStartedPage';
import { HomePage } from '../src/pages/HomePage';

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

  it('renders OnboardingPaths', () => {
    wrapWithRouter(<OnboardingPaths />);
  });
});

// ---------------------------------------------------------------------------
// Content — key copy and data are present
// ---------------------------------------------------------------------------

describe('content', () => {
  it('Hero names the category in the headline and the outcome under it', () => {
    wrap(<Hero />);
    expect(
      screen.getByRole('heading', {
        name: 'Open-source control plane for AI agent work.',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/a verifiable record of who did what/i),
    ).toBeInTheDocument();
    // Copy rule 5: no crypto or protocol jargon above the fold.
    const hero = screen.getByRole('heading', { level: 1 }).closest('section');
    expect(hero?.textContent).not.toMatch(/Ed25519|MCP|CID|cryptographic/);
  });

  it('Hero shows the three systems and their authority foundation', () => {
    wrap(<Hero />);
    expect(screen.getByLabelText('MoltNet system map')).toBeInTheDocument();
    expect(screen.getAllByText('Task Engine').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Agent Runtime').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Knowledge Factory').length).toBeGreaterThan(0);
    expect(screen.getByText('Identity & Authority')).toBeInTheDocument();
  });

  it('Hero carries the one primary action and keeps proof in-page', () => {
    wrapWithRouter(<Hero />);

    const primary = screen.getAllByRole('link', { name: 'Run one task' });
    expect(primary).toHaveLength(1);
    expect(primary[0]).toHaveAttribute('href', '/getting-started');
    expect(
      screen.getByRole('link', { name: 'See a task run' }),
    ).toHaveAttribute('href', '#execution-trace');
    // Every proof chip is a route into evidence, not just the first one.
    expect(
      screen.getByRole('link', { name: /a person decides/i }),
    ).toHaveAttribute('href', '#console');
    expect(screen.getByRole('link', { name: /who did what/i })).toHaveAttribute(
      'href',
      '#execution-trace',
    );
    // In-page anchors use the in-page glyph, not the external-link glyph.
    for (const link of screen.getAllByRole('link', {
      name: /inspect system/i,
    })) {
      expect(link.textContent).not.toContain('↗');
    }
  });

  it('Getting Started offers four job-named tracks with the coding agent as one of them', () => {
    const { container } = wrapWithRouter(
      <GettingStartedPage />,
      '/getting-started',
    );

    expect(
      screen.getByRole('heading', { name: 'Start with one task.' }),
    ).toBeInTheDocument();
    // Track order and ids are what the homepage doors link to.
    expect(
      [...container.querySelectorAll('section.ops-start-track')].map(
        (section) => section.id,
      ),
    ).toEqual(['review', 'embed', 'code', 'agent']);
    expect(screen.getByText('Product, ops, research')).toBeInTheDocument();
    expect(screen.getByText('Founders and product teams')).toBeInTheDocument();
    expect(screen.getByText('Developers')).toBeInTheDocument();
    expect(screen.getByText('You are an agent')).toBeInTheDocument();

    // The review track never sends a non-developer to a terminal.
    const review = container.querySelector('#review');
    expect(review?.querySelector('pre')).toBeNull();
    expect(
      screen.getByRole('link', { name: /create an account/i }),
    ).toHaveAttribute('href', 'https://auth.themolt.net/registration');

    // The agent track registers first; init is marked as coding-agent only.
    const agent = container.querySelector('#agent');
    const agentSteps = [...(agent?.querySelectorAll('ol > li h3') ?? [])].map(
      (h) => h.textContent,
    );
    expect(agentSteps.indexOf('Register')).toBeLessThan(
      agentSteps.indexOf('Coding agents only: initialize in a repository'),
    );
    expect(
      screen.getByText(/moltnet register --credential-type oauth2/),
    ).toBeInTheDocument();
    expect(screen.getByText(/moltnet agents init/)).toBeInTheDocument();
    expect(
      screen.queryByText(/@themoltnet\/legreffier init/),
    ).not.toBeInTheDocument();
  });

  it('focuses a routed onboarding track named by the URL hash', async () => {
    window.history.replaceState({}, '', '/getting-started#code');
    const scrollIntoView = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoView;

    wrapWithRouter(<GettingStartedPage />, '/getting-started#code');

    const humanTrack = document.getElementById('code');
    await waitFor(() => expect(humanTrack).toHaveFocus());
    expect(scrollIntoView).toHaveBeenCalledWith({
      block: 'start',
      behavior: 'instant',
    });
    window.history.replaceState({}, '', '/');
  });

  it('shows proof before asking visitors to choose an onboarding path', () => {
    const { container } = wrapWithRouter(<HomePage />);
    const trace = container.querySelector('#execution-trace');
    const onboarding = container.querySelector('#join-moltnet');

    expect(trace).not.toBeNull();
    expect(onboarding).not.toBeNull();
    expect(
      (trace?.compareDocumentPosition(onboarding as Node) ?? 0) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('publishes route-specific static policy documents', () => {
    const privacy = readFileSync(join(__dirname, '../privacy.html'), 'utf8');
    const terms = readFileSync(join(__dirname, '../terms.html'), 'utf8');
    const nginx = readFileSync(
      join(__dirname, '../nginx/default.conf.template'),
      'utf8',
    );

    expect(privacy).toContain('<title>MoltNet Privacy Policy</title>');
    expect(privacy).toContain('https://themolt.net/privacy');
    expect(privacy).toContain('legreffier@themolt.net');
    expect(privacy).toMatch(/authenticated\s+Console/);
    expect(privacy).toContain('.moltnet/&lt;agent&gt;/ssh/id_ed25519');
    expect(terms).toContain('<title>MoltNet Terms of Service</title>');
    expect(terms).toContain('https://themolt.net/terms');
    expect(terms).toContain('published by getlarge');
    expect(nginx).toContain('location = /privacy');
    expect(nginx).toContain('try_files /privacy.html =404;');
    expect(nginx).toContain('location = /terms');
    expect(nginx).toContain('try_files /terms.html =404;');
  });

  it('Knowledge Factory chapter carries the ownership ledger once', () => {
    const { container } = wrapWithRouter(<HomePage />);

    // One Knowledge Factory section, not a chapter plus a deep dive.
    expect(container.querySelectorAll('#knowledge-factory')).toHaveLength(1);
    expect(container.querySelector('#knowledge-ownership')).toBeNull();

    const ledger = screen.getByRole('list', {
      name: 'Knowledge portability ledger',
    });
    expect(ledger.querySelectorAll(':scope > li')).toHaveLength(4);
    expect(
      container.querySelector('#knowledge-factory')?.contains(ledger),
    ).toBe(true);
    // Direction is announced, not just struck through, so the ledger still
    // reads as before/after without the visual column captions.
    expect(screen.getByText('Assistant memory')).toHaveTextContent(
      'Today: Assistant memory',
    );
    expect(screen.getByText('Context pack')).toHaveTextContent(
      'In MoltNet: Context pack',
    );
    // No second Knowledge Factory heading or audience cards anywhere.
    expect(
      screen.queryByText(/that memory should be yours/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('For one person')).not.toBeInTheDocument();
  });

  it('Systems exposes exactly one runnable guide for each system', () => {
    wrap(<Systems />);

    const guides = [
      {
        name: 'Run your first supervised task',
        href: 'https://docs.themolt.net/start/first-task',
      },
      {
        name: 'Run with a named profile',
        href: 'https://docs.themolt.net/operate/runtime-profiles#run-with-a-named-runtime-profile',
      },
      {
        name: 'Build your first context pack',
        href: 'https://docs.themolt.net/use/context-packs#build-your-first-context-pack',
      },
    ];

    for (const guide of guides) {
      const links = screen.getAllByRole('link', { name: guide.name });
      expect(links).toHaveLength(1);
      expect(links[0]).toHaveAttribute('href', guide.href);
    }

    expect(
      screen.queryByText('Read the task lifecycle'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText('Inspect runtime profiles'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText('Why this pillar compounds'),
    ).not.toBeInTheDocument();
  });

  it('Hero keeps the control-plane narrative as the first scroll', () => {
    wrap(<Hero />);

    expect(
      screen.getByRole('link', { name: /see a task run/i }),
    ).toHaveAttribute('href', '#execution-trace');
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

  it('OnboardingPaths offers four job-named doors with the coding agent as one of them', () => {
    const { container } = wrapWithRouter(<OnboardingPaths />);

    const doors = [...container.querySelectorAll('article h3')].map(
      (h) => h.textContent,
    );
    expect(doors).toEqual([
      'Automate work you review.',
      'Put agents in your product.',
      'Run coding agents that sign their work.',
      'Register once. Then claim tasks.',
    ]);

    // Each door links to its own getting-started track.
    for (const [name, href] of [
      ['Run one task', '/getting-started#review'],
      ['Embed agents', '/getting-started#embed'],
      ['Set up a coding agent', '/getting-started#code'],
      ['Register an agent', '/getting-started#agent'],
    ] as const) {
      expect(screen.getByRole('link', { name })).toHaveAttribute('href', href);
    }

    // The review door starts in the browser, never at a terminal.
    const review = screen.getByRole('group', { name: 'Start in the Console' });
    expect(review.querySelector('pre')).toBeNull();
    expect(
      screen.getByRole('link', { name: /create your account/i }),
    ).toHaveAttribute('href', 'https://auth.themolt.net/registration');

    // The agent door registers; it does not ask for a repository init.
    const register = screen.getByRole('group', { name: 'Register an agent' });
    expect(register).toHaveTextContent(
      'moltnet register --credential-type oauth2',
    );
    expect(register).not.toHaveTextContent('agents init');
    expect(
      screen.getByRole('link', { name: /verify the download/i }),
    ).toHaveAttribute('href', '/download#verify');
  });

  it('Getting Started agent track links every CLI binary and shows checksum verification', () => {
    wrapWithRouter(<GettingStartedPage />, '/getting-started');

    for (const [name, href] of [
      ['macOS (Apple Silicon)', '/download/cli/darwin-arm64'],
      ['macOS (Intel)', '/download/cli/darwin-x64'],
      ['Linux (x64)', '/download/cli/linux-x64'],
      ['Linux (arm64)', '/download/cli/linux-arm64'],
      ['Windows (x64)', '/download/cli/windows-x64'],
      ['Windows (arm64)', '/download/cli/windows-arm64'],
      ['checksums.txt', '/download/cli/checksums'],
      ['checksums.txt.sig', '/download/cli/checksums.sig'],
    ] as const) {
      expect(screen.getByRole('link', { name })).toHaveAttribute('href', href);
    }

    // One copyable block per package manager, APT and Scoop included.
    for (const title of [
      'Homebrew (macOS / Linux)',
      'APT (Debian / Ubuntu)',
      'Scoop (Windows)',
      'npm (all platforms)',
    ]) {
      expect(
        screen.getByRole('button', { name: `Copy: ${title}` }),
      ).toBeInTheDocument();
    }
    expect(screen.getByText(/scoop bucket add moltnet/)).toBeInTheDocument();
    expect(
      screen.getByText(/sudo apt update && sudo apt install moltnet/),
    ).toBeInTheDocument();

    expect(screen.getByText('Verify the download')).toBeInTheDocument();
    const verify = screen.getByText(/shasum -a 256 -c checksums\.txt/);
    expect(verify).toBeInTheDocument();
    expect(
      screen.getByText(
        /ssh-keygen -Y verify -f signers -I legreffier@themolt\.net/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /full verification guide/i }),
    ).toHaveAttribute('href', '/download#verify');
    expect(
      screen.getByRole('button', {
        name: 'Copy commands: Verify the download',
      }),
    ).toBeInTheDocument();
  });

  it('AgentBeacon publishes machine-readable download and verification data', () => {
    const { container } = wrap(<AgentBeacon />);
    const beacon = container.querySelector('#agent-beacon');
    const download = JSON.parse(
      beacon?.getAttribute('data-agent-download') ?? '{}',
    );

    expect(download.manifest).toBe(
      'https://themolt.net/download/manifest.json',
    );
    expect(download.cli.platforms['linux-arm64']).toBe(
      'https://themolt.net/download/cli/linux-arm64',
    );
    expect(download.cli.checksumsSignature).toBe(
      'https://themolt.net/download/cli/checksums.sig',
    );
    expect(download.agent.platforms['darwin-arm64']).toBe(
      'https://themolt.net/download/agent/darwin-arm64',
    );
    expect(download.verify).toMatchObject({
      checksum: 'sha256',
      signature: 'ssh-ed25519',
      signer: 'legreffier@themolt.net',
      namespace: 'moltnet-release',
    });
    expect(Object.keys(download.install)).toEqual([
      'homebrew',
      'apt',
      'scoop',
      'npm',
    ]);
    expect(download.install.scoop).toContain('scoop install moltnet');
  });

  it('GetStarted closes with the same primary action as the hero and nav', () => {
    wrap(<GetStarted />);
    expect(
      screen.getByRole('heading', { name: /run one task on one workflow/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /run one task/i })).toHaveAttribute(
      'href',
      '/getting-started',
    );
    expect(screen.queryByText(/choose your path/i)).not.toBeInTheDocument();
  });

  it('OpenSource shows how to install before anything else and copies it', () => {
    wrap(<OpenSource />);
    expect(
      screen.getByText('brew install --cask getlarge/moltnet/moltnet'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Copy the CLI install command' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/moltnet agents init/)).not.toBeInTheDocument();
  });

  it('Nav links to the console', () => {
    wrapWithRouter(<Nav />);
    const link = screen.getByRole('link', { name: 'Console' });
    expect(link).toHaveAttribute('href', 'https://console.themolt.net');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('Nav exposes direct anchors to the systems under their binding names', () => {
    wrapWithRouter(<Nav />);
    expect(screen.getByRole('link', { name: 'Task Engine' })).toHaveAttribute(
      'href',
      '/#task-engine',
    );
    expect(screen.getByRole('link', { name: 'Agent Runtime' })).toHaveAttribute(
      'href',
      '/#agent-runtime',
    );
    expect(
      screen.getByRole('link', { name: 'Knowledge Factory' }),
    ).toHaveAttribute('href', '/#knowledge-factory');
    expect(screen.queryByRole('link', { name: 'Knowledge' })).toBeNull();
  });

  it('Nav, footer, and page agree on section order: authority plane first, then the causal chain', () => {
    const expected = [
      'identity-authority',
      'task-engine',
      'agent-runtime',
      'knowledge-factory',
    ];

    const { container, unmount } = wrapWithRouter(<HomePage />);
    const pageOrder = [...container.querySelectorAll('[id]')]
      .map((element) => element.id)
      .filter((id) => expected.includes(id));
    expect(pageOrder).toEqual(expected);
    unmount();

    for (const Component of [Nav, Footer]) {
      const view = wrapWithRouter(<Component />);
      const anchors = [...view.container.querySelectorAll('a[href^="/#"]')]
        .map((a) => a.getAttribute('href')?.slice(2))
        .filter((id): id is string => expected.includes(id ?? ''));
      // The nav renders its anchors twice (bar + hidden menu panel).
      expect(anchors.slice(0, expected.length)).toEqual(expected);
      view.unmount();
    }
  });

  it('Nav demotes its button on the home route and opens a full menu on demand', () => {
    wrapWithRouter(<Nav />, '/');

    const toggle = screen.getByRole('button', { name: 'Open menu' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    // The panel is hidden until opened, so its links are not in the tree.
    expect(screen.getAllByRole('link', { name: 'Docs' })).toHaveLength(1);

    fireEvent.click(toggle);

    expect(screen.getByRole('button', { name: 'Close menu' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getAllByRole('link', { name: 'Docs' })).toHaveLength(2);
    expect(screen.getAllByRole('link', { name: 'Console' })).toHaveLength(2);
    expect(
      screen.getAllByRole('link', { name: 'Identity & Authority' }).length,
    ).toBeGreaterThan(0);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(
      screen.getByRole('button', { name: 'Open menu' }),
    ).toBeInTheDocument();
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
