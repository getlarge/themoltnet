import { createHttpHooks } from '@earendil-works/gondolin';
import { describe, expect, it } from 'vitest';

function ipInfo(hostname: string, ip: string) {
  return {
    hostname,
    ip,
    family: ip.includes(':') ? (6 as const) : (4 as const),
    port: 443,
    protocol: 'https' as const,
  };
}

async function isIpAllowed(
  options: Parameters<typeof createHttpHooks>[0],
  hostname: string,
  ip: string,
): Promise<boolean> {
  const { httpHooks } = createHttpHooks(options);
  return Boolean(await httpHooks.isIpAllowed?.(ipInfo(hostname, ip)));
}

describe('Gondolin runtime HTTP policy', () => {
  it('allows an ordinary hostname when it resolves publicly', async () => {
    await expect(
      isIpAllowed(
        { allowedHosts: ['api.example.com'] },
        'api.example.com',
        '93.184.216.34',
      ),
    ).resolves.toBe(true);
  });

  it('blocks an ordinary hostname when it resolves internally', async () => {
    await expect(
      isIpAllowed(
        { allowedHosts: ['api.example.com'] },
        'api.example.com',
        '127.0.0.1',
      ),
    ).resolves.toBe(false);
  });

  it('allows an explicitly listed internal hostname', async () => {
    await expect(
      isIpAllowed(
        { allowedHosts: [], allowedInternalHosts: ['service.internal'] },
        'service.internal',
        '10.0.0.8',
      ),
    ).resolves.toBe(true);
  });

  it.each([
    ['unlisted.example.com', '93.184.216.34'],
    ['unlisted.internal', '192.168.1.10'],
  ])('blocks unlisted hostname %s', async (hostname, ip) => {
    await expect(
      isIpAllowed(
        {
          allowedHosts: ['api.example.com'],
          allowedInternalHosts: ['service.internal'],
        },
        hostname,
        ip,
      ),
    ).resolves.toBe(false);
  });

  it('does not let an ordinary wildcard bypass internal-address blocking', async () => {
    await expect(
      isIpAllowed(
        { allowedHosts: ['*.example.com'] },
        'rebound.example.com',
        '169.254.169.254',
      ),
    ).resolves.toBe(false);
  });
});
