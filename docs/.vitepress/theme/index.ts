import './vars.css';
import './custom.css';

import type { Theme } from 'vitepress';
import { useData } from 'vitepress';
import DefaultTheme from 'vitepress/theme';
import { createMermaidRenderer } from 'vitepress-mermaid-renderer';
import { h, nextTick, watch } from 'vue';

export default {
  extends: DefaultTheme,
  Layout: () => {
    const { isDark } = useData();

    const initMermaid = () => {
      createMermaidRenderer({
        theme: isDark.value ? 'dark' : 'forest',
        flowchart: { useMaxWidth: true, htmlLabels: true },
        sequence: { useMaxWidth: true },
        er: { useMaxWidth: true },
        gantt: { useMaxWidth: true },
        class: { useMaxWidth: true },
      });
    };

    nextTick(() => initMermaid());

    watch(
      () => isDark.value,
      () => initMermaid(),
    );

    return h(DefaultTheme.Layout);
  },
} satisfies Theme;
