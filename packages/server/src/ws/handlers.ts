import { LessonStateMachine, viewStepForRole } from '@skytalk/core';
import type { EmittedEvent, FlightLesson, LessonRuntime, LessonState } from '@skytalk/core';
import { z } from 'zod';

import { getDb } from '../db';
import { getRoomManager } from './room-manager';

// ---- DB row shape (only fields this module reads) ----

interface RoomRow {
  room_id: string;
  flight_json: string;
  current_step_index: number;
  current_input_index: number;
  state: string;
  attempt_count: number;
}

// ---- Zod schemas for incoming WS messages ----

const Base = z.object({ seq: z.number().optional() });

const IncomingMessage = z.discriminatedUnion('type', [
  Base.extend({ type: z.literal('ping') }),
  Base.extend({ type: z.literal('peer_ready') }),
  Base.extend({ type: z.literal('ptt'), pressed: z.boolean() }),
  Base.extend({ type: z.literal('start_lesson') }),
  Base.extend({ type: z.literal('submit_input'), value: z.string() }),
  Base.extend({ type: z.literal('right_arrow') }),
  Base.extend({ type: z.literal('repeat_step') }),
  Base.extend({ type: z.literal('skip_step') }),
  Base.extend({ type: z.literal('end_lesson') }),
  Base.extend({ type: z.literal('reset_lesson') }),
  Base.extend({ type: z.literal('exit') }),
]);

type IncomingMsg = z.infer<typeof IncomingMessage>;
type MachineMsg = Exclude<IncomingMsg, { type: 'ping' } | { type: 'peer_ready' }>;

// ---- Role enforcement ----

const TUTOR_ONLY = new Set<string>(['start_lesson', 'skip_step', 'repeat_step', 'end_lesson']);
const STUDENT_ONLY = new Set<string>(['submit_input', 'exit']);

function isRoleAllowed(type: string, role: 'tutor' | 'student'): boolean {
  if (TUTOR_ONLY.has(type)) return role === 'tutor';
  if (STUDENT_ONLY.has(type)) return role === 'student';
  return true; // ping, ptt, reset_lesson
}

// ---- Event builder: validated WS message → StateMachineEvent ----

function buildEvent(msg: MachineMsg, role: 'tutor' | 'student'): Parameters<LessonStateMachine['transition']>[1] {
  switch (msg.type) {
    case 'ptt':          return { type: 'ptt',          by: role,      pressed: msg.pressed };
    case 'start_lesson': return { type: 'start_lesson', by: 'tutor'   };
    case 'submit_input': return { type: 'submit_input', value: msg.value };
    case 'right_arrow':  return { type: 'right_arrow',  by: role };
    case 'repeat_step':  return { type: 'repeat_step',  by: 'tutor'   };
    case 'skip_step':    return { type: 'skip_step',    by: 'tutor'   };
    case 'end_lesson':   return { type: 'end_lesson',   by: role      };
    case 'reset_lesson': return { type: 'reset_lesson', by: role      };
    case 'exit':         return { type: 'exit',         by: 'student' };
  }
}

// ---- Session event audit log ----

function logSessionEvent(roomId: string, actor: 'tutor' | 'student', evt: EmittedEvent): void {
  let eventType: string | null = null;
  switch (evt.type) {
    case 'state_changed':
    case 'lesson_reset':     eventType = 'state_changed';   break;
    case 'step_changed':     eventType = 'step_changed';    break;
    case 'input_result':     eventType = 'input_submitted'; break;
    case 'lesson_completed': eventType = 'lesson_completed'; break;
    case 'lesson_ended':     eventType = 'lesson_ended';    break;
    default: return; // peer_ptt and repeat_signal are not logged
  }
  getDb()
    .prepare('INSERT INTO session_events (room_id, ts, actor, event_type, payload_json) VALUES (?, ?, ?, ?, ?)')
    .run(roomId, Date.now(), actor, eventType, JSON.stringify(evt));
}

// ---- Emitted event → WS message routing ----

