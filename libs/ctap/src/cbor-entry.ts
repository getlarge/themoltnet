/**
 * Canonical CBOR helpers for CTAP and COSE protocol maps.
 *
 * This explicit subpath keeps wire-format utilities separate from the public
 * transport API while allowing protocol packages to depend on them.
 */
export * from './cbor.js';
