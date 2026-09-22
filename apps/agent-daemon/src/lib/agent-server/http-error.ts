/** A route failure with a stable wire code; the server error handler maps it verbatim. */
export class AgentServerHttpError extends Error {
  override name = 'AgentServerHttpError';
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}
