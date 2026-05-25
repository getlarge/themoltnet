/**
 * The slice of the ext-apps `App` the adapter depends on. Extracted so both the
 * adapter and the typed {@link callTool} wrapper can reference it without a
 * circular import. Keeps tests trivially mockable.
 */
export interface ToolCaller {
  callServerTool(input: {
    name: string;
    arguments: Record<string, unknown>;
  }): Promise<unknown>;
}
