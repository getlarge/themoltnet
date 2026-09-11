export function safeErrorContext(
  error: unknown,
): Record<string, string | number> {
  const context: Record<string, string | number> = {
    errorType: error instanceof Error ? error.name : typeof error,
  };
  const applicationCode = safeErrorToken(
    (error as { code?: unknown } | null)?.code,
  );
  if (applicationCode) context['applicationCode'] = applicationCode;
  const cause = error instanceof Error ? error.cause : undefined;
  if (cause instanceof Error) {
    context['causeType'] = cause.name;
    const causeMessage = safeLogMessage(cause.message);
    if (causeMessage) context['causeMessage'] = causeMessage;
  }
  const fsCode = safeErrorToken((cause as NodeJS.ErrnoException | null)?.code);
  const syscall = safeErrorToken(
    (cause as NodeJS.ErrnoException | null)?.syscall,
  );
  if (fsCode) context['fsCode'] = fsCode;
  if (syscall) context['syscall'] = syscall;
  const causeStatus = (cause as { statusCode?: unknown } | null)?.statusCode;
  if (typeof causeStatus === 'number') context['causeStatusCode'] = causeStatus;
  return context;
}

export function safeLogMessage(value: string): string | undefined {
  const normalized = value.replace(/[\r\n\t]/gu, ' ').trim();
  return normalized ? normalized.slice(0, 500) : undefined;
}

export function safeErrorToken(value: unknown): string | undefined {
  return typeof value === 'string' && /^[a-z0-9_:-]{1,64}$/iu.test(value)
    ? value
    : undefined;
}
