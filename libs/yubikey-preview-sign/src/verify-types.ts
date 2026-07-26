/** Browser-safe public-key shape consumed by the standalone verifier. */
export interface CoseEc2PublicKey {
  kty: 2;
  algorithm: number;
  curve: 1;
  x: string;
  y: string;
}

/** Browser-safe ARKG seed public material consumed by derivation. */
export interface CoseArkgSeedPublicMaterial {
  kty: -65537;
  algorithm: -65700;
  derivedAlgorithm: -9;
  blindingKey: CoseEc2PublicKey;
  kemKey: CoseEc2PublicKey;
}

/** Wire-decoded ARKG seed, including its original CBOR representation. */
export interface CoseArkgSeedPublicKey extends CoseArkgSeedPublicMaterial {
  encoded: string;
}
