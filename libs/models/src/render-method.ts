/**
 * The `renderMethod` convention for rendered packs (#1857).
 *
 * `renderedPacks.renderMethod` is a free-text `varchar(100)`. The server
 * bifurcates on exactly one thing — whether the label starts with `server:`
 * — and everything else is a caller-authored render whose markdown the
 * caller must supply. This module is the single owner of that convention:
 * the service, the API schemas, the runtime default and the console's
 * trust-tier derivation all read from here.
 *
 * The Go CLI (`apps/moltnet-cli/cobra_pack.go`) cannot import this module;
 * it carries a pointer comment and its default must be kept in sync with
 * `DEFAULT_SERVER_RENDER_METHOD` by hand.
 *
 * Values observed in production data and accepted unchanged:
 * `server:pack-to-docs-v1`, `agent:pack-to-docs-v1`, `agent-refined`.
 * `pi:pack-to-docs-v1` is the live pi-runtime default.
 */
import { Type } from 'typebox';

/** Labels carrying this prefix are rendered deterministically by the server. */
export const SERVER_RENDER_PREFIX = 'server:';

/**
 * Prefixes that identify caller-authored markdown.
 *
 * `agent:` is the canonical documented label, `pi:` is what the pi-runtime
 * emits by default, and `agent-` covers the `agent-refined` family that is
 * live in production data.
 */
export const CALLER_AUTHORED_PREFIXES = ['agent:', 'pi:', 'agent-'] as const;

export const DEFAULT_SERVER_RENDER_METHOD = 'server:pack-to-docs-v1';
export const DEFAULT_AGENT_RENDER_METHOD = 'agent:pack-to-docs-v1';
export const DEFAULT_PI_RENDER_METHOD = 'pi:pack-to-docs-v1';

/** Matches the `varchar(100)` column. */
export const RENDER_METHOD_MAX_LENGTH = 100;

/**
 * Write-side validation pattern: a known prefix followed by at least one
 * non-whitespace character. Stored rows are never re-validated against
 * this; it applies to new writes at the API boundary only.
 */
export const RENDER_METHOD_PATTERN = `^(${[
  SERVER_RENDER_PREFIX,
  ...CALLER_AUTHORED_PREFIXES,
].join('|')})\\S+$`;

export const RenderMethodSchema = Type.String({
  minLength: 1,
  maxLength: RENDER_METHOD_MAX_LENGTH,
  pattern: RENDER_METHOD_PATTERN,
  description:
    'Render method label. Server render methods start with "server:" and must omit renderedMarkdown; caller-authored methods start with "agent:", "pi:" or "agent-" and require it.',
  examples: [DEFAULT_SERVER_RENDER_METHOD, DEFAULT_AGENT_RENDER_METHOD],
});

export type RenderMethodKind = 'server' | 'caller-authored' | 'unrecognised';

/**
 * Read-side classification. Lenient by design: it labels whatever a stored
 * row carries and admits `unrecognised` rather than forcing a tier.
 */
export function classifyRenderMethod(method: string): RenderMethodKind {
  if (method.startsWith(SERVER_RENDER_PREFIX)) return 'server';
  if (CALLER_AUTHORED_PREFIXES.some((prefix) => method.startsWith(prefix))) {
    return 'caller-authored';
  }
  return 'unrecognised';
}

/**
 * The server's bifurcation: a server method is rendered from the source
 * pack; any other method requires caller-supplied markdown.
 */
export function isServerRenderMethod(method: string): boolean {
  return method.startsWith(SERVER_RENDER_PREFIX);
}
