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
}

type N8nClientPlugin = Plugin.Types<Config>;
type ResolvedN8nClientPlugin = Omit<Plugin.Config<N8nClientPlugin>, 'name'> & {
  name: string;
};

const defaultConfig: Plugin.Config<N8nClientPlugin> = {
  ...clientDefaultMeta,
  config: {
    ...clientDefaultConfig,
    bundle: true,
  },
  handler: clientPluginHandler,
  // Overridden with the absolute source path by openapi-ts.config.ts.
  name: '',
};

export const n8nClientPlugin = (name: string): ResolvedN8nClientPlugin =>
  definePluginConfig({ ...defaultConfig, name })();
