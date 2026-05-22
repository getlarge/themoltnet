import type { App, McpUiHostContext } from '@modelcontextprotocol/ext-apps';
import {
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
} from '@modelcontextprotocol/ext-apps';

function applyHostContext(
  context: Partial<McpUiHostContext> | undefined,
): void {
  if (!context) return;
  if (context.theme) {
    applyDocumentTheme(context.theme);
  }
  if (context.styles?.variables) {
    applyHostStyleVariables(context.styles.variables);
  }
  if (context.styles?.css?.fonts) {
    applyHostFonts(context.styles.css.fonts);
  }
}

export function syncHostContext(app: App): void {
  applyHostContext(app.getHostContext());
  app.onhostcontextchanged = (context) => {
    applyHostContext(context);
  };
}
