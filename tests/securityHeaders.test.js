import { securityHeaders, logCspReport } from '../src/middleware/securityHeaders.js';

// Captures setHeader calls into a plain object so tests can assert on the
// composed CSP / Referrer-Policy / HSTS values instead of mocking next().
function runMiddleware(req = {}) {
  const headers = {};
  const res = {
    locals: {},
    setHeader: vi.fn((name, value) => {
      headers[name] = value;
    }),
  };
  const next = vi.fn();
  securityHeaders(req, res, next);
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

    test('script-src is nonce-based with strict-dynamic, no wildcard/http:/data:', () => {
      const { headers, res } = runMiddleware();
      const csp = parseCSP(headers['Content-Security-Policy']);
      expect(csp['script-src']).toContain("'self'");
      expect(csp['script-src']).toContain(`'nonce-${res.locals.cspNonce}'`);
      expect(csp['script-src']).toContain("'strict-dynamic'");
      // 'strict-dynamic' lets the nonce'd loaders pull CDN deps, so the explicit
      // CDN host allowlist is no longer needed in script-src (only `https:` as a
      // fallback for browsers that ignore 'strict-dynamic').
      expect(csp['script-src']).toContain('https:');
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

  describe('per-request nonce + report-only CSP (H1 report-only foundation)', () => {
    test('exposes a per-request nonce on res.locals.cspNonce', () => {
      const { res } = runMiddleware();
      expect(typeof res.locals.cspNonce).toBe('string');
      expect(res.locals.cspNonce.length).toBeGreaterThan(0);
    });

    test('generates a fresh nonce on every request', () => {
      const a = runMiddleware().res.locals.cspNonce;
      const b = runMiddleware().res.locals.cspNonce;
      expect(a).not.toBe(b);
    });

    test("enforcing script-src no longer carries 'unsafe-inline' (CSP flipped — #165)", () => {
      const { headers } = runMiddleware();
      const csp = parseCSP(headers['Content-Security-Policy']);
      expect(csp['script-src']).not.toContain("'unsafe-inline'");
    });

    test("script-src-attr is dropped entirely (inline on*= handlers migrated — #165)", () => {
      const { headers } = runMiddleware();
      const csp = parseCSP(headers['Content-Security-Policy']);
      expect(csp).not.toHaveProperty('script-src-attr');
    });

    test("report-only script-src uses the request nonce + 'strict-dynamic' and drops 'unsafe-inline'", () => {
      const { headers, res } = runMiddleware();
      const ro = parseCSP(headers['Content-Security-Policy-Report-Only']);
      expect(ro['script-src']).toContain(`'nonce-${res.locals.cspNonce}'`);
      expect(ro['script-src']).toContain("'strict-dynamic'");
      expect(ro['script-src']).not.toContain("'unsafe-inline'");
    });

    test('report-only policy points violations at the /csp-report sink', () => {
      const { headers } = runMiddleware();
      const ro = parseCSP(headers['Content-Security-Policy-Report-Only']);
      expect(ro['report-uri']).toContain('/csp-report');
      expect(ro['report-to']).toContain('csp-endpoint');
      expect(headers['Reporting-Endpoints']).toContain('/csp-report');
    });

    test('report endpoint is an absolute URL when the request origin is known', () => {
      const { headers } = runMiddleware({
        protocol: 'https',
        get: (h) => (h === 'host' ? 'bracket10.example' : undefined),
      });
      const ro = parseCSP(headers['Content-Security-Policy-Report-Only']);
      expect(headers['Reporting-Endpoints']).toContain(
        'https://bracket10.example/csp-report'
      );
      expect(ro['report-uri']).toContain('https://bracket10.example/csp-report');
    });

    test("logCspReport strips newlines so log lines can't be forged (CWE-117, audit finding 3)", () => {
      const lines = [];
      const orig = console.warn;
      console.warn = (s) => lines.push(s);
      try {
        logCspReport({ 'csp-report': { 'blocked-uri': 'a\n[csp-report] FORGED' } });
      } finally {
        console.warn = orig;
      }
      expect(lines).toHaveLength(1);
      expect(lines[0]).not.toContain('\n');
      expect(lines[0]).toContain('blocked=a [csp-report] FORGED');
    });

    test('logCspReport strips all control characters and caps field length', () => {
      const lines = [];
      const orig = console.warn;
      console.warn = (s) => lines.push(s);
      try {
        logCspReport({
          'csp-report': {
            'violated-directive': 'x\r\u0000\u001b[31my\u007f',
            'blocked-uri': 'b'.repeat(1000),
          },
        });
      } finally {
        console.warn = orig;
      }
      expect(lines).toHaveLength(1);
      // CR, NUL, ESC (ANSI), DEL all replaced with spaces
      expect(lines[0]).toContain('directive=x   [31my ');
      // hostile field bounded to 256 chars so a 10kb body can't bloat log volume
      expect(lines[0]).toContain(`blocked=${'b'.repeat(256)} `.trimEnd());
      expect(lines[0]).not.toContain('b'.repeat(257));
    });

    test('logCspReport bounds the number of entries processed per request', () => {
      const lines = [];
      const orig = console.warn;
      console.warn = (s) => lines.push(s);
      try {
        logCspReport(Array.from({ length: 50 }, (_, i) => ({ body: { blockedURL: `u${i}` } })));
      } finally {
        console.warn = orig;
      }
      expect(lines).toHaveLength(10);
    });

    test('CSP_REPORT_ONLY kill switch removes the report-only header', () => {
      const original = process.env.CSP_REPORT_ONLY;
      process.env.CSP_REPORT_ONLY = 'off';
      try {
        const { headers } = runMiddleware();
        expect(headers).not.toHaveProperty('Content-Security-Policy-Report-Only');
        // The enforcing policy must still be present regardless of the switch.
        expect(headers).toHaveProperty('Content-Security-Policy');
      } finally {
        if (original === undefined) delete process.env.CSP_REPORT_ONLY;
        else process.env.CSP_REPORT_ONLY = original;
      }
    });
  });
});
