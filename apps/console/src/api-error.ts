export function getApiErrorDetail(error: unknown, fallback: string): string {
  if (
    error &&
    typeof error === 'object' &&
    'detail' in error &&
    typeof error.detail === 'string'
  ) {
    return error.detail;
  }
  if (error instanceof Error) return error.message;
  return fallback;
}
