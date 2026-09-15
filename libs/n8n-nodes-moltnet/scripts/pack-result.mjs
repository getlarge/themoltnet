import { isAbsolute, resolve } from 'node:path';

export function parsePackResult(output) {
  const parsed = JSON.parse(output);
  const result = Array.isArray(parsed)
    ? parsed[0]
    : parsed.filename
      ? parsed
      : Object.values(parsed)[0];
  if (!result || typeof result.filename !== 'string') {
    throw new Error('package pack did not return a filename');
  }
  return result;
}

export function resolvePackFilename(output, directory) {
  const result = parsePackResult(output);
  return isAbsolute(result.filename)
    ? result.filename
    : resolve(directory, result.filename);
}
