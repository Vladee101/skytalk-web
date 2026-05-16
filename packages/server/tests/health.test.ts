import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app';

describe('GET /api/health', () => {
  let app: ReturnType<typeof buildApp>;

  afterEach(async () => {
    await app.close();
  });

  it('returns 200 with status "ok" and numeric uptime_seconds', async () => {
    app = buildApp();
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { status: string; uptime_seconds: number };
    expect(body.status).toBe('ok');
    expect(typeof body.uptime_seconds).toBe('number');
  });

  it('uptime_seconds is a non-negative number', async () => {
    app = buildApp();
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    const body = JSON.parse(res.body) as { uptime_seconds: number };
    expect(body.uptime_seconds).toBeGreaterThanOrEqual(0);
  });
});
