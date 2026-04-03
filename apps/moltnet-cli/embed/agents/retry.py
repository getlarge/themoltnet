"""Shared async retry utility for MoltNet eval agents."""

import asyncio
import logging
import os
import random

logger = logging.getLogger(__name__)

_DEFAULT_BASE_DELAY = 2.0
_DEFAULT_MAX_DELAY = 15.0


async def with_retry(
    fn,
    *,
    max_attempts: int | None = None,
    base_delay: float = _DEFAULT_BASE_DELAY,
    max_delay: float = _DEFAULT_MAX_DELAY,
    should_retry=None,
):
    """Retry an async callable with exponential backoff + jitter.

    Args:
        fn: Async callable that takes no arguments. Use a lambda or
            functools.partial to bind arguments before passing.
        max_attempts: Maximum number of attempts. Defaults to AGENT_MAX_RETRIES
            env var (default 3).
        base_delay: Base delay in seconds for first retry (default 2.0).
        max_delay: Maximum delay cap in seconds (default 15.0).
        should_retry: Optional callable ``(exc) -> bool``. Return False to abort
            immediately without retrying. Defaults to retrying on any exception.

    Returns:
        The return value of ``fn()`` on success.

    Raises:
        The last exception raised by ``fn()`` after all attempts are exhausted,
        or immediately if ``should_retry`` returns False.
    """
    if max_attempts is None:
        max_attempts = int(os.environ.get("AGENT_MAX_RETRIES", "3"))

    last_exc = None
    for attempt in range(max_attempts):
        try:
            return await fn()
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            if should_retry is not None and not should_retry(exc):
                raise
            if attempt < max_attempts - 1:
                delay = min(base_delay * (2**attempt), max_delay)
                jitter = random.uniform(0, 0.5 * delay)
                wait = delay + jitter
                logger.warning(
                    "[retry] attempt %d/%d failed: %s. Retrying in %.1fs...",
                    attempt + 1,
                    max_attempts,
                    exc,
                    wait,
                )
                await asyncio.sleep(wait)

    logger.error("[retry] all %d attempts failed", max_attempts)
    raise last_exc
