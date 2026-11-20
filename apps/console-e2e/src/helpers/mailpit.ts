import { MAILPIT_API_URL } from './env.js';

interface MailpitSummary {
  ID: string;
  To: Array<{ Address: string }>;
  Created: string;
}

interface MailpitMessage {
  Text: string;
  HTML: string;
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

export async function waitForVerificationData(
  email: string,
  {
    sinceIso,
    maxAttempts = 30,
    pollIntervalMs = 2000,
  }: WaitForVerificationOptions = {},
): Promise<MailVerificationData> {
  const sinceMs = sinceIso ? Date.parse(sinceIso) : 0;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const query = new URLSearchParams({ query: `to:${email}`, limit: '50' });
    const response = await fetch(`${MAILPIT_API_URL}/api/v1/search?${query}`);
    if (!response.ok)
      throw new Error(`Mailpit search failed: ${response.status}`);
    const { messages } = (await response.json()) as {
      messages: MailpitSummary[];
    };
    for (const summary of messages) {
      if (
        !summary.To.some(
          ({ Address }) => Address.toLowerCase() === email.toLowerCase(),
        )
      )
        continue;
      const receivedAt = Date.parse(summary.Created);
      if (!Number.isFinite(receivedAt) || receivedAt < sinceMs) continue;
      const detail = await fetch(
        `${MAILPIT_API_URL}/api/v1/message/${encodeURIComponent(summary.ID)}`,
      );
      if (detail.status === 404) continue;
      if (!detail.ok)
        throw new Error(`Mailpit message read failed: ${detail.status}`);
      const message = (await detail.json()) as MailpitMessage;
      const content = `${message.Text}\n${message.HTML}`;
      const code = content.match(/\b\d{6}\b/)?.[0];
      const link = (content.match(/https?:\/\/[^\s"'<>)]*/g) ?? []).find(
        (url) => url.includes('/self-service/verification'),
      );
      if (code || link) return { code, link };
    }
    await new Promise((resolve) => {
      setTimeout(resolve, pollIntervalMs);
    });
  }
  throw new Error(`Timed out waiting for verification data for ${email}`);
}

export async function waitForVerificationCode(
  email: string,
  options: WaitForVerificationOptions = {},
): Promise<string> {
  const { code } = await waitForVerificationData(email, options);
  if (!code) throw new Error(`No verification code found for ${email}`);
  return code;
}
