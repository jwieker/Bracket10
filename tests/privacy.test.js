import express from 'express';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { vi } from 'vitest';
import indexRoutes from '../src/routes/indexRoutes.js';
import { privacy } from '../src/controllers/privacyController.js';

vi.mock('../src/utils/logger.js', () => ({
  default: { info: vi.fn(), performance: vi.fn(), error: vi.fn() },
}));

describe('Privacy Notice', () => {
  test.each(['', 'G-TEST'])(
    'GET /privacy renders with analytics ID %j',
    async (gaMeasurementId) => {
      const app = express();
      app.set('view engine', 'ejs');
      app.set('views', fileURLToPath(new URL('../views', import.meta.url)));
      Object.assign(app.locals, { gaMeasurementId, cspNonce: 'test-nonce' });
      app.use(indexRoutes);
      const server = app.listen(0, '127.0.0.1');
      try {
        await once(server, 'listening');
        const response = await fetch(
          `http://127.0.0.1:${server.address().port}/privacy`,
        );
        const html = await response.text();
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toContain('text/html');
        expect(html).toContain('<h1 class="t-h1">Privacy Notice</h1>');
        // The owner requests this disclosure regardless of the deployment configuration.
        expect(html).toContain('This site uses Google Analytics');
        expect(html).not.toContain('Google Analytics is not enabled');
        expect(html.includes('https://www.googletagmanager.com/gtag/js')).toBe(
          Boolean(gaMeasurementId),
        );
      } finally {
        await new Promise((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
    },
  );

  test('returns a generic response when rendering throws', async () => {
    const res = {
      render: vi.fn(() => {
        throw new Error('private render details');
      }),
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    await privacy({ method: 'GET', url: '/privacy' }, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Internal Server Error',
      message: 'An unexpected error occurred',
    });
  });
});
