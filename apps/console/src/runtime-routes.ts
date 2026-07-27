export function legacyProfilesDestination(
  search: string,
  hash: string,
): string {
  return `/runtime/profiles${search}${hash}`;
}
