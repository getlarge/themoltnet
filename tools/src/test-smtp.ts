import net from 'node:net';
import { stdin as input, stdout as output } from 'node:process';
import readline from 'node:readline/promises';
import tls, { type ConnectionOptions, type TLSSocket } from 'node:tls';

type SocketLike = net.Socket | TLSSocket;

interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  skipSslVerify: boolean;
  disableStartTls: boolean;
}

interface SmtpResponse {
  code: number;
  lines: string[];
}

function parseBoolean(value: string | null): boolean {
  return value === '1' || value?.toLowerCase() === 'true';
}

function parseSmtpUri(uri: string): SmtpConfig {
  let url: URL;
  try {
    url = new URL(uri);
  } catch (error) {
    throw new Error(
      `Invalid SMTP_CONNECTION_URI: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const secure = url.protocol === 'smtps:';
  if (!secure && url.protocol !== 'smtp:') {
    throw new Error(
      `Unsupported SMTP protocol "${url.protocol}". Use smtp:// or smtps://`,
    );
  }

  const host = url.hostname;
  const username = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  const port = url.port.length > 0 ? Number(url.port) : secure ? 465 : 587;

  if (!host) {
    throw new Error('SMTP_CONNECTION_URI must include a host');
  }
  if (!username) {
    throw new Error('SMTP_CONNECTION_URI must include a username');
  }
  if (!password) {
    throw new Error('SMTP_CONNECTION_URI must include a password');
  }
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid SMTP port "${url.port}"`);
  }

  return {
    host,
    port,
    secure,
    username,
    password,
    skipSslVerify: parseBoolean(url.searchParams.get('skip_ssl_verify')),
    disableStartTls: parseBoolean(url.searchParams.get('disable_starttls')),
  };
}

class SmtpClient {
  private socket: SocketLike | null = null;

  private buffer = '';

  private readonly queue: Array<(response: SmtpResponse) => void> = [];

  async connect(config: SmtpConfig): Promise<void> {
    const socket = await this.openSocket(config);
    this.attachSocket(socket);
    const greeting = await this.readResponse();
    this.assertResponse(greeting, [220], 'initial greeting');
  }

  async ehlo(name: string): Promise<SmtpResponse> {
    return this.sendCommand(`EHLO ${name}`, [250], 'EHLO');
  }

  async startTls(config: SmtpConfig, serverName: string): Promise<void> {
    const response = await this.sendCommand('STARTTLS', [220], 'STARTTLS');
    this.assertResponse(response, [220], 'STARTTLS');

    const plainSocket = this.getSocket();
    const secureSocket = await new Promise<TLSSocket>((resolve, reject) => {
      const tlsOptions: ConnectionOptions = {
        socket: plainSocket,
        servername: serverName,
        rejectUnauthorized: !config.skipSslVerify,
      };
      const upgraded = tls.connect(tlsOptions, () => resolve(upgraded));
      upgraded.once('error', reject);
    });

    this.attachSocket(secureSocket);
  }

  async auth(config: SmtpConfig, ehloResponse: SmtpResponse): Promise<void> {
    const capabilities = ehloResponse.lines.slice(1).map((line) => line.trim());
    const authLine = capabilities.find((line) => {
      return line.toUpperCase().startsWith('AUTH ');
    });

    if (authLine?.toUpperCase().includes('PLAIN')) {
      const payload = Buffer.from(
        `\u0000${config.username}\u0000${config.password}`,
      ).toString('base64');
      await this.sendCommand(`AUTH PLAIN ${payload}`, [235], 'AUTH PLAIN');
      return;
    }

    if (authLine?.toUpperCase().includes('LOGIN')) {
      await this.sendCommand('AUTH LOGIN', [334], 'AUTH LOGIN');
      await this.sendCommand(
        Buffer.from(config.username).toString('base64'),
        [334],
        'AUTH LOGIN username',
      );
      await this.sendCommand(
        Buffer.from(config.password).toString('base64'),
        [235],
        'AUTH LOGIN password',
      );
      return;
    }

    throw new Error(
      `SMTP server does not advertise AUTH PLAIN or AUTH LOGIN. Capabilities: ${capabilities.join(', ')}`,
    );
  }

  async sendMail(from: string, to: string, subject: string, body: string) {
    await this.sendCommand(`MAIL FROM:<${from}>`, [250], 'MAIL FROM');
    await this.sendCommand(`RCPT TO:<${to}>`, [250, 251], 'RCPT TO');
    await this.sendCommand('DATA', [354], 'DATA');

    const message = [
      `From: ${from}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      '',
      body.replace(/\r?\n/g, '\r\n'),
      '.',
    ]
      .join('\r\n')
      .replace(/\r\n\./g, '\r\n..');

    this.write(`${message}\r\n`);
    const response = await this.readResponse();
    this.assertResponse(response, [250], 'message body');
  }

  async quit(): Promise<void> {
    if (!this.socket) {
      return;
    }
    try {
      await this.sendCommand('QUIT', [221], 'QUIT');
    } finally {
      this.socket.end();
      this.socket = null;
    }
  }

  private async openSocket(config: SmtpConfig): Promise<SocketLike> {
    return new Promise<SocketLike>((resolve, reject) => {
      const onError = (error: Error) => reject(error);
      if (config.secure) {
        const socket = tls.connect(
          {
            host: config.host,
            port: config.port,
            servername: config.host,
            rejectUnauthorized: !config.skipSslVerify,
          },
          () => resolve(socket),
        );
        socket.once('error', onError);
        return;
      }

      const socket = net.connect({ host: config.host, port: config.port }, () =>
        resolve(socket),
      );
      socket.once('error', onError);
    });
  }

  private attachSocket(socket: SocketLike) {
    this.socket?.removeAllListeners();
    this.socket = socket;
    this.buffer = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.flushQueue();
    });
  }

  private getSocket(): SocketLike {
    if (!this.socket) {
      throw new Error('SMTP socket is not connected');
    }
    return this.socket;
  }

  private write(data: string) {
    this.getSocket().write(data);
  }

  private async sendCommand(
    command: string,
    expectedCodes: number[],
    label: string,
  ): Promise<SmtpResponse> {
    this.write(`${command}\r\n`);
    const response = await this.readResponse();
    this.assertResponse(response, expectedCodes, label);
    return response;
  }

  private async readResponse(): Promise<SmtpResponse> {
    const ready = this.tryParseResponse();
    if (ready) {
      return ready;
    }

    return new Promise<SmtpResponse>((resolve) => {
      this.queue.push(resolve);
    });
  }

  private flushQueue() {
    while (this.queue.length > 0) {
      const response = this.tryParseResponse();
      if (!response) {
        return;
      }
      const resolve = this.queue.shift();
      resolve?.(response);
    }
  }

  private tryParseResponse(): SmtpResponse | null {
    const lines = this.buffer.split('\r\n');
    if (lines.length < 2) {
      return null;
    }

    const collected: string[] = [];
    let consumed = 0;

    for (const line of lines) {
      consumed += line.length + 2;
      if (line.length === 0) {
        continue;
      }

      collected.push(line);
      if (/^\d{3} /.test(line)) {
        this.buffer = this.buffer.slice(consumed);
        return {
          code: Number(line.slice(0, 3)),
          lines: collected,
        };
      }

      if (!/^\d{3}-/.test(line)) {
        this.buffer = this.buffer.slice(consumed);
        return {
          code: Number.NaN,
          lines: collected,
        };
      }
    }

    return null;
  }

  private assertResponse(
    response: SmtpResponse,
    expectedCodes: number[],
    label: string,
  ) {
    if (expectedCodes.includes(response.code)) {
      return;
    }
    throw new Error(
      `SMTP ${label} failed: expected ${expectedCodes.join('/')} but got ${
        response.code
      } (${response.lines.join(' | ')})`,
    );
  }
}

