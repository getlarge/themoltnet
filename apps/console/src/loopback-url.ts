export function loopbackHttpUrl(value: string, label: string): URL {
  const url = new URL(value);
  if (
    url.protocol !== 'http:' ||
    (url.hostname !== '127.0.0.1' &&
      url.hostname !== 'localhost' &&
      url.hostname !== '[::1]') ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error(`${label} URL must be plain loopback HTTP`);
  }
  return url;
}
