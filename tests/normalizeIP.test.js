import { normalizeIP } from '../src/middleware/rateLimit.js';

vi.mock('../src/utils/logger.js', () => ({
  __esModule: true,
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    performance: vi.fn(),
  },
}));

vi.mock('@google-cloud/firestore', () => ({
  Firestore: { Timestamp: { fromMillis: (ms) => ({ __ts: ms }) } },
}));

vi.mock('../src/config/firestore.js', () => ({ db: {} }));

describe('normalizeIP', () => {
  test('returns IPv4 addresses host-exact', () => {
    expect(normalizeIP('192.168.1.5')).toBe('192.168.1.5');
    expect(normalizeIP('127.0.0.1')).toBe('127.0.0.1');
  });

  test('buckets IPv6 addresses to their /64 prefix', () => {
    const a = normalizeIP('2001:db8:abcd:1234:5678:9abc:def0:0001');
    const b = normalizeIP('2001:db8:abcd:1234:ffff:ffff:ffff:ffff');
    // Different hosts within the same /64 collapse to one bucket key.
    expect(a).toBe('2001:db8:abcd:1234::/64');
    expect(a).toBe(b);
  });

  test('different /64 prefixes map to different buckets', () => {
    const a = normalizeIP('2001:db8:abcd:1234::1');
    const b = normalizeIP('2001:db8:abcd:5678::1');
    expect(a).not.toBe(b);
  });

  test('treats IPv4-mapped IPv6 as the underlying IPv4 host', () => {
    expect(normalizeIP('::ffff:192.168.1.5')).toBe('192.168.1.5');
  });

  test('passes through unparseable / empty input unchanged', () => {
    expect(normalizeIP('unknown')).toBe('unknown');
    expect(normalizeIP('')).toBe('');
    expect(normalizeIP(undefined)).toBe(undefined);
  });
});
