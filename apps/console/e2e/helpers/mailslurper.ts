import { MAILSLURPER_API_URL } from './env.js';

export interface MailRecord {
  to: string[];
  body?: string;
  html?: string;
  subject?: string;
  dateSentMs?: number;
}

export interface MailVerificationData {
  code?: string;
  link?: string;
}

export interface WaitForVerificationOptions {
  sinceIso?: string;
  maxAttempts?: number;
  pollIntervalMs?: number;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function extractRecipient(record: unknown): string[] {
  if (!record || typeof record !== 'object') return [];
  const obj = record as Record<string, unknown>;
  const toAddresses = asArray<unknown>(
    obj['toAddresses'] ?? obj['ToAddresses'],
  );
  return toAddresses
    .map((entry) => {
      if (typeof entry === 'string') return entry;
      if (!entry || typeof entry !== 'object') return undefined;
      const address =
        (entry as Record<string, unknown>)['address'] ??
        (entry as Record<string, unknown>)['Address'];
      return typeof address === 'string' ? address : undefined;
    })
    .filter((value): value is string => !!value);
}

function parseMailRecords(payload: unknown): MailRecord[] {
  if (!payload || typeof payload !== 'object') return [];
  const obj = payload as Record<string, unknown>;
  const items = asArray<unknown>(obj['mailItems'] ?? obj['MailItems']);

  return items.map((item) => {
    if (!item || typeof item !== 'object') return { to: [] };
    const mail = item as Record<string, unknown>;
    const body = typeof mail['body'] === 'string' ? mail['body'] : undefined;
    const html =
      typeof mail['body'] === 'string'
        ? undefined
        : typeof mail['Body'] === 'string'
          ? mail['Body']
          : undefined;
    const subject =
      typeof mail['subject'] === 'string'
        ? mail['subject']
        : typeof mail['Subject'] === 'string'
          ? mail['Subject']
          : undefined;
    const dateSent =
      typeof mail['dateSent'] === 'string'
        ? mail['dateSent']
        : typeof mail['DateSent'] === 'string'
          ? mail['DateSent']
          : undefined;
    const dateSentMs = dateSent ? Date.parse(dateSent) : Number.NaN;

    return {
      to: extractRecipient(mail),
      body,
      html,
      subject,
      dateSentMs: Number.isFinite(dateSentMs) ? dateSentMs : undefined,
    };
  });
}

function extractVerificationLink(mail: MailRecord): string | null {
  const content = `${mail.body ?? ''}\n${mail.html ?? ''}`;
  const matches = content.match(/https?:\/\/[^\s"'<>)]*/g) ?? [];
  for (const candidate of matches) {
    if (candidate.includes('/self-service/verification')) {
      return candidate;
    }
  }
  return null;
}

function extractVerificationCode(mail: MailRecord): string | null {
  const content = `${mail.body ?? ''}\n${mail.html ?? ''}`;
  const match = content.match(/\b\d{6}\b/);
  return match ? match[0] : null;
}

async function fetchMailPage(): Promise<unknown> {
  const response = await fetch(`${MAILSLURPER_API_URL}/mail?pageNumber=1`);
  if (!response.ok) {
    throw new Error(`Failed to query Mailslurper: ${response.status}`);
  }
  return response.json();
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function waitForVerificationData(
  email: string,
  {
    sinceIso,
    maxAttempts = 30,
    pollIntervalMs = 2000,
  }: WaitForVerificationOptions = {},
): Promise<MailVerificationData> {
  const sinceMs = sinceIso ? Date.parse(sinceIso) : 0;
  for (let i = 0; i < maxAttempts; i++) {
    const payload = await fetchMailPage();
    const records = parseMailRecords(payload);
    for (const record of records) {
      if (
        !record.to.some((addr) => addr.toLowerCase() === email.toLowerCase())
      ) {
        continue;
      }
      if (sinceMs > 0) {
        if (record.dateSentMs === undefined || record.dateSentMs < sinceMs) {
          continue;
        }
      }
      const code = extractVerificationCode(record);
      const link = extractVerificationLink(record);
      if (code || link) {
        return { code: code ?? undefined, link: link ?? undefined };
      }
    }
    await sleep(pollIntervalMs);
  }

  throw new Error(`Timed out waiting for verification data for ${email}`);
}

export async function waitForVerificationCode(
  email: string,
  options: WaitForVerificationOptions = {},
): Promise<string> {
  const data = await waitForVerificationData(email, options);
  if (!data.code) {
    throw new Error(`No verification code found for ${email}`);
  }
  return data.code;
}
