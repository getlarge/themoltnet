import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Abort upstream work when the client disconnects before a response completes.
 * Normal response completion removes the listeners without aborting.
 */
export function requestAbortSignal(
  request: FastifyRequest,
  reply: FastifyReply,
): AbortSignal {
  const controller = new AbortController();

  const cleanup = () => {
    request.raw.off('aborted', abort);
    reply.raw.off('close', onClose);
    reply.raw.off('finish', cleanup);
  };
  const abort = () => {
    cleanup();
    controller.abort(new Error('Client disconnected'));
  };
  const onClose = () => {
    if (!reply.raw.writableFinished) abort();
  };

  if (request.raw.aborted || reply.raw.destroyed) {
    abort();
  } else {
    request.raw.once('aborted', abort);
    reply.raw.once('close', onClose);
    reply.raw.once('finish', cleanup);
  }

  return controller.signal;
}