async function prompt(
  rl: readline.Interface,
  label: string,
  fallback?: string,
): Promise<string> {
  const suffix = fallback ? ` [${fallback}]` : '';
  const answer = (await rl.question(`${label}${suffix}: `)).trim();
  return answer || fallback || '';
}

async function main() {
  const rl = readline.createInterface({ input, output });
  const client = new SmtpClient();

  try {
    const smtpUri = await prompt(
      rl,
      'SMTP_CONNECTION_URI',
      process.env['SMTP_CONNECTION_URI'],
    );
    if (!smtpUri) {
      throw new Error('SMTP_CONNECTION_URI is required');
    }

    const config = parseSmtpUri(smtpUri);
    const defaultFrom = process.env['SMTP_TEST_FROM'] || config.username;
    const from = await prompt(rl, 'From address', defaultFrom);
    const to = await prompt(
      rl,
      'Recipient address',
      process.env['SMTP_TEST_TO'],
    );
    if (!to) {
      throw new Error('Recipient address is required');
    }

    const subject = await prompt(
      rl,
      'Subject',
      `MoltNet SMTP probe ${new Date().toISOString()}`,
    );
    const body = await prompt(
      rl,
      'Body',
      'This is a direct SMTP probe from the MoltNet tools script.',
    );

    output.write(
      `Connecting to ${config.host}:${config.port} using ${
        config.secure ? 'implicit TLS' : 'SMTP'
      }...\n`,
    );
    await client.connect(config);
    let ehlo = await client.ehlo('localhost');

    const startTlsAvailable = ehlo.lines.some((line) => {
      return line.toUpperCase().includes('STARTTLS');
    });

    if (!config.secure && startTlsAvailable && !config.disableStartTls) {
      output.write('Upgrading connection with STARTTLS...\n');
      await client.startTls(config, config.host);
      ehlo = await client.ehlo('localhost');
    }

    output.write('Authenticating...\n');
    await client.auth(config, ehlo);
    output.write(`Sending test message to ${to}...\n`);
    await client.sendMail(from, to, subject, body);
    output.write('SMTP probe succeeded.\n');
  } finally {
    await client.quit().catch(() => undefined);
    rl.close();
  }
}

await main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : `Unknown error: ${String(error)}`;
  console.error(`SMTP probe failed: ${message}`);
  process.exitCode = 1;
});
