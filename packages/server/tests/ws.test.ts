import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initAuth, signToken } from '../src/auth';
import { buildApp } from '../src/app';
import { initDb } from '../src/db';
import { resetRoomManager } from '../src/ws/room-manager';

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

const BOUNDARY = '----TestBoundaryWS01';

function multipartBody(file: string, studentName?: string): string {
  const parts = [
    `--${BOUNDARY}\r\n` +
      `Content-Disposition: form-data; name="flight_json"; filename="lesson.json"\r\n` +
      `Content-Type: application/json\r\n` +
      `\r\n` +
      file,
  ];
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

/**
 * Parses one message from a ws socket after the promise resolves.
 * Safe only for messages that arrive after the await (e.g. pong after a ping send).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function nextMessage(ws: any): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ws.once('message', (data: any) => {
      try {
        resolve(JSON.parse(String(data)) as Record<string, unknown>);
      } catch (e) {
        reject(e as Error);
      }
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ws.once('error', (e: any) => reject(e as Error));
  });
}

/**
 * Connects via injectWS and registers a message listener via onInit (before the upgrade
 * event fires the server handler), so the first message (state_snapshot) is captured
 * even though it's sent synchronously during connection setup.
 */
async function injectWs(
  app: ReturnType<typeof buildApp>,
  path: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<{ ws: any; firstMessage: Promise<Record<string, unknown>> }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let onFirstMsg = (_data: any): void => {};
  const firstMessage = new Promise<Record<string, unknown>>((resolve, reject) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onFirstMsg = (data: any) => {
      try {
        resolve(JSON.parse(String(data)) as Record<string, unknown>);
      } catch (e) {
        reject(e as Error);
      }
    };
  });

  const ws = await app.injectWS(path, {}, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onInit: (socket: any) => { socket.once('message', onFirstMsg); },
  });

  return { ws, firstMessage };
}

describe('WebSocket /ws/rooms/:room_id', () => {
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
      body: multipartBody(VALID_LESSON, 'Alice'),
    });
    const body = JSON.parse(res.body) as { room_id: string; tutor_url: string; student_url: string };
    roomId = body.room_id;
    tutorToken = new URL(body.tutor_url).searchParams.get('token')!;
    studentToken = new URL(body.student_url).searchParams.get('token')!;
  });

  afterAll(async () => {
    resetRoomManager();
    await app.close();
  });

  it('sends state_snapshot with full step data for tutor token', async () => {
    const { ws, firstMessage } = await injectWs(app, `/ws/rooms/${roomId}?token=${tutorToken}`);
    const snapshot = await firstMessage;
    ws.close();

    expect(snapshot.type).toBe('state_snapshot');
    expect(snapshot.room_id).toBe(roomId);
    expect(snapshot.total_steps).toBe(1);
    expect(snapshot.current_step_index).toBe(0);
    expect(snapshot.state).toBe('IDLE');
    expect(snapshot.last_input_result).toBeNull();
    const stepData = snapshot.current_step_data as Record<string, unknown>;
    expect(stepData.atc).toBeDefined();
    expect(stepData.expected_readback).toBeDefined();
    expect((stepData.required_inputs as Array<Record<string, unknown>>)[0].value).toBeDefined();
  });

  it('sends filtered state_snapshot for student token', async () => {
    const { ws, firstMessage } = await injectWs(app, `/ws/rooms/${roomId}?token=${studentToken}`);
    const snapshot = await firstMessage;
    ws.close();

    expect(snapshot.type).toBe('state_snapshot');
    const stepData = snapshot.current_step_data as Record<string, unknown>;
    expect(stepData.atc).toBeUndefined();
    expect(stepData.expected_readback).toBeUndefined();
    const inputs = stepData.required_inputs as Array<Record<string, unknown>>;
    expect(inputs[0].value).toBeUndefined();
    expect(inputs[0].type).toBe('com_frequency');
  });

  it('returns 401 for invalid token', async () => {
    const res = await app.inject({ method: 'GET', url: `/ws/rooms/${roomId}?token=bad-token` });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 when token is missing', async () => {
    const res = await app.inject({ method: 'GET', url: `/ws/rooms/${roomId}` });
    expect(res.statusCode).toBe(401);
  });

  it('returns 404 for expired room', async () => {
    const { getDb } = await import('../src/db');
    getDb()
      .prepare(
        `INSERT INTO rooms (room_id, tutor_token, student_token, flight_json, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run('ws-expiredroom001', 'ws-exp-tutor-tok', 'ws-exp-student-tok', VALID_LESSON, Date.now(), Date.now() - 1);

    const res = await app.inject({ method: 'GET', url: `/ws/rooms/ws-expiredroom001?token=ws-exp-tutor-tok` });
    expect(res.statusCode).toBe(404);
  });

  it('returns 410 for room in ENDED state', async () => {
    const { getDb } = await import('../src/db');
    getDb()
      .prepare(
        `INSERT INTO rooms (room_id, tutor_token, student_token, flight_json, state, created_at, expires_at)
         VALUES (?, ?, ?, ?, 'ENDED', ?, ?)`,
      )
      .run(
        'ws-endedroom00001',
        'ws-end-tutor-tok',
        'ws-end-student-tok',
        VALID_LESSON,
        Date.now(),
        Date.now() + 86400000,
      );

    const res = await app.inject({ method: 'GET', url: `/ws/rooms/ws-endedroom00001?token=ws-end-tutor-tok` });
    expect(res.statusCode).toBe(410);
  });

  it('replies with pong on ping', async () => {
    const { ws, firstMessage } = await injectWs(app, `/ws/rooms/${roomId}?token=${tutorToken}`);
    await firstMessage; // consume state_snapshot

    ws.send(JSON.stringify({ type: 'ping', seq: 42 }));
    const pong = await nextMessage(ws);
    ws.close();

    expect(pong.type).toBe('pong');
    expect(pong.seq).toBe(42);
  });

  it('second connection for same role replaces first', async () => {
    const { ws: ws1, firstMessage: snap1 } = await injectWs(app, `/ws/rooms/${roomId}?token=${tutorToken}`);
    await snap1; // ensure ws1 is fully registered in RoomManager

    const ws1Closed = new Promise<void>((resolve) => { ws1.once('close', () => resolve()); });

    const { ws: ws2, firstMessage: snap2 } = await injectWs(app, `/ws/rooms/${roomId}?token=${tutorToken}`);
    await ws1Closed;

    const snapshot2 = await snap2;
    ws2.close();

    expect(snapshot2.type).toBe('state_snapshot');
  });
});
