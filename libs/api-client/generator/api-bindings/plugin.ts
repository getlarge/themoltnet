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
   * Shapes the generated SDK's result types only. This client always rejects
   * when the request executor throws.
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
    // Unset, ThrowOnError widens to `boolean` and every `response` may be undefined.
    throwOnError: false,
  },
  // The handler is typed for hey-api's built-in client names only.
  handler: ({ plugin }) =>
    clientPluginHandler({
      plugin,
    } as unknown as Parameters<typeof clientPluginHandler>[0]),
  // Overridden with the absolute source path by the generator config.
  name: '',
  // Emit the client under the same artifact key as hey-api's built-in clients.
  symbolMeta() {
    return { artifact: 'client' };
  },
};

export const apiBindingsPlugin = (name: string): ResolvedApiBindingsPlugin =>
  definePluginConfig({ ...defaultConfig, name })();
