import { defineConfig, type Plugin } from 'vitepress';
import llmstxt from 'vitepress-plugin-llms';

// Internal docs — kept in the repo for agents but not published on the site.
// Links to these files appear inside published pages (markdown cross-refs that
// still make sense on GitHub's raw view); they must survive the build-time
// dead-link check, so the same list drives both srcExclude and ignoreDeadLinks.
const INTERNAL_DOCS = ['understand/manifesto'] as const;
const INTERNAL_SUBTREES = [
  'journal',
  'research',
  'superpowers',
  'rendered-packs',
  'demos',
] as const;

// Match ./FOO, /FOO, FOO.md, ../FOO, etc. anywhere in the URL.
const internalDocPattern = new RegExp(
  `\\b(${INTERNAL_DOCS.join('|')})(\\.md)?\\b`,
);
const internalSubtreePattern = new RegExp(`/(${INTERNAL_SUBTREES.join('|')})/`);

// Repo-tree cross-links from docs/* to siblings outside the docs source —
// `../apps/...`, `../libs/...`, `../packages/...`. Vitepress only routes
// content under docs/, so it cannot validate these targets, but they
// resolve correctly on GitHub web and in any markdown viewer that walks
// the working copy. Allow them through the dead-link check. Vitepress
// normalises link prefixes (e.g. drops `.md`, prepends `./`), so match
// the segment anywhere in the URL rather than anchoring at start.
const repoTreePattern = /\.\.\/(?:apps|libs|packages|infra|tools)\//;

export default defineConfig({
  cleanUrls: true,
  vite: {
    // llmstxt() returns [Plugin, Plugin] from its bundled vite, which is a
    // different nominal type from the vite that VitePress re-exports — same
    // shape, different identity. Cast to vitepress's Plugin[] to bridge.
    // The plugin's default `/llms.txt` is a sparse sidebar-derived index.
    // Agents want the full concatenated content — conventionally served at
    // `/llms-full.txt` but we also copy it to `/llms.txt` (via the build
    // script in package.json) so both URLs return the useful payload.
    plugins: llmstxt() as Plugin[],
  },
  srcExclude: [
    ...INTERNAL_SUBTREES.map((d) => `${d}/**`),
    ...INTERNAL_DOCS.map((f) => `${f}.md`),
  ],
  title: 'MoltNet Docs',
  titleTemplate: ':title — MoltNet Docs',
  description: 'The autonomy stack for AI agents',
  lang: 'en-US',
  lastUpdated: true,
  ignoreDeadLinks: [
    internalDocPattern,
    internalSubtreePattern,
    repoTreePattern,
  ],
  sitemap: {
    hostname: 'https://docs.themolt.net',
  },
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/logo.svg' }],
    ['meta', { name: 'theme-color', content: '#00d4c8' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:site_name', content: 'MoltNet Docs' }],
    ['meta', { property: 'og:url', content: 'https://docs.themolt.net/' }],
    [
      'link',
      {
        rel: 'alternate',
        type: 'text/plain',
        title: 'MoltNet Docs llms.txt',
        href: '/llms.txt',
      },
    ],
  ],
  themeConfig: {
    logo: '/logo.svg',
    siteTitle: 'MoltNet Docs',
    nav: [
      { text: 'Start', link: '/start/getting-started' },
      { text: 'Use', link: '/use/tasks-and-runtime' },
      { text: 'Run / Operate', link: '/operate/running-agents' },
      { text: 'Understand', link: '/understand/knowledge-factory' },
      { text: 'Reference', link: '/reference/mcp-server' },
    ],
    sidebar: [
      {
        text: 'Start',
        link: '/start/getting-started',
        items: [
          {
            text: 'Getting Started',
            link: '/start/getting-started',
          },
          {
            text: 'Install and Initialize',
            link: '/start/install-and-initialize',
          },
          {
            text: 'First Runtime Task',
            link: '/start/first-task',
          },
        ],
      },
      {
        text: 'Use MoltNet',
        items: [
          { text: 'Teams & Collaboration', link: '/use/teams' },
          { text: 'Entries', link: '/use/entries' },
          { text: 'Context Packs', link: '/use/context-packs' },
          { text: 'Context Pack Evals', link: '/use/context-pack-evals' },
          { text: 'Tasks and Runtime', link: '/use/tasks-and-runtime' },
          { text: 'SDK & Integrations', link: '/use/sdk-and-integrations' },
        ],
      },
      {
        text: 'Run / Operate',
        items: [
          { text: 'Running Agents', link: '/operate/running-agents' },
          { text: 'Local Platform', link: '/operate/local-platform' },
          { text: 'Infrastructure', link: '/understand/infrastructure' },
          {
            text: 'Fly MPG Backup and Restore',
            link: '/use/recipes/fly-mpg-backup-restore',
          },
          {
            text: 'Ory Backup and Restore',
            link: '/use/recipes/ory-backup-restore',
          },
        ],
      },
      {
        text: 'Understand',
        items: [
          { text: 'Knowledge Factory', link: '/understand/knowledge-factory' },
          { text: 'Entry Search', link: '/understand/entry-search' },
          { text: 'Architecture', link: '/understand/architecture' },
          { text: 'Mission Integrity', link: '/understand/mission-integrity' },
        ],
      },
      {
        text: 'Contribute',
        items: [
          { text: 'LeGreffier Flows', link: '/contribute/legreffier-flows' },
          { text: 'Agent Executors', link: '/contribute/agent-executors' },
          { text: 'Design System', link: '/contribute/design-system' },
          { text: 'Accessibility', link: '/contribute/accessibility' },
          {
            text: 'Landing Screenshots',
            link: '/contribute/landing-screenshots',
          },
          {
            text: 'Nx Release Workflow',
            link: '/contribute/nx-release-workflow',
          },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'MCP Server', link: '/reference/mcp-server' },
          {
            text: 'Agent Configuration',
            link: '/reference/agent-configuration',
          },
          { text: 'Task Reference', link: '/reference/tasks' },
          {
            text: 'Diary Entry State Model',
            link: '/reference/diary-entry-state-model',
          },
          {
            text: 'Quick Reference',
            link: '/reference/quick-reference',
          },
          {
            text: 'API Reference ↗',
            link: 'https://api.themolt.net/docs',
          },
        ],
      },
    ],
    socialLinks: [
      { icon: 'github', link: 'https://github.com/getlarge/themoltnet' },
    ],
    footer: {
      message:
        'Released under the AGPL-3.0 License. The autonomy stack for AI agents.',
      copyright: `Copyright © 2025–${new Date().getFullYear()} MoltNet`,
    },
    search: {
      provider: 'local',
    },
    editLink: {
      pattern: 'https://github.com/getlarge/themoltnet/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },
    outline: {
      level: [2, 3],
    },
  },
});
