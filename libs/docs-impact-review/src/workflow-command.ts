/**
 * A value safe inside a GitHub Actions workflow command (`::error::…`): the
 * runner decodes `%25`, `%0D` and `%0A`, so a newline in untrusted text
 * cannot end the command and start another.
 */
export function workflowCommandValue(text: string): string {
  return text.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}
