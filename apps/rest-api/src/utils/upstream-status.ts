/**
 * HTTP status carried by an Ory client error (`@ory/client-fetch`), or
 * `undefined` for anything else: a network failure, a body-parse error, or a
 * non-error value. Every Ory status check in rest-api goes through this one
 * extractor, so a change in the client's error shape is fixed in one place.
 */
export function upstreamStatus(error: unknown): number | undefined {
  if (
    typeof error !== 'object' ||
    error === null ||
    !('response' in error) ||
    typeof error.response !== 'object' ||
    error.response === null ||
    !('status' in error.response) ||
    typeof error.response.status !== 'number'
  ) {
    return undefined;
  }
  return error.response.status;
}
