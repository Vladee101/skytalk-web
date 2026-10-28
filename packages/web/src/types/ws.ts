import type { LessonState } from '@skytalk/core';

// ---- Snapshot (live state stored by the hook) ----

export interface StateSnapshot {
  room_id: string;
  current_step_index: number;
  current_input_index: number;
  total_steps: number;
  state: LessonState;
  current_step_data: unknown; // cast to Step (tutor) or StepView (student) at use site
  attempt_count: number;
  last_input_result: { correct: boolean; value?: string } | null;
}

// ---- Client → Server ----

type WithSeq = { seq: number };

// Distributive omit — preserves discriminated union structure unlike plain Omit<Union, K>
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** ClientMessage with seq stripped — pass this to send() */
export type SendMessage = DistributiveOmit<ClientMessage, 'seq'>;

export type ClientMessage =
  | ({ type: 'ping' } & WithSeq)
  | ({ type: 'peer_ready'; peer_id: string } & WithSeq)
  | ({ type: 'ptt'; pressed: boolean } & WithSeq)
  | ({ type: 'submit_input'; value: string } & WithSeq)
  | ({ type: 'right_arrow' } & WithSeq)
  | ({ type: 'exit' } & WithSeq)
  | ({ type: 'reset_lesson' } & WithSeq)
  | ({ type: 'start_lesson' } & WithSeq)
  | ({ type: 'skip_step' } & WithSeq)
  | ({ type: 'repeat_step' } & WithSeq)
  | ({ type: 'end_lesson' } & WithSeq);

// ---- Server → Client ----

export type ServerMessage =
  | {
      type: 'state_snapshot';
      room_id: string;
      current_step_index: number;
      current_input_index: number;
      total_steps: number;
      state: LessonState;
      current_step_data: unknown;
      attempt_count: number;
      last_input_result: { correct: boolean; value?: string } | null;
    }
  | { type: 'state_changed'; state: LessonState }
  | {
      type: 'step_changed';
      current_step_index: number;
      total_steps: number;
      current_step_data: unknown;
      reason: 'advance' | 'skip' | 'start' | 'reset';
    }
  | {
      type: 'input_result';
      correct: boolean;
      input_index: number;
      more_inputs: boolean;
      submitted_value?: string;
      attempt_count: number;
    }
  | { type: 'peer_ptt'; pressed: boolean; by: 'tutor' | 'student' }
  | { type: 'peer_ready'; peer_id?: string }
  | { type: 'repeat_signal' }
  | { type: 'lesson_reset'; triggered_by: 'tutor' | 'student' }
  | {
      type: 'lesson_ended';
      reason: 'completed' | 'by_tutor' | 'by_student' | 'exit' | 'expired';
    }
  | {
      type: 'error';
      ack_seq: number | null;
      code: 'invalid_action' | 'wrong_role' | 'wrong_state' | 'rate_limited' | 'validation_failed';
      message: string;
    }
  | { type: 'pong'; seq: number };
