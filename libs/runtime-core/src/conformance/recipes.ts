/**
 * Conformance recipes are POSIX `sh` snippets with a structured header line.
 * Real adapters execute the shell; the in-memory reference adapter parses the
 * header to simulate the same action, so the suite's semantics are tested
 * without a sandbox.
 */
export const RECIPE_HEADER_PREFIX = '# moltnet-conformance:';

export type Recipe =
  | { op: 'write-file'; path: string; content: string }
  | { op: 'write-file-via-child'; path: string; content: string; depth: number }
  | {
      op: 'http-get';
      url: string;
      bearerEnv?: string;
      /** Pin the URL hostname to this address (curl --resolve). */
      resolveTo?: string;
    }
  | { op: 'sleep'; seconds: number }
  | { op: 'print-env'; name: string }
  | { op: 'read-file'; path: string };

function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function body(recipe: Recipe): string {
  switch (recipe.op) {
    case 'write-file':
      return `mkdir -p "$(dirname ${shQuote(recipe.path)})" && printf '%s' ${shQuote(recipe.content)} > ${shQuote(recipe.path)}`;
    case 'write-file-via-child': {
      let inner = `printf '%s' ${shQuote(recipe.content)} > ${shQuote(recipe.path)}`;
      for (let i = 0; i < recipe.depth; i += 1) {
        inner = `sh -c ${shQuote(inner)}`;
      }
      return `mkdir -p "$(dirname ${shQuote(recipe.path)})" && ${inner}`;
    }
    case 'http-get': {
      const url = new URL(recipe.url);
      const pin = recipe.resolveTo
        ? ` --resolve ${shQuote(`${url.hostname}:${url.port || '80'}:${recipe.resolveTo}`)}`
        : '';
      const auth = recipe.bearerEnv
        ? ` -H "Authorization: Bearer $${recipe.bearerEnv}"`
        : '';
      return `curl -fsS --max-time 10${pin}${auth} ${shQuote(recipe.url)}`;
    }
    case 'sleep':
      return `sleep ${recipe.seconds}`;
    case 'print-env':
      return `printf '%s' "\${${recipe.name}:-}"`;
    case 'read-file':
      return `cat ${shQuote(recipe.path)}`;
  }
}

export function renderRecipe(recipe: Recipe): string {
  return `${RECIPE_HEADER_PREFIX}${JSON.stringify(recipe)}\n${body(recipe)}\n`;
}

export function parseRecipe(command: string): Recipe | undefined {
  const firstLine = command.split('\n', 1)[0] ?? '';
  if (!firstLine.startsWith(RECIPE_HEADER_PREFIX)) return undefined;
  return JSON.parse(firstLine.slice(RECIPE_HEADER_PREFIX.length)) as Recipe;
}
