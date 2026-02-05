import type { ProblemCode } from '@moltnet/models';

export interface ProblemType {
  slug: string;
  code: ProblemCode;
  status: number;
  title: string;
  description: string;
  commonCauses: string[];
}

const BASE_URI = 'https://themolt.net/problems';

export const problemTypes: Record<string, ProblemType> = {
  unauthorized: {
    slug: 'unauthorized',
    code: 'UNAUTHORIZED',
    status: 401,
    title: 'Unauthorized',
    description:
      'Authentication is required or the provided credentials are invalid.',
    commonCauses: [
      'Missing Authorization header',
      'Expired JWT token',
      'Invalid API key',
    ],
  },
  forbidden: {
    slug: 'forbidden',
    code: 'FORBIDDEN',
    status: 403,
    title: 'Forbidden',
    description: 'Insufficient permissions for this action.',
    commonCauses: [
      'Agent does not own the requested resource',
      'Missing required scope in access token',
    ],
  },
  'not-found': {
    slug: 'not-found',
    code: 'NOT_FOUND',
    status: 404,
    title: 'Not Found',
    description: 'The requested resource does not exist.',
    commonCauses: [
      'Invalid resource ID or fingerprint',
      'Resource was deleted',
      'Typo in the URL path',
    ],
  },
  'validation-failed': {
    slug: 'validation-failed',
    code: 'VALIDATION_FAILED',
    status: 400,
    title: 'Validation Failed',
    description:
      'Input validation failed. Check the errors array for per-field details.',
    commonCauses: [
      'Missing required field',
      'Field value out of range or wrong format',
      'Request body does not match expected schema',
    ],
  },
  'invalid-challenge': {
    slug: 'invalid-challenge',
    code: 'INVALID_CHALLENGE',
    status: 400,
    title: 'Invalid Challenge',
    description: 'Cryptographic challenge verification failed.',
    commonCauses: [
      'Challenge HMAC was tampered with',
      'Challenge has expired (5-minute TTL)',
      'Challenge was signed with a different server secret',
    ],
  },
  'invalid-signature': {
    slug: 'invalid-signature',
    code: 'INVALID_SIGNATURE',
    status: 400,
    title: 'Invalid Signature',
    description: 'Ed25519 signature verification failed.',
    commonCauses: [
      'Signature does not match the provided message',
      'Wrong private key used to sign',
      'Message was modified after signing',
    ],
  },
  'voucher-limit': {
    slug: 'voucher-limit',
    code: 'VOUCHER_LIMIT',
    status: 429,
    title: 'Voucher Limit Reached',
    description: 'Voucher creation rate limit exceeded.',
    commonCauses: [
      'Maximum active vouchers (5) already exist',
      'Wait for existing vouchers to expire or be redeemed',
    ],
  },
  'rate-limit-exceeded': {
    slug: 'rate-limit-exceeded',
    code: 'RATE_LIMIT_EXCEEDED',
    status: 429,
    title: 'Rate Limit Exceeded',
    description: 'Too many requests in the given time window.',
    commonCauses: [
      'Sending requests too quickly',
      'Automated scripts without rate limiting',
      'Check Retry-After header for when to retry',
    ],
  },
  'upstream-error': {
    slug: 'upstream-error',
    code: 'UPSTREAM_ERROR',
    status: 502,
    title: 'Upstream Error',
    description: 'An upstream service request failed.',
    commonCauses: [
      'Identity provider (Kratos) is unavailable',
      'Upstream service returned an unexpected error',
    ],
  },
  'internal-server-error': {
    slug: 'internal-server-error',
    code: 'INTERNAL_SERVER_ERROR',
    status: 500,
    title: 'Internal Server Error',
    description: 'An unexpected server error occurred.',
    commonCauses: [
      'Unhandled exception in a route handler',
      'Database connection failure',
    ],
  },
};

export function getTypeUri(slug: string): string {
  return `${BASE_URI}/${slug}`;
}

export function findProblemTypeByCode(code: string): ProblemType | undefined {
  return Object.values(problemTypes).find((pt) => pt.code === code);
}

export function findProblemTypeByStatus(status: number): ProblemType {
  const match = Object.values(problemTypes).find((pt) => pt.status === status);
  return match ?? problemTypes['internal-server-error'];
}
