import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initAuth, signToken } from '../src/auth';
import { buildApp } from '../src/app';
import { initDb, getDb } from '../src/db';
import { resetRoomManager } from '../src/ws/room-manager';

const JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-chars!!';
const TUTOR_PASSWORD = 'correct-horse-battery-staple';

// One step with a com_frequency input — used by most tests
const ONE_STEP_LESSON = JSON.stringify({
  schema_version: '1.0',
  lesson: {
    name: 'Handler Test Lesson',
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

// Two-step lesson: step 1 has input, step 2 has none (for advance / reset flows)
const TWO_STEP_LESSON = JSON.stringify({
  schema_version: '1.0',
  lesson: {
    name: 'Two-Step Lesson',
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
    {
      step: 2,
      phase: 'TAXI',
      atc: 'Taxi to runway 22L',
      expected_readback: 'Runway 22L KLM641',
      required_inputs: [],
    },
  ],
});

// ---- Helpers ----

let roomSeq = 0;
function newIds() {
  const n = ++roomSeq;
  return {
    roomId: `hdl-room-${n}`,
    tutorToken: `hdl-tutor-tok-${n}`,
    studentToken: `hdl-student-tok-${n}`,
  };
}

function insertRoom(
  roomId: string,
  tutorToken: string,
  studentToken: string,
  state: string,
  flightJson = ONE_STEP_LESSON,
  stepIndex = 0,
  inputIndex = 0,
  attemptCount = 0,
) {
  getDb()
    .prepare(
      `INSERT INTO rooms
         (room_id, tutor_token, student_token, flight_json, state,
          current_step_index, current_input_index, attempt_count,
          created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      roomId, tutorToken, studentToken, flightJson, state,
      stepIndex, inputIndex, attemptCount,
      Date.now(), Date.now() + 86400000,
    );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function nextMessage(ws: any): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ws.once('message', (data: any) => {
      try { resolve(JSON.parse(String(data)) as Record<string, unknown>); }
      catch (e) { reject(e as Error); }
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ws.once('error', (e: any) => reject(e as Error));
  });
}

/**
 * Collects exactly `count` messages from the socket.
 * Rejects on timeout (default 500 ms).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function collectMessages(ws: any, count: number, timeoutMs = 500): Promise<Record<string, unknown>[]> {
  return new Promise<Record<string, unknown>[]>((resolve, reject) => {
    const collected: Record<string, unknown>[] = [];
    const timer = setTimeout(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ws.off('message', handler);
      reject(new Error(`collectMessages: timeout — expected ${count}, got ${collected.length}`));
    }, timeoutMs);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function handler(data: any) {
      try { collected.push(JSON.parse(String(data)) as Record<string, unknown>); }
      catch { /* ignore parse failures in helper */ }
      if (collected.length >= count) {
        clearTimeout(timer);
        ws.off('message', handler);
        resolve(collected);
      }
    }
    ws.on('message', handler);
  });
}

/**
 * Connects via injectWS; registers the firstMessage listener via onInit so the
 * state_snapshot (sent synchronously during upgrade) is not missed.
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
      try { resolve(JSON.parse(String(data)) as Record<string, unknown>); }
      catch (e) { reject(e as Error); }
    };
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ws = await (app as any).injectWS(path, {}, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onInit: (socket: any) => { socket.once('message', onFirstMsg); },
  });

  return { ws, firstMessage };
}

// ---- Test suite ----

describe('WebSocket message handlers', () => {
  let app: ReturnType<typeof buildApp>;

  beforeAll(async () => {
    process.env['SKYTALK_PUBLIC_URL'] = 'http://localhost:3001';
    process.env['SKYTALK_TURN_SECRET'] = 'test-turn-secret';
    initAuth(TUTOR_PASSWORD, JWT_SECRET, 1);
    initDb(':memory:');
    app = buildApp();
    await app.ready();
    signToken(); // ensure auth is initialised (side-effect-free call)
  });

  afterAll(async () => {
    resetRoomManager();
    await app.close();
  });

  // ------------------------------------------------------------------ //
  // Happy-path: broadcast and role-filtering                            //
  // ------------------------------------------------------------------ //

  it('start_lesson: both clients receive state_changed then role-filtered step_changed', async () => {
    const { roomId, tutorToken, studentToken } = newIds();
    insertRoom(roomId, tutorToken, studentToken, 'IDLE');

    const { ws: tWs, firstMessage: tSnap } = await injectWs(app, `/ws/rooms/${roomId}?token=${tutorToken}`);
    const { ws: sWs, firstMessage: sSnap } = await injectWs(app, `/ws/rooms/${roomId}?token=${studentToken}`);
    await Promise.all([tSnap, sSnap]);

    const tMsgs = collectMessages(tWs, 2);
    const sMsgs = collectMessages(sWs, 2);

    tWs.send(JSON.stringify({ type: 'start_lesson', seq: 1 }));

    const [[t0, t1], [s0, s1]] = await Promise.all([tMsgs, sMsgs]);
    tWs.close(); sWs.close();

    expect(t0).toMatchObject({ type: 'state_changed', state: 'LISTENING' });
    expect(s0).toMatchObject({ type: 'state_changed', state: 'LISTENING' });

    expect(t1).toMatchObject({ type: 'step_changed', current_step_index: 0, reason: 'start', total_steps: 1 });
    expect(s1).toMatchObject({ type: 'step_changed', current_step_index: 0, reason: 'start', total_steps: 1 });

    // Tutor sees full step data; student sees filtered (no atc/expected_readback)
    const tStep = t1['current_step_data'] as Record<string, unknown>;
    const sStep = s1['current_step_data'] as Record<string, unknown>;
    expect(tStep['atc']).toBeDefined();
    expect(tStep['expected_readback']).toBeDefined();
    expect(sStep['atc']).toBeUndefined();
    expect(sStep['expected_readback']).toBeUndefined();
  });

  it('ptt{pressed:true}: both clients receive peer_ptt broadcast', async () => {
    const { roomId, tutorToken, studentToken } = newIds();
    insertRoom(roomId, tutorToken, studentToken, 'LISTENING');

    const { ws: tWs, firstMessage: tSnap } = await injectWs(app, `/ws/rooms/${roomId}?token=${tutorToken}`);
    const { ws: sWs, firstMessage: sSnap } = await injectWs(app, `/ws/rooms/${roomId}?token=${studentToken}`);
    await Promise.all([tSnap, sSnap]);

    const tMsg = collectMessages(tWs, 1);
    const sMsg = collectMessages(sWs, 1);

    tWs.send(JSON.stringify({ type: 'ptt', pressed: true }));

    const [[t0], [s0]] = await Promise.all([tMsg, sMsg]);
    tWs.close(); sWs.close();

    expect(t0).toMatchObject({ type: 'peer_ptt', by: 'tutor', pressed: true });
    expect(s0).toMatchObject({ type: 'peer_ptt', by: 'tutor', pressed: true });
  });

  it('tutor ptt{pressed:false} from LISTENING triggers INPUT_REQUIRED transition', async () => {
    const { roomId, tutorToken, studentToken } = newIds();
    insertRoom(roomId, tutorToken, studentToken, 'LISTENING');

    const { ws: tWs, firstMessage: tSnap } = await injectWs(app, `/ws/rooms/${roomId}?token=${tutorToken}`);
    const { ws: sWs, firstMessage: sSnap } = await injectWs(app, `/ws/rooms/${roomId}?token=${studentToken}`);
    await Promise.all([tSnap, sSnap]);

    // ptt release emits: peer_ptt + state_changed{INPUT_REQUIRED}
    const tMsgs = collectMessages(tWs, 2);
    const sMsgs = collectMessages(sWs, 2);

    tWs.send(JSON.stringify({ type: 'ptt', pressed: false }));

    const [[t0, t1], [s0, s1]] = await Promise.all([tMsgs, sMsgs]);
    tWs.close(); sWs.close();

    expect(t0).toMatchObject({ type: 'peer_ptt', by: 'tutor', pressed: false });
    expect(t1).toMatchObject({ type: 'state_changed', state: 'INPUT_REQUIRED' });
    expect(s0).toMatchObject({ type: 'peer_ptt', by: 'tutor', pressed: false });
    expect(s1).toMatchObject({ type: 'state_changed', state: 'INPUT_REQUIRED' });

    // Verify DB was updated
    const row = getDb().prepare('SELECT state FROM rooms WHERE room_id = ?').get(roomId) as { state: string };
    expect(row.state).toBe('INPUT_REQUIRED');
  });

  it('submit_input correct: tutor sees submitted_value, student does not; both get READY_TO_ADVANCE', async () => {
    const { roomId, tutorToken, studentToken } = newIds();
    insertRoom(roomId, tutorToken, studentToken, 'INPUT_REQUIRED');

    const { ws: tWs, firstMessage: tSnap } = await injectWs(app, `/ws/rooms/${roomId}?token=${tutorToken}`);
    const { ws: sWs, firstMessage: sSnap } = await injectWs(app, `/ws/rooms/${roomId}?token=${studentToken}`);
    await Promise.all([tSnap, sSnap]);

    // correct last input → input_result + state_changed{READY_TO_ADVANCE}
    const tMsgs = collectMessages(tWs, 2);
    const sMsgs = collectMessages(sWs, 2);

    sWs.send(JSON.stringify({ type: 'submit_input', value: '118.70' }));

    const [[t0, t1], [s0, s1]] = await Promise.all([tMsgs, sMsgs]);
    tWs.close(); sWs.close();

    expect(t0).toMatchObject({ type: 'input_result', correct: true, input_index: 0, more_inputs: false });
    expect(t0['submitted_value']).toBe('118.70');

    expect(s0).toMatchObject({ type: 'input_result', correct: true, input_index: 0, more_inputs: false });
    expect(s0['submitted_value']).toBeUndefined();

    expect(t1).toMatchObject({ type: 'state_changed', state: 'READY_TO_ADVANCE' });
    expect(s1).toMatchObject({ type: 'state_changed', state: 'READY_TO_ADVANCE' });
  });

  it('submit_input wrong: both get input_result{correct:false}; tutor sees submitted_value, student does not', async () => {
    const { roomId, tutorToken, studentToken } = newIds();
    insertRoom(roomId, tutorToken, studentToken, 'INPUT_REQUIRED');

    const { ws: tWs, firstMessage: tSnap } = await injectWs(app, `/ws/rooms/${roomId}?token=${tutorToken}`);
    const { ws: sWs, firstMessage: sSnap } = await injectWs(app, `/ws/rooms/${roomId}?token=${studentToken}`);
    await Promise.all([tSnap, sSnap]);

    const tMsgs = collectMessages(tWs, 1);
    const sMsgs = collectMessages(sWs, 1);

    sWs.send(JSON.stringify({ type: 'submit_input', value: '999.99' }));

    const [[t0], [s0]] = await Promise.all([tMsgs, sMsgs]);
    tWs.close(); sWs.close();

    expect(t0).toMatchObject({ type: 'input_result', correct: false });
    expect(t0['submitted_value']).toBe('999.99');
    expect(s0).toMatchObject({ type: 'input_result', correct: false });
    expect(s0['submitted_value']).toBeUndefined();
  });

  it('right_arrow from READY_TO_ADVANCE on last step: both receive lesson_completed', async () => {
    const { roomId, tutorToken, studentToken } = newIds();
    insertRoom(roomId, tutorToken, studentToken, 'READY_TO_ADVANCE');

    const { ws: tWs, firstMessage: tSnap } = await injectWs(app, `/ws/rooms/${roomId}?token=${tutorToken}`);
    const { ws: sWs, firstMessage: sSnap } = await injectWs(app, `/ws/rooms/${roomId}?token=${studentToken}`);
    await Promise.all([tSnap, sSnap]);

    const tMsg = collectMessages(tWs, 1);
    const sMsg = collectMessages(sWs, 1);

    sWs.send(JSON.stringify({ type: 'right_arrow' }));

    const [[t0], [s0]] = await Promise.all([tMsg, sMsg]);
    tWs.close(); sWs.close();

    expect(t0).toMatchObject({ type: 'lesson_completed' });
    expect(s0).toMatchObject({ type: 'lesson_completed' });

    const row = getDb().prepare('SELECT state FROM rooms WHERE room_id = ?').get(roomId) as { state: string };
    expect(row.state).toBe('COMPLETED');
  });

  it('right_arrow from READY_TO_ADVANCE advances to next step on two-step lesson', async () => {
    const { roomId, tutorToken, studentToken } = newIds();
    insertRoom(roomId, tutorToken, studentToken, 'READY_TO_ADVANCE', TWO_STEP_LESSON, 0);

    const { ws: tWs, firstMessage: tSnap } = await injectWs(app, `/ws/rooms/${roomId}?token=${tutorToken}`);
    const { ws: sWs, firstMessage: sSnap } = await injectWs(app, `/ws/rooms/${roomId}?token=${studentToken}`);
    await Promise.all([tSnap, sSnap]);

    // advance emits: step_changed + state_changed{LISTENING}
    const tMsgs = collectMessages(tWs, 2);
    const sMsgs = collectMessages(sWs, 2);

    sWs.send(JSON.stringify({ type: 'right_arrow' }));

    const [[t0, t1], [s0, s1]] = await Promise.all([tMsgs, sMsgs]);
    tWs.close(); sWs.close();

    expect(t0).toMatchObject({ type: 'step_changed', current_step_index: 1, reason: 'advance' });
    expect(s0).toMatchObject({ type: 'step_changed', current_step_index: 1, reason: 'advance' });
    expect(t1).toMatchObject({ type: 'state_changed', state: 'LISTENING' });
    expect(s1).toMatchObject({ type: 'state_changed', state: 'LISTENING' });
  });

  it('reset_lesson: both receive lesson_reset + step_changed{reason:reset} + state_changed{LISTENING}', async () => {
    const { roomId, tutorToken, studentToken } = newIds();
    insertRoom(roomId, tutorToken, studentToken, 'INPUT_REQUIRED');

    const { ws: tWs, firstMessage: tSnap } = await injectWs(app, `/ws/rooms/${roomId}?token=${tutorToken}`);
    const { ws: sWs, firstMessage: sSnap } = await injectWs(app, `/ws/rooms/${roomId}?token=${studentToken}`);
    await Promise.all([tSnap, sSnap]);

    // reset emits: lesson_reset + step_changed + state_changed
    const tMsgs = collectMessages(tWs, 3);
    const sMsgs = collectMessages(sWs, 3);

    tWs.send(JSON.stringify({ type: 'reset_lesson' }));

    const [[t0, t1, t2], [s0, s1, s2]] = await Promise.all([tMsgs, sMsgs]);
    tWs.close(); sWs.close();

    expect(t0).toMatchObject({ type: 'lesson_reset' });
    expect(s0).toMatchObject({ type: 'lesson_reset' });
    expect(t1).toMatchObject({ type: 'step_changed', current_step_index: 0, reason: 'reset' });
    expect(s1).toMatchObject({ type: 'step_changed', current_step_index: 0, reason: 'reset' });
    expect(t2).toMatchObject({ type: 'state_changed', state: 'LISTENING' });
    expect(s2).toMatchObject({ type: 'state_changed', state: 'LISTENING' });

    const row = getDb().prepare('SELECT reset_count FROM rooms WHERE room_id = ?').get(roomId) as { reset_count: number };
    expect(row.reset_count).toBe(1);
  });

  it('repeat_step: both clients receive repeat_signal', async () => {
    const { roomId, tutorToken, studentToken } = newIds();
    insertRoom(roomId, tutorToken, studentToken, 'LISTENING');

    const { ws: tWs, firstMessage: tSnap } = await injectWs(app, `/ws/rooms/${roomId}?token=${tutorToken}`);
    const { ws: sWs, firstMessage: sSnap } = await injectWs(app, `/ws/rooms/${roomId}?token=${studentToken}`);
    await Promise.all([tSnap, sSnap]);

    const tMsg = collectMessages(tWs, 1);
    const sMsg = collectMessages(sWs, 1);

    tWs.send(JSON.stringify({ type: 'repeat_step' }));

    const [[t0], [s0]] = await Promise.all([tMsg, sMsg]);
    tWs.close(); sWs.close();

    expect(t0).toMatchObject({ type: 'repeat_signal' });
    expect(s0).toMatchObject({ type: 'repeat_signal' });
  });

  it('skip_step from LISTENING: both receive step_changed (step 1→2) + state_changed{LISTENING}', async () => {
    const { roomId, tutorToken, studentToken } = newIds();
    insertRoom(roomId, tutorToken, studentToken, 'LISTENING', TWO_STEP_LESSON, 0);

    const { ws: tWs, firstMessage: tSnap } = await injectWs(app, `/ws/rooms/${roomId}?token=${tutorToken}`);
    const { ws: sWs, firstMessage: sSnap } = await injectWs(app, `/ws/rooms/${roomId}?token=${studentToken}`);
    await Promise.all([tSnap, sSnap]);

    const tMsgs = collectMessages(tWs, 2);
    const sMsgs = collectMessages(sWs, 2);

    tWs.send(JSON.stringify({ type: 'skip_step' }));

    const [[t0, t1], [s0, s1]] = await Promise.all([tMsgs, sMsgs]);
    tWs.close(); sWs.close();

    expect(t0).toMatchObject({ type: 'step_changed', current_step_index: 1, reason: 'skip' });
    expect(s0).toMatchObject({ type: 'step_changed', current_step_index: 1, reason: 'skip' });
    expect(t1).toMatchObject({ type: 'state_changed', state: 'LISTENING' });
    expect(s1).toMatchObject({ type: 'state_changed', state: 'LISTENING' });
  });

  // ------------------------------------------------------------------ //
  // Error cases                                                          //
  // ------------------------------------------------------------------ //

  it('wrong role: student sends start_lesson → error{code:wrong_role}', async () => {
    const { roomId, tutorToken, studentToken } = newIds();
    insertRoom(roomId, tutorToken, studentToken, 'IDLE');

    const { ws: sWs, firstMessage: sSnap } = await injectWs(app, `/ws/rooms/${roomId}?token=${studentToken}`);
    await sSnap;

    const errP = nextMessage(sWs);
    sWs.send(JSON.stringify({ type: 'start_lesson', seq: 7 }));
    const err = await errP;
    sWs.close();

    expect(err).toMatchObject({ type: 'error', code: 'wrong_role', ack_seq: 7 });
  });

  it('wrong role: tutor sends submit_input → error{code:wrong_role}', async () => {
    const { roomId, tutorToken, studentToken } = newIds();
    insertRoom(roomId, tutorToken, studentToken, 'INPUT_REQUIRED');

    const { ws: tWs, firstMessage: tSnap } = await injectWs(app, `/ws/rooms/${roomId}?token=${tutorToken}`);
    await tSnap;

    const errP = nextMessage(tWs);
    tWs.send(JSON.stringify({ type: 'submit_input', value: '118.70' }));
    const err = await errP;
    tWs.close();

    expect(err).toMatchObject({ type: 'error', code: 'wrong_role' });
  });

  it('invalid_action: right_arrow in INPUT_REQUIRED → error, state unchanged', async () => {
    const { roomId, tutorToken, studentToken } = newIds();
    insertRoom(roomId, tutorToken, studentToken, 'INPUT_REQUIRED');

    const { ws: sWs, firstMessage: sSnap } = await injectWs(app, `/ws/rooms/${roomId}?token=${studentToken}`);
    await sSnap;

    const errP = nextMessage(sWs);
    sWs.send(JSON.stringify({ type: 'right_arrow' }));
    const err = await errP;
    sWs.close();

    expect(err).toMatchObject({ type: 'error', code: 'invalid_action' });

    const row = getDb().prepare('SELECT state FROM rooms WHERE room_id = ?').get(roomId) as { state: string };
    expect(row.state).toBe('INPUT_REQUIRED');
  });

  it('invalid_action: start_lesson from LISTENING → error', async () => {
    const { roomId, tutorToken, studentToken } = newIds();
    insertRoom(roomId, tutorToken, studentToken, 'LISTENING');

    const { ws: tWs, firstMessage: tSnap } = await injectWs(app, `/ws/rooms/${roomId}?token=${tutorToken}`);
    await tSnap;

    const errP = nextMessage(tWs);
    tWs.send(JSON.stringify({ type: 'start_lesson' }));
    const err = await errP;
    tWs.close();

    expect(err).toMatchObject({ type: 'error', code: 'invalid_action' });
  });

  it('malformed JSON does not crash server — subsequent ping still works', async () => {
    const { roomId, tutorToken, studentToken } = newIds();
    insertRoom(roomId, tutorToken, studentToken, 'IDLE');

    const { ws: tWs, firstMessage: tSnap } = await injectWs(app, `/ws/rooms/${roomId}?token=${tutorToken}`);
    await tSnap;

    tWs.send('not-valid-json{{{');

    const pongP = nextMessage(tWs);
    tWs.send(JSON.stringify({ type: 'ping', seq: 99 }));
    const pong = await pongP;
    tWs.close();

    expect(pong).toMatchObject({ type: 'pong', seq: 99 });
  });

  it('unknown message type → error{code:validation_failed}', async () => {
    const { roomId, tutorToken, studentToken } = newIds();
    insertRoom(roomId, tutorToken, studentToken, 'IDLE');

    const { ws: tWs, firstMessage: tSnap } = await injectWs(app, `/ws/rooms/${roomId}?token=${tutorToken}`);
    await tSnap;

    const errP = nextMessage(tWs);
    tWs.send(JSON.stringify({ type: 'unknown_action', seq: 3 }));
    const err = await errP;
    tWs.close();

    expect(err).toMatchObject({ type: 'error', code: 'validation_failed', ack_seq: 3 });
  });

  it('ping→pong round-trip preserves seq', async () => {
    const { roomId, tutorToken, studentToken } = newIds();
    insertRoom(roomId, tutorToken, studentToken, 'IDLE');

    const { ws: tWs, firstMessage: tSnap } = await injectWs(app, `/ws/rooms/${roomId}?token=${tutorToken}`);
    await tSnap;

    const pongP = nextMessage(tWs);
    tWs.send(JSON.stringify({ type: 'ping', seq: 42 }));
    const pong = await pongP;
    tWs.close();

    expect(pong).toMatchObject({ type: 'pong', seq: 42 });
  });
});
