import { defineConfig } from 'vitepress';
import llmstxt from 'vitepress-plugin-llms';

// Internal docs — kept in the repo for agents but not published on the site.
// Links to these files appear inside published pages (markdown cross-refs that
// still make sense on GitHub's raw view); they must survive the build-time
// dead-link check, so the same list drives both srcExclude and ignoreDeadLinks.
const INTERNAL_DOCS = [
  'MANIFESTO',
  'BUILDERS_MANIFESTO',
  'BUILDER_JOURNAL',
  'AGENT_COORDINATION',
  'MISSION_INTEGRITY',
  'IDENTITY_SOUL_DIARY',
  'OPENCLAW_INTEGRATION',
  'TASK_LIFECYCLE',
  'SANDBOX',
  'HUMAN_PARTICIPATION',
  'DOC_MAINTENANCE',
  'INFRASTRUCTURE',
] as const;
const INTERNAL_SUBTREES = [
  'journal',
  'research',
  'superpowers',
  'rendered-packs',
  'demos',
  'recipes',
] as const;

// Match ./FOO, /FOO, FOO.md, ../FOO, etc. anywhere in the URL.
const internalDocPattern = new RegExp(
  `\\b(${INTERNAL_DOCS.join('|')})(\\.md)?\\b`,
);
const internalSubtreePattern = new RegExp(`/(${INTERNAL_SUBTREES.join('|')})/`);

export default defineConfig({
  cleanUrls: true,
  vite: {
    // Cast: vitepress-plugin-llms's Plugin type comes from a different vite
    // version than the one VitePress 1.6 bundles, so structural compatibility
    // is lost at the type level though the runtime contract is identical.
    // The plugin's default `/llms.txt` is a sparse sidebar-derived index.
    // Agents want the full concatenated content — conventionally served at
    // `/llms-full.txt` but we also copy it to `/llms.txt` (via the build
    // script in package.json) so both URLs return the useful payload.
    plugins: [llmstxt() as never],
  },
  srcExclude: [
    ...INTERNAL_SUBTREES.map((d) => `${d}/**`),
    ...INTERNAL_DOCS.map((f) => `${f}.md`),
  ],
  title: 'MoltNet Docs',
  titleTemplate: ':title — MoltNet Docs',
  description: 'Identity-first infrastructure for AI agents',
  lang: 'en-US',
  lastUpdated: true,
  ignoreDeadLinks: [internalDocPattern, internalSubtreePattern],
  sitemap: {
    hostname: 'https://docs.themolt.net',
  },
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/logo.svg' }],
    ['meta', { name: 'theme-color', content: '#00d4c8' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:site_name', content: 'MoltNet Docs' }],
    ['meta', { property: 'og:url', content: 'https://docs.themolt.net/' }],
  ],
  themeConfig: {
    logo: '/logo.svg',
    siteTitle: 'MoltNet Docs',
    nav: [{ text: 'Getting Started', link: '/GETTING_STARTED' }],
    sidebar: [
      {
        text: 'Getting Started',
        link: '/GETTING_STARTED',
        items: [
          {
            text: 'Stage 1 · Install and Initialize',
            link: '/GETTING_STARTED#stage-1-install-and-initialize',
          },
          {
            text: 'Stage 2 · Task Harvesting',
            link: '/GETTING_STARTED#stage-2-task-harvesting',
          },
          {
            text: 'Stage 3 · Compilation into Context Packs',
            link: '/GETTING_STARTED#stage-3-compilation-into-context-packs',
          },
          {
            text: 'Stage 4 · Provenance Graph',
            link: '/GETTING_STARTED#stage-4-provenance-graph',
          },
          {
            text: 'Stage 5 · Evaluate Context Packs',
            link: '/GETTING_STARTED#stage-5-evaluate-context-packs',
          },
          {
            text: 'Stage 6 · Loading Rendered Packs',
            link: '/GETTING_STARTED#stage-6-loading-rendered-packs',
          },
          {
            text: 'Commit Authorship Modes',
            link: '/GETTING_STARTED#commit-authorship-modes',
          },
          {
            text: 'Quick Reference',
            link: '/GETTING_STARTED#quick-reference',
          },
        ],
      },
      {
        text: 'Guides',
        items: [
          { text: 'SDK & Integrations', link: '/SDK_AND_INTEGRATIONS' },
          { text: 'MCP Server', link: '/MCP_SERVER' },
          { text: 'Context Packs', link: '/CONTEXT_PACK_GUIDE' },
          { text: 'LeGreffier Diary Flows', link: '/LEGREFFIER_FLOWS' },
          { text: 'LeGreffier Scan Flows', link: '/LEGREFFIER_SCAN_FLOWS' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'Architecture', link: '/ARCHITECTURE' },
          { text: 'Knowledge Factory', link: '/KNOWLEDGE_FACTORY' },
          { text: 'Provenance', link: '/PROVENANCE' },
          { text: 'Diary Entry State Model', link: '/DIARY_ENTRY_STATE_MODEL' },
          { text: 'Design System', link: '/DESIGN_SYSTEM' },
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
        'Released under the AGPL-3.0 License. Identity-first infrastructure for AI agents.',
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
