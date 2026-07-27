import { createWriteStream, type WriteStream } from 'node:fs';

export interface SignerLogFields {
  ceremonyId?: string;
  code?: string;
  operation?: string;
}

export interface SignerLogger {
  close(): void;
  error(event: string, fields?: SignerLogFields): void;
  info(event: string, fields?: SignerLogFields): void;
  warn(event: string, fields?: SignerLogFields): void;
}

export function createSignerLogger(logFile?: string): SignerLogger {
  const file: WriteStream | undefined = logFile
    ? createWriteStream(logFile, { flags: 'a', mode: 0o600 })
    : undefined;

  const write = (
    level: 'error' | 'info' | 'warn',
    event: string,
    fields: SignerLogFields = {},
  ) => {
    const entry = `${JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      event,
      ...(fields.ceremonyId ? { ceremonyId: fields.ceremonyId } : {}),
      ...(fields.operation ? { operation: fields.operation } : {}),
      ...(fields.code ? { code: fields.code } : {}),
    })}\n`;
    process.stderr.write(entry);
    file?.write(entry);
  };

  return {
    close: () => file?.end(),
    error: (event, fields) => write('error', event, fields),
    info: (event, fields) => write('info', event, fields),
    warn: (event, fields) => write('warn', event, fields),
  };
}
