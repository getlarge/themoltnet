/** Browser-safe public-key shape consumed by the standalone verifier. */
export interface CoseEc2PublicKey {
  kty: 2;
  algorithm: number;
  curve: 1;
  x: string;
  y: string;
}

/** Browser-safe ARKG seed public material consumed by server-side derivation. */
export interface CoseArkgSeedPublicKey {
  kty: -65537;
  algorithm: -65700;
  derivedAlgorithm: -9;
  blindingKey: CoseEc2PublicKey;
  kemKey: CoseEc2PublicKey;
  encoded: string;
}
