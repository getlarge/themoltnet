export interface DeviceDescriptor {
  id: string;
  path: string;
  product?: string;
  manufacturer?: string;
  serialNumber?: string;
  vendorId: number;
  productId: number;
}

export interface CtapConnection {
  readonly device: DeviceDescriptor;
  cbor(
    command: number,
    request?: Uint8Array,
    timeoutMs?: number,
  ): Promise<Uint8Array>;
  close(): Promise<void>;
}

export interface CtapGetInfo {
  versions: readonly string[];
  extensions: readonly string[];
  algorithms: readonly number[];
  raw: ReadonlyMap<unknown, unknown>;
}
