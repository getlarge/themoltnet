import { fileURLToPath } from 'node:url';

export interface MoltNetEditorThemeOptions {
  css?: string;
  favicon?: string;
  title?: string;
}

export interface MoltNetEditorTheme {
  page: {
    css: string;
    favicon?: string;
    title?: string;
  };
}

export const moltnetNodeRedThemeCssPath = fileURLToPath(
  new URL('./moltnet-node-red-theme.css', import.meta.url),
);

export function moltnetEditorTheme(
  options: MoltNetEditorThemeOptions = {},
): MoltNetEditorTheme {
  const page: MoltNetEditorTheme['page'] = {
    css: options.css ?? moltnetNodeRedThemeCssPath,
  };

  if (options.favicon !== undefined) {
    page.favicon = options.favicon;
  }
  if (options.title !== undefined) {
    page.title = options.title;
  }

  return { page };
}
