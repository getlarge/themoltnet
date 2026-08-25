/**
 * @moltnet/crypto-service
 *
 * Ed25519 cryptographic operations for MoltNet agents
 */

export {
  type AgentIdentity,
  type AgentSigningCapability,
  allowedSignersLine,
  nonSecretGitconfig,
  sshPublicKeyLiteral,
} from './agent-signing.js';
export {
  computeBytesCid,
  computeBytesCidFromSha256,
  decodeBytesCidToSha256,
} from './bytes-cid.js';
export { canonicalJson, canonicalJsonBytes } from './canonical-json.js';
export { computeCanonicalHash, computeContentCid } from './content-cid.js';
export {
  buildSigningBytes,
  type CryptoService,
  cryptoService,
  type KeyPair,
  type SignedMessage,
} from './crypto.service.js';
export {
  assertExecutorManifestObject,
  buildExecutorAttestationSigningBytes,
  buildExecutorClaimAttestationPayload,
  buildExecutorCompleteAttestationPayload,
  buildExecutorRegistrationAttestationPayload,
  canonicalizeExecutorAttestationPayload,
  computeExecutorManifestCid,
  EXECUTOR_ATTESTATION_DOMAIN,
  EXECUTOR_ATTESTATION_PAYLOAD_VERSION,
  EXECUTOR_MANIFEST_SCHEMA_VERSION,
  type ExecutorAttestationPayload,
  type ExecutorClaimAttestationPayload,
  type ExecutorCompleteAttestationPayload,
  type ExecutorManifestBinding,
  type ExecutorRegistrationAttestationPayload,
  type ExecutorTrustLevel,
  readExecutorManifestBinding,
  signExecutorAttestation,
  verifyExecutorAttestation,
} from './executor-attestation.js';
export {
  generateRecoveryChallenge,
  signChallenge,
  verifyChallenge,
} from './hmac.js';
export { computeJsonCid } from './json-cid.js';
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
export {
  buildRenderedPackEnvelope,
  computeContentHash,
  computeRenderedPackCid,
  type RenderedPackEnvelopeInput,
} from './rendered-pack-cid.js';
export {
  openSealedEnvelope,
  type SealedEnvelope,
  sealForEd25519PublicKey,
} from './sealed-envelope.js';
export { toSSHPrivateKey, toSSHPublicKey } from './ssh.js';
export {
  assertGitSshsigEnvelope,
  encodeSshEd25519Signature,
  encodeSshString,
  parseSshsigEnvelope,
  readSshString,
  type SshsigEnvelope,
  SshsigError,
} from './sshsig.js';
