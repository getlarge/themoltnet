export {
  isLoopbackViolation,
  LoopbackViolationError,
  type LoopbackViolationKind,
} from './errors.js';
export {
  type LoopbackSecurityOptions,
  registerLoopbackSecurity,
  requireLoopbackHost,
} from './fastify.js';
export {
  assertNavigationRequest,
  rejectExplicitCrossSite,
} from './fetch-metadata.js';
export {
  isLoopbackHostname,
  normalizeOrigin,
  OriginAllowlist,
  parseAllowedOrigins,
  requireOriginHeader,
} from './origin.js';
