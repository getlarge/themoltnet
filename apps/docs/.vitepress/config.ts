import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitepress';
import { withMermaid } from 'vitepress-plugin-mermaid';

const require = createRequire(import.meta.url);
const vueDir = require
  .resolve('vue/package.json')
  .replace(/\/package\.json$/, '');
const publicDir = fileURLToPath(new URL('../public', import.meta.url));

export default withMermaid(
  defineConfig({
    srcDir: '../../docs',
    outDir: '.vitepress/dist',
    cacheDir: '.vitepress/cache',
    cleanUrls: true,
    srcExclude: [
      'journal/**',
      'recipes/**',
      'research/**',
      'superpowers/**',
      'rendered-packs/**',
      'demos/**',
      'MANIFESTO.md',
      'BUILDERS_MANIFESTO.md',
      'BUILDER_JOURNAL.md',
      'AGENT_COORDINATION.md',
      'MISSION_INTEGRITY.md',
      'CONTEXT_PACK_GUIDE.md',
      'DIARY_ENTRY_STATE_MODEL.md',
      'IDENTITY_SOUL_DIARY.md',
      'PROVENANCE.md',
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
      /\.\/CONTEXT_PACK_GUIDE/,
      /\.\/PROVENANCE/,
      /\.\/MANIFESTO/,
      /\.\/BUILDERS_MANIFESTO/,
      /\.\/BUILDER_JOURNAL/,
      /\.\/AGENT_COORDINATION/,
      /\.\/MISSION_INTEGRITY/,
      /\.\/DIARY_ENTRY_STATE_MODEL/,
      /\.\/IDENTITY_SOUL_DIARY/,
      /\.\/OPENCLAW_INTEGRATION/,
      /\.\/TASK_LIFECYCLE/,
      /\.\/SANDBOX/,
      /\.\/HUMAN_PARTICIPATION/,
      /\.\/DOC_MAINTENANCE/,
      /\.\/INFRASTRUCTURE/,
      /^\.\/(journal|recipes|research|superpowers|rendered-packs|demos)\//,
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
      nav: [
        { text: 'Getting Started', link: '/GETTING_STARTED' },
        { text: 'MCP Server', link: '/MCP_SERVER' },
        { text: 'Architecture', link: '/ARCHITECTURE' },
        { text: 'Design System', link: '/DESIGN_SYSTEM' },
        { text: 'themolt.net', link: 'https://themolt.net' },
      ],
      sidebar: [
        {
          text: 'Guides',
          items: [
            { text: 'Getting Started', link: '/GETTING_STARTED' },
            { text: 'MCP Server', link: '/MCP_SERVER' },
          ],
        },
        {
          text: 'Reference',
          items: [
            { text: 'Architecture', link: '/ARCHITECTURE' },
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
    mermaid: {
      theme: 'dark',
    },
    vite: {
      publicDir,
      resolve: {
        alias: [
          { find: /^vue$/, replacement: vueDir },
          {
            find: /^vue\/server-renderer$/,
            replacement: `${vueDir}/server-renderer`,
          },
        ],
      },
    },
  }),
);
