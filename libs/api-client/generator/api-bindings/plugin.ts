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
  },
  handler: clientPluginHandler,
  // Overridden with the absolute source path by the generator config.
  name: '',
};

export const apiBindingsPlugin = (name: string): ResolvedApiBindingsPlugin =>
  definePluginConfig({ ...defaultConfig, name })();
