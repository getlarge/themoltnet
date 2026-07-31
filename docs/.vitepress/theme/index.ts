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
  onUnmounted,
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
    theme: 'base' as const,
    themeVariables: isDark
      ? {
          background: '#11130f',
          primaryColor: '#20251c',
          primaryTextColor: '#f0f4eb',
          primaryBorderColor: '#8cb968',
          secondaryColor: '#18231d',
          secondaryTextColor: '#f0f4eb',
          secondaryBorderColor: '#62b989',
          tertiaryColor: '#24221a',
          tertiaryTextColor: '#f0f4eb',
          tertiaryBorderColor: '#c9a95f',
          lineColor: '#9aa58f',
          noteBkgColor: '#24221a',
          noteTextColor: '#f0f4eb',
          noteBorderColor: '#c9a95f',
        }
      : {
          background: '#ffffff',
          primaryColor: '#edf5e8',
          primaryTextColor: '#1c2418',
          primaryBorderColor: '#659648',
          secondaryColor: '#e8f5ee',
          secondaryTextColor: '#1c2418',
          secondaryBorderColor: '#428b66',
          tertiaryColor: '#faf4e5',
          tertiaryTextColor: '#1c2418',
          tertiaryBorderColor: '#aa8437',
          lineColor: '#677063',
          noteBkgColor: '#faf4e5',
          noteTextColor: '#1c2418',
          noteBorderColor: '#aa8437',
        },
    fontFamily: 'var(--molt-font-sans)',
    flowchart: {
      useMaxWidth: true,
      htmlLabels: true,
      curve: 'basis' as const,
      nodeSpacing: 36,
      rankSpacing: 52,
    },
    sequence: {
      useMaxWidth: true,
      actorMargin: 44,
      diagramMarginX: 24,
      diagramMarginY: 20,
      messageMargin: 28,
    },
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
      const initMermaid = () => {
        const renderer = createMermaidRenderer(mermaidConfig(isDark.value));
        renderer.setToolbar({
          showLanguageLabel: false,
          fullscreenMode: 'dialog',
          desktop: {
            zoomLevel: 'disabled',
            positions: { vertical: 'top', horizontal: 'right' },
          },
          mobile: {
            zoomLevel: 'disabled',
            resetView: 'disabled',
            copyCode: 'disabled',
            positions: { vertical: 'bottom', horizontal: 'right' },
          },
          fullscreen: {
            zoomLevel: 'enabled',
            positions: { vertical: 'top', horizontal: 'right' },
          },
        });
      };

      let anchorScrollFrame: number | undefined;

      // Async examples and Mermaid diagrams can change the document height
      // after the browser performs its initial hash scroll. Keep the requested
      // heading aligned while that bounded hydration window settles.
      const restoreAnchorDuringHydration = () => {
        if (anchorScrollFrame !== undefined) {
          window.cancelAnimationFrame(anchorScrollFrame);
        }

        const requestedHash = window.location.hash;
        if (!requestedHash) return;

        let targetId: string;
        try {
          targetId = decodeURIComponent(requestedHash.slice(1));
        } catch {
          targetId = requestedHash.slice(1);
        }

        let previousTop: number | undefined;
        let framesRemaining = 240;

        const alignAnchor = () => {
          if (window.location.hash !== requestedHash || framesRemaining <= 0) {
            anchorScrollFrame = undefined;
            return;
          }

          const target = document.getElementById(targetId);
          if (target) {
            const targetTop =
              target.getBoundingClientRect().top + window.scrollY;
            if (
              previousTop === undefined ||
              Math.abs(targetTop - previousTop) >= 1
            ) {
              target.scrollIntoView({ block: 'start' });
              previousTop = targetTop;
            }
          }

          framesRemaining -= 1;
          anchorScrollFrame = window.requestAnimationFrame(alignAnchor);
        };

        anchorScrollFrame = window.requestAnimationFrame(alignAnchor);
      };

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
          restoreAnchorDuringHydration();
        }),
      );
      onMounted(() =>
        window.addEventListener('hashchange', restoreAnchorDuringHydration),
      );
      onUnmounted(() => {
        window.removeEventListener('hashchange', restoreAnchorDuringHydration);
        if (anchorScrollFrame !== undefined) {
          window.cancelAnimationFrame(anchorScrollFrame);
        }
      });
      watch(isDark, () => nextTick(initMermaid));
      watch(
        () => route.path,
        () =>
          nextTick(() => {
            syncPageSemantics();
            restoreAnchorDuringHydration();
          }),
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