function broadcastEmittedEvents(
  roomId: string,
  events: EmittedEvent[],
  lesson: FlightLesson,
  newState: LessonRuntime,
): void {
  const manager = getRoomManager();

  for (const evt of events) {
    switch (evt.type) {
      case 'state_changed':
        manager.broadcast(roomId, { type: 'state_changed', state: evt.state });
        break;

      case 'step_changed': {
        const step = lesson.steps[evt.step_index];
        const base = {
          type: 'step_changed',
          current_step_index: evt.step_index,
          reason: evt.reason,
          total_steps: lesson.steps.length,
        };
        // tutor and student receive role-filtered step data separately
        manager.sendTo(roomId, 'tutor', {
          ...base,
          current_step_data: step ? viewStepForRole(step, 'tutor') : null,
        });
        manager.sendTo(roomId, 'student', {
          ...base,
          current_step_data: step ? viewStepForRole(step, 'student') : null,
        });
        break;
      }

      case 'input_result': {
        const base = {
          type: 'input_result',
          correct: evt.correct,
          input_index: evt.input_index,
          more_inputs: evt.more_inputs,
          attempt_count: evt.attempt_count,
        };
        // tutor sees what the student typed; student does not
        manager.sendTo(roomId, 'tutor', { ...base, submitted_value: newState.last_input?.value });
        manager.sendTo(roomId, 'student', base);
        break;
      }

      case 'peer_ptt':
        manager.broadcast(roomId, { type: 'peer_ptt', by: evt.by, pressed: evt.pressed });
        break;

      case 'repeat_signal':
        manager.broadcast(roomId, { type: 'repeat_signal' });
        break;

      case 'lesson_completed':
        manager.broadcast(roomId, { type: 'lesson_completed' });
        break;

      case 'lesson_reset':
        manager.broadcast(roomId, { type: 'lesson_reset' });
        break;

      case 'lesson_ended':
        manager.broadcast(roomId, { type: 'lesson_ended', reason: evt.reason });
        break;

      default: {
        const _exhaustive: never = evt;
        void _exhaustive;
      }
    }
  }
}

// ---- Main dispatch function ----

export function dispatchMessage(roomId: string, role: 'tutor' | 'student', raw: string): void {
  const manager = getRoomManager();

  // Malformed JSON is silently dropped — must not crash the server (user note #2)
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }

  // Schema validation
  const parseResult = IncomingMessage.safeParse(parsed);
  if (!parseResult.success) {
    const rawSeq = (parsed as Record<string, unknown>)?.['seq'];
    manager.sendTo(roomId, role, {
      type: 'error',
      code: 'validation_failed',
      ack_seq: typeof rawSeq === 'number' ? rawSeq : null,
    });
    return;
  }

  const msg = parseResult.data;

  // Ping: short-circuit — no state machine, no DB
  if (msg.type === 'ping') {
    manager.sendTo(roomId, role, { type: 'pong', seq: msg.seq ?? null });
    return;
  }

  // peer_ready: student notifies server when their PeerJS peer is registered.
  // Server forwards to tutor so tutor knows it's safe to initiate the WebRTC call.
  if (msg.type === 'peer_ready') {
    manager.sendToPeer(roomId, role, { type: 'peer_ready' });
    return;
  }

  // Role enforcement
  if (!isRoleAllowed(msg.type, role)) {
    manager.sendTo(roomId, role, { type: 'error', code: 'wrong_role', ack_seq: msg.seq ?? null });
    return;
  }

  // Read fresh room state from DB
  const row = getDb()
    .prepare('SELECT * FROM rooms WHERE room_id = ?')
    .get(roomId) as unknown as RoomRow | undefined;
  if (!row) return; // room deleted between message receipt and handler

  // Safe cast: flight_json was validated by validateFlightJson() at room creation (POST /api/rooms).
  // Do not remove this assumption without adding runtime validation here.
  const lesson = JSON.parse(row.flight_json) as FlightLesson;

  const runtime: LessonRuntime = {
    room_id: roomId,
    current_step_index: row.current_step_index,
    current_input_index: row.current_input_index,
    state: row.state as LessonState,
    attempt_count: row.attempt_count,
  };

  const event = buildEvent(msg, role);
  const result = new LessonStateMachine(lesson).transition(runtime, event);

  if (!result.ok) {
    manager.sendTo(roomId, role, {
      type: 'error',
      code: result.error,
      message: result.message,
      ack_seq: msg.seq ?? null,
    });
    return;
  }

  // Persist new state
  const newState = result.state;
  const isTerminal = newState.state === 'ENDED' || newState.state === 'COMPLETED';
  const isReset = msg.type === 'reset_lesson';

  getDb()
    .prepare(
      `UPDATE rooms SET
         current_step_index  = ?,
         current_input_index = ?,
         state               = ?,
         attempt_count       = ?,
         reset_count         = CASE WHEN ? THEN reset_count + 1 ELSE reset_count END,
         ended_at            = CASE WHEN ? THEN ? ELSE ended_at END
       WHERE room_id = ?`,
    )
    .run(
      newState.current_step_index,
      newState.current_input_index,
      newState.state,
      newState.attempt_count,
      isReset ? 1 : 0,
      isTerminal ? 1 : 0,
      isTerminal ? Date.now() : null,
      roomId,
    );

  // Audit log
  for (const emitted of result.emit) {
    logSessionEvent(roomId, role, emitted);
  }

  // Broadcast to clients
  broadcastEmittedEvents(roomId, result.emit, lesson, newState);
}
