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

type TransportClientPlugin = Plugin.Types<Config>;
type ResolvedTransportClientPlugin = Omit<
  Plugin.Config<TransportClientPlugin>,
  'name'
> & {
  name: string;
};

const defaultConfig: Plugin.Config<TransportClientPlugin> = {
  ...clientDefaultMeta,
  config: {
    ...clientDefaultConfig,
    bundle: true,
  },
  handler: clientPluginHandler,
  // Overridden with the absolute source path by openapi-transport.config.ts.
  name: '',
};

export const transportClientPlugin = (
  name: string,
): ResolvedTransportClientPlugin =>
  definePluginConfig({ ...defaultConfig, name })();
