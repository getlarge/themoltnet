/**
 * @moltnet/crypto-service
 *
 * Ed25519 cryptographic operations for MoltNet agents
 */

export { computeCanonicalHash, computeContentCid } from './content-cid.js';
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
export {
  buildPackEnvelope,
  type CompileParams,
  type CompressionLevel,
  computePackCid,
  decodePackEnvelope,
  type OptimizedParams,
  type PackEntryRef,
  type PackEnvelopeInput,
  type PackType,
} from './pack-cid.js';
export { toSSHPrivateKey, toSSHPublicKey } from './ssh.js';
