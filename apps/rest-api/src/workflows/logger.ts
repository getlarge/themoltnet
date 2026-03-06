// ── Logger Interface ───────────────────────────────────────────
// Matches the Pino BaseLogger subset; keeps the workflow dep-free
// from Fastify types while still supporting structured log objects.

export interface Logger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}
