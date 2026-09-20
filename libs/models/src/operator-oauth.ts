import parameters from './operator-oauth-parameters.json' with { type: 'json' };

/** Public protocol constants shared by consent, native control, and Console. */
export const OPERATOR_OAUTH = Object.freeze({
  protocolVersion: 2,
  provisioningScope: 'moltnet:provision',
  localControlScope: 'moltnet:local-control',
  provisioningAudience: 'moltnet:provisioning',
  localControlAudience: 'moltnet:agent-server',
  /**
   * Administratively registered public PKCE clients. The consent handler
   * compares a token's `client_id` against these, so server and Desktop must
   * agree: a mismatch rejects every approval with an opaque 403.
   */
  nativeClientId: 'moltnet-native',
  consoleClientId: 'moltnet-console',
  ...parameters,
});
