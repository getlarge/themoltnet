/**
 * @moltnet/crypto-service
 *
 * Ed25519 cryptographic operations for MoltNet agents
 */

export {
  buildSigningBytes,
  type CryptoService,
  cryptoService,
  type KeyPair,
  type SignedMessage,
} from './crypto.service.js';
export {
  generateRecoveryChallenge,
  signChallenge,
  verifyChallenge,
} from './hmac.js';
export { toSSHPrivateKey, toSSHPublicKey } from './ssh.js';
