import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initAuth } from '../src/auth';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/env';

const JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-chars!!';
const TUTOR_PASSWORD = 'correct-horse-battery-staple';

describe('loadConfig', () => {
  it('throws if SKYTALK_TUTOR_PASSWORD is missing', () => {
    const orig = process.env['SKYTALK_TUTOR_PASSWORD'];
    delete process.env['SKYTALK_TUTOR_PASSWORD'];
    try {
      expect(() => loadConfig()).toThrow('SKYTALK_TUTOR_PASSWORD');
    } finally {
      if (orig !== undefined) process.env['SKYTALK_TUTOR_PASSWORD'] = orig;
    }
  });

  it('throws if SKYTALK_JWT_SECRET is missing', () => {
    process.env['SKYTALK_TUTOR_PASSWORD'] = TUTOR_PASSWORD;
    const orig = process.env['SKYTALK_JWT_SECRET'];
    delete process.env['SKYTALK_JWT_SECRET'];
    try {
      expect(() => loadConfig()).toThrow('SKYTALK_JWT_SECRET');
    } finally {
      if (orig !== undefined) process.env['SKYTALK_JWT_SECRET'] = orig;
      else delete process.env['SKYTALK_TUTOR_PASSWORD'];
    }
  });
});

describe('POST /api/auth/login', () => {
  let app: ReturnType<typeof buildApp>;

  beforeAll(async () => {
    initAuth(TUTOR_PASSWORD, JWT_SECRET, 1);
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 200 with JWT in body and HttpOnly SameSite=Strict cookie', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { password: TUTOR_PASSWORD },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { tutor_session_token: string };
    expect(typeof body.tutor_session_token).toBe('string');
    expect(body.tutor_session_token.split('.').length).toBe(3);
    const cookie = res.headers['set-cookie'] as string;
    expect(cookie).toMatch(/tutor_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
  });

  it('returns 401 for wrong password', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { password: 'not-the-password' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 400 when password field is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /api/auth/login — rate limiting', () => {
  let app: ReturnType<typeof buildApp>;

  beforeAll(async () => {
    initAuth(TUTOR_PASSWORD, JWT_SECRET, 1);
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 429 after 10 requests in the same window', async () => {
    for (let i = 0; i < 10; i++) {
      await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { password: 'wrong' },
      });
    }
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { password: 'wrong' },
    });
    expect(res.statusCode).toBe(429);
  });
});
