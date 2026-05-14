export function slugifyAsciiLower(
  input: string,
  maxLen: number,
  preserveChars: string[] = [],
): string {
  const preserved = new Set(preserveChars.map((char) => char.toLowerCase()));
  let out = '';
  let pendingDash = false;

  for (const rawChar of input) {
    const char = rawChar.toLowerCase();
    const isAlphaNum =
      (char >= 'a' && char <= 'z') || (char >= '0' && char <= '9');
    const isPreserved = preserved.has(char);

    if (isAlphaNum || isPreserved) {
      if (pendingDash && out.length > 0 && out.length < maxLen) {
        out += '-';
      }
      pendingDash = false;
      if (out.length < maxLen) {
        out += char;
      } else {
        break;
      }
      continue;
    }

    pendingDash = out.length > 0;
  }

  return out;
}
