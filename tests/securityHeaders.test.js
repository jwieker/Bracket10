import { securityHeaders } from '../src/middleware/securityHeaders.js';

// Captures setHeader calls into a plain object so tests can assert on the
// composed CSP / Referrer-Policy / HSTS values instead of mocking next().
function runMiddleware() {
  const headers = {};
  const res = {
    setHeader: vi.fn((name, value) => {
      headers[name] = value;
    }),
  };
  const next = vi.fn();
  securityHeaders({}, res, next);
  return { headers, res, next };
}

// Parses the composed CSP header back into a directive → values map for
// per-directive assertions that won't break on directive reordering.
function parseCSP(header) {
  const out = {};
  for (const segment of header.split(';')) {
    const trimmed = segment.trim();
    if (!trimmed) continue;
    const [directive, ...values] = trimmed.split(/\s+/);
    out[directive] = values;
  }
  return out;
}

describe('securityHeaders middleware', () => {
  test('calls next() exactly once', () => {
    const { next } = runMiddleware();
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('sets all five required security headers on every response', () => {
    const { headers } = runMiddleware();
    expect(headers).toHaveProperty('Content-Security-Policy');
    expect(headers).toHaveProperty('Referrer-Policy', 'same-origin');
    expect(headers).toHaveProperty('X-Content-Type-Options', 'nosniff');
    expect(headers).toHaveProperty('X-Frame-Options', 'DENY');
    expect(headers).toHaveProperty(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains'
    );
  });

  describe('Content-Security-Policy directives', () => {
    test("default-src is 'self' only (no wildcards)", () => {
      const { headers } = runMiddleware();
      const csp = parseCSP(headers['Content-Security-Policy']);
      expect(csp['default-src']).toEqual(["'self'"]);
    });

    test("frame-src and object-src are locked to 'none' to block embedding/plugins", () => {
      const { headers } = runMiddleware();
      const csp = parseCSP(headers['Content-Security-Policy']);
      expect(csp['frame-src']).toEqual(["'none'"]);
      expect(csp['object-src']).toEqual(["'none'"]);
    });

    test("form-action is locked to 'self' and Google's OAuth host (no arbitrary POSTs)", () => {
      const { headers } = runMiddleware();
      const csp = parseCSP(headers['Content-Security-Policy']);
      expect(csp['form-action']).toContain("'self'");
      expect(csp['form-action']).toContain('https://accounts.google.com');
      // No wildcard / data / blob allowed in form-action — those would weaken CSRF protection
      expect(csp['form-action'].some((v) => v === '*' || v === 'data:' || v === 'blob:')).toBe(false);
    });

    test('script-src allows the explicitly-trusted CDNs and analytics, nothing else', () => {
      const { headers } = runMiddleware();
      const csp = parseCSP(headers['Content-Security-Policy']);
      // Required trusted sources
      expect(csp['script-src']).toContain("'self'");
      expect(csp['script-src']).toContain('https://www.googletagmanager.com');
      expect(csp['script-src']).toContain('https://ajax.googleapis.com');
      expect(csp['script-src']).toContain('https://cdn.jsdelivr.net');
      // Regression guard: no wildcard, no http: schemes, no data: URLs
      expect(csp['script-src'].some((v) => v === '*' || v === 'http:' || v === 'data:')).toBe(false);
    });

    test("img-src allows data: URIs and https sources (covers icons, OG images, analytics pixels)", () => {
      const { headers } = runMiddleware();
      const csp = parseCSP(headers['Content-Security-Policy']);
      expect(csp['img-src']).toContain("'self'");
      expect(csp['img-src']).toContain('data:');
      expect(csp['img-src']).toContain('https:');
    });

    test('HSTS max-age is at least 1 year (browsers reject shorter for preload list eligibility)', () => {
      const { headers } = runMiddleware();
      const m = /max-age=(\d+)/.exec(headers['Strict-Transport-Security']);
      expect(m).not.toBeNull();
      const seconds = Number(m[1]);
      expect(seconds).toBeGreaterThanOrEqual(31536000); // 365 days
    });

    test('composes the CSP header in `directive value1 value2; ...` format', () => {
      const { headers } = runMiddleware();
      const header = headers['Content-Security-Policy'];
      expect(header).toMatch(/^[a-z-]+ [^;]+(; [a-z-]+ [^;]+)+$/);
    });
  });
});
