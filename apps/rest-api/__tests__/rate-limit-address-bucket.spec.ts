import { describe, expect, it } from 'vitest';

import { clientAddressBucket } from '../src/plugins/rate-limit.js';

describe('client address buckets', () => {
  it('keeps dotted IPv4-mapped peers in separate IPv4 buckets', () => {
    expect(clientAddressBucket('::ffff:1.2.3.4')).toBe('1.2.3.4');
    expect(clientAddressBucket('::FFFF:5.6.7.8')).toBe('5.6.7.8');
  });

  it('canonicalizes IPv6 case and groups addresses by /64', () => {
    expect(clientAddressBucket('2001:DB8:ABCD:1::A')).toBe(
      '2001:0db8:abcd:0001::/64',
    );
    expect(clientAddressBucket('2001:db8:abcd:1::b')).toBe(
      clientAddressBucket('2001:DB8:ABCD:1::A'),
    );
  });
});
