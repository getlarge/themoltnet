import './vars.css';
import './custom.css';

import type { Theme } from 'vitepress';
import { useData, useRoute } from 'vitepress';
import DefaultTheme from 'vitepress/theme';
import { createMermaidRenderer } from 'vitepress-mermaid-renderer';
import {
  computed,
  defineAsyncComponent,
  defineComponent,
  h,
  nextTick,
  onMounted,
  watch,
} from 'vue';

const InteractiveDiaryExample = defineAsyncComponent(
  () => import('./components/InteractiveDiaryExample.vue'),
);
const InteractiveEntriesExample = defineAsyncComponent(
  () => import('./components/InteractiveEntriesExample.vue'),
);
const InteractivePacksExample = defineAsyncComponent(
  () => import('./components/InteractivePacksExample.vue'),
);
const InteractiveTasksExample = defineAsyncComponent(
  () => import('./components/InteractiveTasksExample.vue'),
);
const InteractiveTeamsExample = defineAsyncComponent(
  () => import('./components/InteractiveTeamsExample.vue'),
);
const LoginButton = defineAsyncComponent(
  () => import('./components/LoginButton.vue'),
);
const PilotProgress = defineAsyncComponent(
  () => import('./components/PilotProgress.vue'),
);
const RuntimeProfileContextRecipe = defineAsyncComponent(
  () => import('./components/RuntimeProfileContextRecipe.vue'),
);
const TeamSelector = defineAsyncComponent(
  () => import('./components/TeamSelector.vue'),
);

const sessionRoutes = new Set([
  '/start/install-and-initialize',
  '/use/context-packs',
  '/use/entries',
  '/use/tasks-and-runtime',
  '/use/teams',
]);

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
      const route = useRoute();
      const showSessionControls = computed(() =>
        sessionRoutes.has(route.path.replace(/\/$/, '') || '/'),
      );

      // `createMermaidRenderer` returns a singleton — the first call sets up
      // the DOM observer and route listeners; subsequent calls reconfigure it.
      // See vitepress-mermaid-renderer docs.
      const initMermaid = () =>
        createMermaidRenderer(mermaidConfig(isDark.value));

      const syncPageSemantics = () => {
        const home = document.querySelector('.VPHome');
        if (home) home.setAttribute('role', 'main');

        const navigationRoots = document.querySelectorAll('.VPNav, .VPSidebar');
        navigationRoots.forEach((root) => {
          root
            .querySelectorAll('a[aria-current="page"]')
            .forEach((link) => link.removeAttribute('aria-current'));
          root
            .querySelectorAll(
              'a.VPLink.active, .VPSidebarItem.is-active > .item > a.VPLink',
            )
            .forEach((link) => link.setAttribute('aria-current', 'page'));
        });
      };

      const sessionControls = (location: 'desktop' | 'mobile') =>
        showSessionControls.value
          ? h(
              'div',
              {
                class: [
                  'moltnet-nav-controls',
                  `moltnet-nav-controls--${location}`,
                ],
              },
              [
                h(TeamSelector, {
                  controlId: `moltnet-team-select-${location}`,
                }),
                h(LoginButton),
              ],
            )
          : null;

      onMounted(() =>
        nextTick(() => {
          initMermaid();
          syncPageSemantics();
        }),
      );
      watch(isDark, () => nextTick(initMermaid));
      watch(
        () => route.path,
        () => nextTick(syncPageSemantics),
      );

      return () =>
        h(DefaultTheme.Layout, null, {
          'nav-bar-content-after': () => sessionControls('desktop'),
          'nav-screen-content-after': () => sessionControls('mobile'),
        });
    },
  }),
  enhanceApp({ app }) {
    app.component('InteractiveDiaryExample', InteractiveDiaryExample);
    app.component('InteractiveEntriesExample', InteractiveEntriesExample);
    app.component('InteractivePacksExample', InteractivePacksExample);
    app.component('InteractiveTasksExample', InteractiveTasksExample);
    app.component('InteractiveTeamsExample', InteractiveTeamsExample);
    app.component('PilotProgress', PilotProgress);
    app.component('LoginButton', LoginButton);
    app.component('RuntimeProfileContextRecipe', RuntimeProfileContextRecipe);
    app.component('TeamSelector', TeamSelector);
  },
} satisfies Theme;
