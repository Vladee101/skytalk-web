import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initAuth, signToken } from '../src/auth';
import { buildApp } from '../src/app';
import { initDb, getDb } from '../src/db';

const JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-chars!!';
const TUTOR_PASSWORD = 'correct-horse-battery-staple';

const VALID_LESSON = JSON.stringify({
  schema_version: '1.0',
  lesson: {
    name: 'Test Lesson',
    callsign: 'KLM641',
    route: 'KJFK-EHAM',
    aircraft_type: 'B747',
    difficulty: 'beginner',
  },
  steps: [
    {
      step: 1,
      phase: 'TAXI',
      atc: 'Contact Tower 118.70',
      expected_readback: 'Tower 118.70 KLM641',
      required_inputs: [{ type: 'com_frequency', value: '118.70' }],
    },
  ],
});

const BOUNDARY = '----TestBoundary7890';

function multipartBody(file?: string, studentName?: string): string {
  const parts: string[] = [];
  if (file !== undefined) {
    parts.push(
      `--${BOUNDARY}\r\n` +
        `Content-Disposition: form-data; name="flight_json"; filename="lesson.json"\r\n` +
        `Content-Type: application/json\r\n` +
        `\r\n` +
        file,
    );
  }
  if (studentName !== undefined) {
    parts.push(
      `--${BOUNDARY}\r\n` +
        `Content-Disposition: form-data; name="student_name"\r\n` +
        `\r\n` +
        studentName,
    );
  }
  return parts.join('\r\n') + `\r\n--${BOUNDARY}--\r\n`;
}

const CONTENT_TYPE = `multipart/form-data; boundary=${BOUNDARY}`;

describe('POST /api/rooms', () => {
  let app: ReturnType<typeof buildApp>;
  let validToken: string;

  beforeAll(async () => {
    process.env['SKYTALK_PUBLIC_URL'] = 'http://localhost:3001';
    process.env['SKYTALK_TURN_SECRET'] = 'test-turn-secret';
    initAuth(TUTOR_PASSWORD, JWT_SECRET, 1);
    initDb(':memory:');
    app = buildApp();
    await app.ready();
    validToken = signToken();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 201 with room_id, urls, expires_at, and turn_credentials for a valid upload', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/rooms',
      headers: {
        'content-type': CONTENT_TYPE,
        authorization: `Bearer ${validToken}`,
      },
      body: multipartBody(VALID_LESSON, 'Alice'),
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as {
      room_id: string;
      tutor_url: string;
      student_url: string;
      expires_at: string;
      turn_credentials: { username: string; password: string };
    };

    expect(body.room_id).toHaveLength(16);
    expect(body.tutor_url).toContain(`/tutor/${body.room_id}?token=`);
    expect(body.student_url).toContain(`/student/${body.room_id}?token=`);
    expect(body.expires_at).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO 8601
    expect(typeof body.turn_credentials.username).toBe('string');
    expect(typeof body.turn_credentials.password).toBe('string');
    // TURN username format: {unix_seconds}:{room_id}
    expect(body.turn_credentials.username).toContain(`:${body.room_id}`);
  });

  it('returns 422 when the file is not valid JSON', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/rooms',
      headers: {
        'content-type': CONTENT_TYPE,
        authorization: `Bearer ${validToken}`,
      },
      body: multipartBody('not { valid json {{'),
    });

    expect(res.statusCode).toBe(422);
    const body = JSON.parse(res.body) as { error: string };
    expect(body.error).toMatch(/json/i);
  });

  it('returns 422 when the lesson schema is invalid', async () => {
    const badLesson = JSON.stringify({ schema_version: '1.0', lesson: {}, steps: [] });
    const res = await app.inject({
      method: 'POST',
      url: '/api/rooms',
      headers: {
        'content-type': CONTENT_TYPE,
        authorization: `Bearer ${validToken}`,
      },
      body: multipartBody(badLesson),
    });

    expect(res.statusCode).toBe(422);
    const body = JSON.parse(res.body) as { errors: unknown[] };
    expect(Array.isArray(body.errors)).toBe(true);
    expect(body.errors.length).toBeGreaterThan(0);
  });

  it('returns 401 when no auth token is provided', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/rooms',
      headers: { 'content-type': CONTENT_TYPE },
      body: multipartBody(VALID_LESSON),
    });

    expect(res.statusCode).toBe(401);
  });

  it('returns 413 when the file exceeds 256 KB', async () => {
    const oversized = 'x'.repeat(257 * 1024); // 257 KB
    const res = await app.inject({
      method: 'POST',
      url: '/api/rooms',
      headers: {
        'content-type': CONTENT_TYPE,
        authorization: `Bearer ${validToken}`,
      },
      body: multipartBody(oversized),
    });

    expect(res.statusCode).toBe(413);
  });
});

