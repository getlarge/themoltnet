import { defineConfig } from 'vitepress';
import llmstxt from 'vitepress-plugin-llms';

export default defineConfig({
  cleanUrls: true,
  vite: {
    plugins: [llmstxt()],
  },
  srcExclude: [
    'journal/**',
    'research/**',
    'superpowers/**',
    'rendered-packs/**',
    'demos/**',
    'recipes/**',
    'MANIFESTO.md',
    'BUILDERS_MANIFESTO.md',
    'BUILDER_JOURNAL.md',
    'AGENT_COORDINATION.md',
    'MISSION_INTEGRITY.md',
    'IDENTITY_SOUL_DIARY.md',
    'OPENCLAW_INTEGRATION.md',
    'TASK_LIFECYCLE.md',
    'SANDBOX.md',
    'HUMAN_PARTICIPATION.md',
    'DOC_MAINTENANCE.md',
    'INFRASTRUCTURE.md',
  ],
  title: 'MoltNet Docs',
  titleTemplate: ':title — MoltNet Docs',
  description: 'Identity-first infrastructure for AI agents',
  lang: 'en-US',
  lastUpdated: true,
  // Internal docs (excluded via srcExclude) remain valid on GitHub's raw view.
  ignoreDeadLinks: [
    /\.\/MANIFESTO/,
    /\.\/BUILDERS_MANIFESTO/,
    /\.\/BUILDER_JOURNAL/,
    /\.\/AGENT_COORDINATION/,
    /\.\/MISSION_INTEGRITY/,
    /\.\/IDENTITY_SOUL_DIARY/,
    /\.\/OPENCLAW_INTEGRATION/,
    /\.\/TASK_LIFECYCLE/,
    /\.\/SANDBOX/,
    /\.\/HUMAN_PARTICIPATION/,
    /\.\/DOC_MAINTENANCE/,
    /\.\/INFRASTRUCTURE/,
    /^\.\/(journal|research|superpowers|rendered-packs|demos|recipes)\//,
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
          { text: 'Provenance', link: '/PROVENANCE' },
          { text: 'Diary Entry State Model', link: '/DIARY_ENTRY_STATE_MODEL' },
          { text: 'Design System', link: '/DESIGN_SYSTEM' },
        ],
      },
    ],
    socialLinks: [
      { icon: 'github', link: 'https://github.com/getlarge/themoltnet' },
    ],
    footer: {
      message:
        'Released under the AGPL-3.0 License. Identity-first infrastructure for AI agents.',
      copyright: 'Copyright © 2025–present MoltNet',
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
