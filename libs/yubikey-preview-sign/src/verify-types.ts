/** Browser-safe public-key shape consumed by the standalone verifier. */
export interface CoseEc2PublicKey {
  kty: 2;
  algorithm: number;
  curve: 1;
  x: string;
  y: string;
}