describe('GET /api/rooms/:room_id', () => {
  let app: ReturnType<typeof buildApp>;
  let validToken: string;
  let roomId: string;
  let tutorToken: string;
  let studentToken: string;

  beforeAll(async () => {
    process.env['SKYTALK_PUBLIC_URL'] = 'http://localhost:3001';
    process.env['SKYTALK_TURN_SECRET'] = 'test-turn-secret';
    initAuth(TUTOR_PASSWORD, JWT_SECRET, 1);
    initDb(':memory:');
    app = buildApp();
    await app.ready();
    validToken = signToken();

    const res = await app.inject({
      method: 'POST',
      url: '/api/rooms',
      headers: { 'content-type': CONTENT_TYPE, authorization: `Bearer ${validToken}` },
      body: multipartBody(VALID_LESSON, 'Alice'),
    });
    const body = JSON.parse(res.body) as { room_id: string; tutor_url: string; student_url: string };
    roomId = body.room_id;
    tutorToken = new URL(body.tutor_url).searchParams.get('token')!;
    studentToken = new URL(body.student_url).searchParams.get('token')!;
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 200 with full step data for a valid tutor token', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/rooms/${roomId}?token=${tutorToken}` });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as Record<string, unknown>;
    expect(body.room_id).toBe(roomId);
    expect(body.role).toBe('tutor');
    expect(body.total_steps).toBe(1);
    expect(body.current_step_index).toBe(0);
    expect(body.state).toBe('IDLE');
    const stepData = body.current_step_data as Record<string, unknown>;
    expect(stepData.atc).toBeDefined();
    expect(stepData.expected_readback).toBeDefined();
    expect((stepData.required_inputs as Array<Record<string, unknown>>)[0].value).toBeDefined();
  });

  it('returns 200 with filtered step data for a valid student token', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/rooms/${roomId}?token=${studentToken}` });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as Record<string, unknown>;
    expect(body.role).toBe('student');
    const stepData = body.current_step_data as Record<string, unknown>;
    expect(stepData.atc).toBeUndefined();
    expect(stepData.expected_readback).toBeUndefined();
    const inputs = stepData.required_inputs as Array<Record<string, unknown>>;
    expect(inputs[0].value).toBeUndefined();
    expect(inputs[0].type).toBe('com_frequency');
  });

  it('returns 401 for an unknown token', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/rooms/${roomId}?token=totally-invalid` });
    expect(res.statusCode).toBe(401);
  });

  it('returns 404 for an expired room', async () => {
    getDb()
      .prepare(
        `INSERT INTO rooms (room_id, tutor_token, student_token, flight_json, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run('expiredroom00001', 'expired-tutor-tok', 'expired-student-tok', VALID_LESSON, Date.now(), Date.now() - 1);

    const res = await app.inject({
      method: 'GET',
      url: `/api/rooms/expiredroom00001?token=expired-tutor-tok`,
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 410 for a room in ENDED state', async () => {
    getDb()
      .prepare(
        `INSERT INTO rooms (room_id, tutor_token, student_token, flight_json, state, created_at, expires_at)
         VALUES (?, ?, ?, ?, 'ENDED', ?, ?)`,
      )
      .run('endedroom0000001', 'ended-tutor-token', 'ended-student-token', VALID_LESSON, Date.now(), Date.now() + 86400000);

    const res = await app.inject({
      method: 'GET',
      url: `/api/rooms/endedroom0000001?token=ended-tutor-token`,
    });
    expect(res.statusCode).toBe(410);
  });
});

describe('GET /api/rooms/:room_id/turn-creds', () => {
  let app: ReturnType<typeof buildApp>;
  let roomId: string;
  let tutorToken: string;
  let studentToken: string;

  beforeAll(async () => {
    process.env['SKYTALK_PUBLIC_URL'] = 'http://localhost:3001';
    process.env['SKYTALK_TURN_SECRET'] = 'test-turn-secret';
    initAuth(TUTOR_PASSWORD, JWT_SECRET, 1);
    initDb(':memory:');
    app = buildApp();
    await app.ready();
    const validToken = signToken();

    const res = await app.inject({
      method: 'POST',
      url: '/api/rooms',
      headers: { 'content-type': CONTENT_TYPE, authorization: `Bearer ${validToken}` },
      body: multipartBody(VALID_LESSON),
    });
    const body = JSON.parse(res.body) as { room_id: string; tutor_url: string; student_url: string };
    roomId = body.room_id;
    tutorToken = new URL(body.tutor_url).searchParams.get('token')!;
    studentToken = new URL(body.student_url).searchParams.get('token')!;
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 200 with fresh credentials for tutor token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/rooms/${roomId}/turn-creds?token=${tutorToken}`,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { username: string; password: string; ttl: number };
    expect(body.ttl).toBe(86400);
    expect(body.username).toContain(`:${roomId}`); // {expiry}:{roomId}
    expect(body.password.length).toBeGreaterThan(0);
  });

  it('returns 200 with fresh credentials for student token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/rooms/${roomId}/turn-creds?token=${studentToken}`,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { username: string; password: string; ttl: number };
    expect(body.ttl).toBe(86400);
    expect(body.username).toContain(`:${roomId}`);
  });

  it('returns 401 for an invalid token and 404 for an expired room', async () => {
    const bad = await app.inject({
      method: 'GET',
      url: `/api/rooms/${roomId}/turn-creds?token=bad-token`,
    });
    expect(bad.statusCode).toBe(401);

    getDb()
      .prepare(
        `INSERT INTO rooms (room_id, tutor_token, student_token, flight_json, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run('tc-expiredroom01', 'tc-exp-tutor', 'tc-exp-student', VALID_LESSON, Date.now(), Date.now() - 1);

    const expired = await app.inject({
      method: 'GET',
      url: `/api/rooms/tc-expiredroom01?token=tc-exp-tutor`,
    });
    expect(expired.statusCode).toBe(404);
  });
});
