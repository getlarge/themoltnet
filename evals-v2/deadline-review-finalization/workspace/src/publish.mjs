import { canPublish } from './rollout.mjs';

export function rolloutDecision(checks) {
  return canPublish(checks) ? 'publish' : 'hold';
}
