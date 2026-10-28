import {
  type Client,
  clientDefaultConfig,
  clientDefaultMeta,
  clientPluginHandler,
  definePluginConfig,
  type Plugin,
} from '@hey-api/openapi-ts';

export interface Config extends Client.Config {
  name: string;
  /**
   * Throw on non-2xx responses instead of returning `{ error }`. hey-api's
   * built-in clients declare this on their own config types.
   */
  throwOnError?: boolean;
}

type ApiBindingsPlugin = Plugin.Types<Config>;
type ResolvedApiBindingsPlugin = Omit<
  Plugin.Config<ApiBindingsPlugin>,
  'name'
> & {
  name: string;
};

const defaultConfig: Plugin.Config<ApiBindingsPlugin> = {
  ...clientDefaultMeta,
  config: {
    ...clientDefaultConfig,
    bundle: true,
    // Matches hey-api's built-in clients. clientDefaultConfig no longer sets
    // it, and leaving it unset widens ThrowOnError to `boolean` in the
    // generated client, which makes every `response` possibly undefined.
    throwOnError: false,
  },
  // clientPluginHandler is typed against hey-api's built-in client plugin
  // names; this plugin reuses it for a custom client with the same config
  // shape, so adapt the handler argument at this single boundary.
  handler: ({ plugin }) =>
    clientPluginHandler({
      plugin,
    } as unknown as Parameters<typeof clientPluginHandler>[0]),
  // Overridden with the absolute source path by the generator config.
  name: '',
  symbolMeta() {
    return { artifact: 'client' };
  },
};

export const apiBindingsPlugin = (name: string): ResolvedApiBindingsPlugin =>
  definePluginConfig({ ...defaultConfig, name })();
