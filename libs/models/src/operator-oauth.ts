import parameters from './operator-oauth-parameters.json' with { type: 'json' };

/** Public protocol constants shared by consent, native control, and Console. */
export const OPERATOR_OAUTH = Object.freeze({
  protocolVersion: 2,
  provisioningScope: 'moltnet:provision',
  localControlScope: 'moltnet:local-control',
  provisioningAudience: 'moltnet:provisioning',
  localControlAudience: 'moltnet:agent-server',
  ...parameters,
});
