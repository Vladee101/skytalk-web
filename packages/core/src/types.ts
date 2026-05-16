// ============================================================
// FlightLesson — mirrors actual desktop tutor output
// Source: DOMAIN_MODEL §1 (desktop format, not Annex A idealized spec)
// ============================================================

export interface FlightLesson {
  schema_version: '1.0';
  id?: string;
  lesson: LessonMetadata;
  steps: Step[];
}

export interface LessonMetadata {
  name: string;
  callsign: string; // pattern: ^[A-Z0-9]+$
  route: string; // pattern: ^[A-Z]{4}-[A-Z]{4}$
  aircraft_type: string;
  aircraft?: string; // legacy alias, ignored at runtime
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  level?: string; // legacy alias, ignored at runtime
}

export interface Step {
  step: number; // integer, sequential, starts at 1
  id?: string;
  phase: FlightPhase;
  atc: string;
  expected_readback: string;
  required_inputs: RequiredInput[]; // empty array = no input required
  notes?: string;
  strictness?: Strictness;
  atc_translation?: string;
  readback_translation?: string;
  atc_translation_ru?: string;
  readback_translation_ru?: string;
  required_inputs_local?: RequiredInput[]; // desktop-internal field, ignored
}

export type FlightPhase =
  | 'PREFLIGHT'
  | 'PUSHBACK'
  | 'TAXI'
  | 'LINE-UP'
  | 'TAKEOFF'
  | 'CLIMB'
  | 'ENROUTE'
  | 'DESCENT'
  | 'APPROACH'
  | 'LANDING'
  | 'TAXI-IN';

export type Strictness = 'standard' | 'critical' | 'training' | 'listen_only';

export type RequiredInputType = 'none' | 'com_frequency' | 'squawk' | 'heading' | 'altitude';

export interface RequiredInput {
  type: Exclude<RequiredInputType, 'none'>; // "none" never appears in the array form
  value: string;
  input_id?: string;
}

export function stepExpectsInput(step: Step): boolean {
  return step.required_inputs.length > 0;
}

export function getRequiredInput(step: Step, index: number): RequiredInput | null {
  return step.required_inputs[index] ?? null;
}

// ============================================================
// LessonRuntime — server-side authoritative session state
// Source: DOMAIN_MODEL §1 + §4 (Annex B)
// ============================================================

export type LessonState =
  | 'IDLE'
  | 'LISTENING'
  | 'INPUT_REQUIRED'
  | 'INPUT_NOT_REQUIRED'
  | 'READY_TO_ADVANCE'
  | 'COMPLETED'
  | 'ENDED';

export interface LessonRuntime {
  room_id: string;
  current_step_index: number; // 0-indexed into lesson.steps
  current_input_index: number; // 0-indexed into current step's required_inputs
  state: LessonState;
  attempt_count: number; // attempts on current input, diagnostic only
  last_input?: { value: string; correct: boolean; ts: number };
}

// ============================================================
// State machine events and results
// Source: DOMAIN_MODEL §4.4
// ============================================================

export type StateMachineEvent =
  | { type: 'start_lesson'; by: 'tutor' }
  | { type: 'ptt'; by: 'tutor' | 'student'; pressed: boolean }
  | { type: 'submit_input'; value: string }
  | { type: 'right_arrow'; by: 'tutor' | 'student' }
  | { type: 'repeat_step'; by: 'tutor' }
  | { type: 'skip_step'; by: 'tutor' }
  | { type: 'end_lesson'; by: 'tutor' | 'student' }
  | { type: 'reset_lesson'; by: 'tutor' | 'student' }
  | { type: 'exit'; by: 'student' };

export type EmittedEvent =
  | { type: 'state_changed'; state: LessonState }
  | { type: 'step_changed'; step_index: number; reason: 'advance' | 'skip' | 'start' | 'reset' }
  | {
      type: 'input_result';
      correct: boolean;
      input_index: number;
      more_inputs: boolean;
      attempt_count: number;
    }
  | { type: 'peer_ptt'; by: 'tutor' | 'student'; pressed: boolean }
  | { type: 'repeat_signal' }
  | { type: 'lesson_completed' }
  | { type: 'lesson_reset' }
  | { type: 'lesson_ended'; reason: 'by_tutor' | 'by_student' | 'exit' | 'expired' };

export type TransitionResult =
  | { ok: true; state: LessonRuntime; emit: EmittedEvent[] }
  | { ok: false; error: 'invalid_action' | 'wrong_role' | 'wrong_state'; message: string };

// ============================================================
// Role-based view filtering
// Source: DOMAIN_MODEL §5
// ============================================================

// What the student sees for a step: input types only, no expected values
export type StepView = {
  step: number;
  phase: FlightPhase;
  required_inputs: Array<{ type: Exclude<RequiredInputType, 'none'> }>;
};

export type StepViewTutor = Step;

// ============================================================
// Lesson validation types
// Source: DOMAIN_MODEL §2
// ============================================================

export type ValidationError = {
  path: string;
  rule: string;
  message: string;
  severity: 'error' | 'warning';
};

export type ValidationResult =
  | { valid: true; lesson: FlightLesson; warnings: ValidationError[] }
  | { valid: false; errors: ValidationError[]; warnings: ValidationError[] };

// ============================================================
// Input validation types
// Source: DOMAIN_MODEL §3
// ============================================================

export type InputValidationResult =
  | { correct: true }
  | { correct: false; reason: 'format_invalid' | 'value_mismatch' };

// ============================================================
// Session event log
// Source: DOMAIN_MODEL §6
// ============================================================

export type SessionEventType =
  | 'room_created'
  | 'client_connected'
  | 'client_disconnected'
  | 'lesson_started'
  | 'state_changed'
  | 'step_changed'
  | 'input_submitted'
  | 'ptt_changed'
  | 'lesson_completed'
  | 'lesson_ended';

export interface SessionEvent {
  id: number; // auto-increment
  room_id: string;
  ts: number; // unix ms
  actor: 'tutor' | 'student' | 'server';
  event_type: SessionEventType;
  payload: Record<string, unknown>;
}
