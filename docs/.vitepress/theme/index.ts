import './vars.css';
import './custom.css';

import type { Theme } from 'vitepress';
import { useData } from 'vitepress';
import DefaultTheme from 'vitepress/theme';
import { createMermaidRenderer } from 'vitepress-mermaid-renderer';
import { defineComponent, h, nextTick, onMounted, watch } from 'vue';

import AdoptionDashboard from './components/AdoptionDashboard.vue';
import LoginButton from './components/LoginButton.vue';
import UserCard from './components/UserCard.vue';
import UserGreeting from './components/UserGreeting.vue';

const mermaidConfig = (isDark: boolean) =>
  ({
    theme: isDark ? ('dark' as const) : ('forest' as const),
    flowchart: { useMaxWidth: true, htmlLabels: true },
    sequence: { useMaxWidth: true },
    er: { useMaxWidth: true },
    gantt: { useMaxWidth: true },
    class: { useMaxWidth: true },
  }) as const;

export default {
  extends: DefaultTheme,
  Layout: defineComponent({
    name: 'MoltNetDocsLayout',
    setup() {
      const { isDark } = useData();

      // `createMermaidRenderer` returns a singleton — the first call sets up
      // the DOM observer and route listeners; subsequent calls reconfigure it.
      // See vitepress-mermaid-renderer docs.
      const initMermaid = () =>
        createMermaidRenderer(mermaidConfig(isDark.value));

      onMounted(() => nextTick(initMermaid));
      watch(isDark, () => nextTick(initMermaid));

      return () =>
        h(DefaultTheme.Layout, null, {
          'nav-bar-content-after': () => h(LoginButton),
          'home-hero-actions-after': () => h(UserGreeting),
          'home-features-after': () => h(AdoptionDashboard),
        });
    },
  }),
  enhanceApp({ app }) {
    app.component('AdoptionDashboard', AdoptionDashboard);
    app.component('UserCard', UserCard);
    app.component('UserGreeting', UserGreeting);
    app.component('LoginButton', LoginButton);
  },
} satisfies Theme;
