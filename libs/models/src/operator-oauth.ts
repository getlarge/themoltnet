/** Public protocol constants shared by consent, native control, and Console. */
export const OPERATOR_OAUTH = Object.freeze({
  provisioningScope: 'moltnet:provision',
  localControlScope: 'moltnet:local-control',
  provisioningAudience: 'moltnet:provisioning',
  localControlAudience: 'moltnet:agent-server',
  nativeLifetimeSeconds: 300,
  consoleLifetimeSeconds: 900,
  callbackPort: 17375,
});
