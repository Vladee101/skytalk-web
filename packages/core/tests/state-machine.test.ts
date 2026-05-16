import { describe, expect, it } from 'vitest';
import { fc, it as itProp } from '@fast-check/vitest';

import { LessonStateMachine, viewStepForRole } from '../src/state-machine';
import type {
  EmittedEvent,
  FlightLesson,
  FlightPhase,
  LessonRuntime,
  RequiredInputType,
  StateMachineEvent,
  Step,
} from '../src/types';

// ============================================================
// Test fixtures
// ============================================================

// Two-step lesson: step 1 has one com_frequency input, step 2 has none
const LESSON_SINGLE: FlightLesson = {
  schema_version: '1.0',
  lesson: {
    name: 'Single Input Test',
    callsign: 'KLM641',
    route: 'KJFK-EHAM',
    aircraft_type: 'B747',
    difficulty: 'beginner',
  },
  steps: [
    {
      step: 1,
      phase: 'TAXI',
      atc: 'KLM641, contact Tower 118.70',
      expected_readback: 'Tower 118.70, KLM641',
      required_inputs: [{ type: 'com_frequency', value: '118.70' }],
    },
    {
      step: 2,
      phase: 'TAKEOFF',
      atc: 'KLM641, cleared for takeoff',
      expected_readback: 'Cleared for takeoff, KLM641',
      required_inputs: [],
    },
  ],
};

// One-step lesson with 4 required inputs (§7.10 fixture)
const LESSON_MULTI: FlightLesson = {
  schema_version: '1.0',
  lesson: {
    name: 'Multi Input Test',
    callsign: 'KLM641',
    route: 'KJFK-EHAM',
    aircraft_type: 'B747',
    difficulty: 'beginner',
  },
  steps: [
    {
      step: 1,
      phase: 'PREFLIGHT',
      atc: 'KLM641, cleared to destination, maintain flight level 300, squawk 4721',
      expected_readback: '...',
      required_inputs: [
        { type: 'com_frequency', value: '118.00' },
        { type: 'heading', value: '090' },
        { type: 'altitude', value: '30000' },
        { type: 'squawk', value: '4721' },
      ],
    },
  ],
};

// Three-step lesson for reset/skip/end tests
const LESSON_THREE: FlightLesson = {
  schema_version: '1.0',
  lesson: {
    name: 'Three Step Test',
    callsign: 'KLM642',
    route: 'KJFK-EHAM',
    aircraft_type: 'B777',
    difficulty: 'intermediate',
  },
  steps: [
    {
      step: 1,
      phase: 'TAXI',
      atc: 'KLM642, taxi to 31L',
      expected_readback: 'Taxi 31L, KLM642',
      required_inputs: [{ type: 'squawk', value: '4721' }],
    },
    {
      step: 2,
      phase: 'LINE-UP',
      atc: 'KLM642, line up and wait',
      expected_readback: 'Line up and wait, KLM642',
      required_inputs: [],
    },
    {
      step: 3,
      phase: 'TAKEOFF',
      atc: 'KLM642, cleared for takeoff, contact Departure 118.70',
      expected_readback: 'Cleared for takeoff, KLM642',
      required_inputs: [{ type: 'com_frequency', value: '118.70' }],
    },
  ],
};

// ============================================================
// Helpers
// ============================================================

// Asserts the transition succeeded and returns the result
function go(sm: LessonStateMachine, state: LessonRuntime, event: StateMachineEvent) {
  const result = sm.transition(state, event);
  if (!result.ok) throw new Error(`Expected ok, got error: ${result.message}`);
  return result;
}

// Shorthand: advance state only
function step(sm: LessonStateMachine, state: LessonRuntime, event: StateMachineEvent): LessonRuntime {
  return go(sm, state, event).state;
}

// Reach LISTENING at step 0
function toListening(sm: LessonStateMachine): LessonRuntime {
  return step(sm, sm.initial(), { type: 'start_lesson', by: 'tutor' });
}

// Reach INPUT_REQUIRED at step 0 (lesson must have required_inputs on step 0)
function toInputRequired(sm: LessonStateMachine): LessonRuntime {
  const listening = toListening(sm);
  return step(sm, listening, { type: 'ptt', by: 'tutor', pressed: false });
}

// Reach INPUT_NOT_REQUIRED (use step 2 of LESSON_SINGLE which has no inputs)
function toInputNotRequired(): LessonRuntime {
  const sm = new LessonStateMachine(LESSON_SINGLE);
  // Advance through step 1 first
  let s = toInputRequired(sm);
  s = step(sm, s, { type: 'submit_input', value: '118.70' }); // → READY_TO_ADVANCE
  s = step(sm, s, { type: 'right_arrow', by: 'student' }); // → LISTENING at step 2
  s = step(sm, s, { type: 'ptt', by: 'tutor', pressed: false }); // → INPUT_NOT_REQUIRED
  return s;
}

// ============================================================
// initial()
// ============================================================

describe('LessonStateMachine.initial()', () => {
  it('returns IDLE state', () => {
    const sm = new LessonStateMachine(LESSON_SINGLE);
    const s = sm.initial();
    expect(s.state).toBe('IDLE');
    expect(s.current_step_index).toBe(0);
    expect(s.current_input_index).toBe(0);
    expect(s.attempt_count).toBe(0);
    expect(s.last_input).toBeUndefined();
  });
});

// ============================================================
// §7.4 — Happy path: single input
// ============================================================

describe('§7.4 — happy path, single input', () => {
  it('full happy path: IDLE → LISTENING → INPUT_REQUIRED → READY_TO_ADVANCE → LISTENING → INPUT_NOT_REQUIRED → COMPLETED', () => {
    const sm = new LessonStateMachine(LESSON_SINGLE);
    let s = sm.initial();
    expect(s.state).toBe('IDLE');
    expect(s.current_input_index).toBe(0);

    // Tutor starts lesson
    s = step(sm, s, { type: 'start_lesson', by: 'tutor' });
    expect(s.state).toBe('LISTENING');

    // Tutor PTT press (no state change) then release (→ INPUT_REQUIRED, step has input)
    s = step(sm, s, { type: 'ptt', by: 'tutor', pressed: true });
    expect(s.state).toBe('LISTENING');
    s = step(sm, s, { type: 'ptt', by: 'tutor', pressed: false });
    expect(s.state).toBe('INPUT_REQUIRED');

    // Student submits correct value
    const r = go(sm, s, { type: 'submit_input', value: '118.70' });
    expect(r.state.state).toBe('READY_TO_ADVANCE');
    expect(r.emit).toContainEqual(
      expect.objectContaining({
        type: 'input_result',
        correct: true,
        input_index: 0,
        more_inputs: false,
      }),
    );
    s = r.state;

    // Student Right Arrow → step 2, LISTENING
    s = step(sm, s, { type: 'right_arrow', by: 'student' });
    expect(s.current_step_index).toBe(1);
    expect(s.state).toBe('LISTENING');

    // Tutor releases PTT on no-input step → INPUT_NOT_REQUIRED
    s = step(sm, s, { type: 'ptt', by: 'tutor', pressed: false });
    expect(s.state).toBe('INPUT_NOT_REQUIRED');

    // First Right Arrow: INPUT_NOT_REQUIRED → READY_TO_ADVANCE (Annex B §B.3)
    s = step(sm, s, { type: 'right_arrow', by: 'student' });
    expect(s.state).toBe('READY_TO_ADVANCE');

    // Second Right Arrow: READY_TO_ADVANCE on last step → COMPLETED
    s = step(sm, s, { type: 'right_arrow', by: 'student' });
    expect(s.state).toBe('COMPLETED');
  });

  it('start_lesson emits state_changed{LISTENING} and step_changed{0, start}', () => {
    const sm = new LessonStateMachine(LESSON_SINGLE);
    const r = go(sm, sm.initial(), { type: 'start_lesson', by: 'tutor' });
    expect(r.emit).toContainEqual(expect.objectContaining({ type: 'state_changed', state: 'LISTENING' }));
    expect(r.emit).toContainEqual(
      expect.objectContaining({ type: 'step_changed', step_index: 0, reason: 'start' }),
    );
  });

  it('correct submit emits state_changed{READY_TO_ADVANCE}', () => {
    const sm = new LessonStateMachine(LESSON_SINGLE);
    const s = toInputRequired(sm);
    const r = go(sm, s, { type: 'submit_input', value: '118.70' });
    expect(r.emit).toContainEqual(
      expect.objectContaining({ type: 'state_changed', state: 'READY_TO_ADVANCE' }),
    );
  });

  it('right_arrow in READY_TO_ADVANCE emits step_changed{1, advance}', () => {
    const sm = new LessonStateMachine(LESSON_SINGLE);
    let s = toInputRequired(sm);
    s = step(sm, s, { type: 'submit_input', value: '118.70' });
    const r = go(sm, s, { type: 'right_arrow', by: 'student' });
    expect(r.emit).toContainEqual(
      expect.objectContaining({ type: 'step_changed', step_index: 1, reason: 'advance' }),
    );
  });

  it('right_arrow on last step emits lesson_completed', () => {
    const sm = new LessonStateMachine(LESSON_SINGLE);
    let s = toInputRequired(sm);
    s = step(sm, s, { type: 'submit_input', value: '118.70' }); // READY_TO_ADVANCE
    s = step(sm, s, { type: 'right_arrow', by: 'student' }); // LISTENING step 2
    s = step(sm, s, { type: 'ptt', by: 'tutor', pressed: false }); // INPUT_NOT_REQUIRED
    s = step(sm, s, { type: 'right_arrow', by: 'student' }); // READY_TO_ADVANCE
    const r = go(sm, s, { type: 'right_arrow', by: 'student' });
    expect(r.state.state).toBe('COMPLETED');
    expect(r.emit).toContainEqual(expect.objectContaining({ type: 'lesson_completed' }));
  });

  it('attempt_count resets to 0 when step advances', () => {
    const sm = new LessonStateMachine(LESSON_SINGLE);
    let s = toInputRequired(sm);
    // Two wrong attempts, then correct
    s = step(sm, s, { type: 'submit_input', value: '999.9' });
    s = step(sm, s, { type: 'submit_input', value: '000.0' });
    expect(s.attempt_count).toBe(2);
    s = step(sm, s, { type: 'submit_input', value: '118.70' }); // READY_TO_ADVANCE
    expect(s.attempt_count).toBe(3); // correct counts too (§7.5 rule)
    s = step(sm, s, { type: 'right_arrow', by: 'student' }); // advance
    expect(s.attempt_count).toBe(0);
    expect(s.current_input_index).toBe(0);
  });
});

// ============================================================
// §7.5 — Error recovery
// ============================================================

describe('§7.5 — error recovery (wrong input, no auto-skip)', () => {
  it('wrong input stays INPUT_REQUIRED and increments attempt_count', () => {
    const sm = new LessonStateMachine(LESSON_SINGLE);
    let s = toInputRequired(sm);

    const r = go(sm, s, { type: 'submit_input', value: '118.7' }); // missing trailing zero
    expect(r.state.state).toBe('INPUT_REQUIRED');
    expect(r.state.attempt_count).toBe(1);
    expect(r.emit).toContainEqual(
      expect.objectContaining({ type: 'input_result', correct: false, attempt_count: 1 }),
    );
    s = r.state;

    // 2nd wrong
    const r2 = go(sm, s, { type: 'submit_input', value: '118.71' });
    expect(r2.state.state).toBe('INPUT_REQUIRED');
    expect(r2.state.attempt_count).toBe(2);
    s = r2.state;

    // 3rd wrong — NO auto-skip (v1 has no max attempts)
    const r3 = go(sm, s, { type: 'submit_input', value: '118.72' });
    expect(r3.state.state).toBe('INPUT_REQUIRED');
    expect(r3.state.attempt_count).toBe(3);
    s = r3.state;

    // 4th wrong — also allowed
    const r4 = go(sm, s, { type: 'submit_input', value: '118.73' });
    expect(r4.ok).toBe(true);
    expect(r4.state.attempt_count).toBe(4);
    s = r4.state;

    // Correct on 5th — attempt_count includes the correct attempt
    const r5 = go(sm, s, { type: 'submit_input', value: '118.70' });
    expect(r5.state.state).toBe('READY_TO_ADVANCE');
    expect(r5.state.attempt_count).toBe(5);
  });

  it('wrong input with format_invalid stays INPUT_REQUIRED', () => {
    const sm = new LessonStateMachine(LESSON_SINGLE);
    const s = toInputRequired(sm);
    // 'abc' fails format check for com_frequency
    const r = go(sm, s, { type: 'submit_input', value: 'abc' });
    expect(r.state.state).toBe('INPUT_REQUIRED');
    expect(r.state.attempt_count).toBe(1);
  });
});

// ============================================================
// §7.6 — Right Arrow authority matrix
// ============================================================

describe('§7.6 — Right Arrow authority matrix', () => {
  it('right_arrow in IDLE → invalid_action', () => {
    const sm = new LessonStateMachine(LESSON_SINGLE);
    const r = sm.transition(sm.initial(), { type: 'right_arrow', by: 'student' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('invalid_action');
  });

  it('right_arrow in LISTENING → invalid_action', () => {
    const sm = new LessonStateMachine(LESSON_SINGLE);
    const s = toListening(sm);
    const r = sm.transition(s, { type: 'right_arrow', by: 'student' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('invalid_action');
  });

  it('right_arrow in INPUT_REQUIRED → invalid_action', () => {
    const sm = new LessonStateMachine(LESSON_SINGLE);
    const s = toInputRequired(sm);
    const r = sm.transition(s, { type: 'right_arrow', by: 'student' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('invalid_action');
  });

  it('right_arrow in INPUT_NOT_REQUIRED → READY_TO_ADVANCE', () => {
    const s = toInputNotRequired();
    const sm = new LessonStateMachine(LESSON_SINGLE);
    const r = sm.transition(s, { type: 'right_arrow', by: 'student' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state.state).toBe('READY_TO_ADVANCE');
  });

  it('right_arrow in READY_TO_ADVANCE on last step → COMPLETED', () => {
    const sm = new LessonStateMachine(LESSON_SINGLE);
    let s = toInputNotRequired();
    s = step(sm, s, { type: 'right_arrow', by: 'student' }); // → READY_TO_ADVANCE
    const r = sm.transition(s, { type: 'right_arrow', by: 'student' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state.state).toBe('COMPLETED');
  });

  it('right_arrow in COMPLETED is a no-op', () => {
    const sm = new LessonStateMachine(LESSON_SINGLE);
    let s = toInputNotRequired();
    s = step(sm, s, { type: 'right_arrow', by: 'student' }); // READY_TO_ADVANCE
    s = step(sm, s, { type: 'right_arrow', by: 'student' }); // COMPLETED
    const r = sm.transition(s, { type: 'right_arrow', by: 'student' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state.state).toBe('COMPLETED');
      expect(r.emit).toHaveLength(0);
    }
  });
});

// ============================================================
// §7.7 — Tutor PTT release as state trigger
// ============================================================

describe('§7.7 — tutor PTT release as state trigger', () => {
  it('PTT release in LISTENING on input step → INPUT_REQUIRED', () => {
    const sm = new LessonStateMachine(LESSON_SINGLE);
    const s = toListening(sm); // step 0 has required_inputs
    const r = go(sm, s, { type: 'ptt', by: 'tutor', pressed: false });
    expect(r.state.state).toBe('INPUT_REQUIRED');
  });

  it('PTT release in LISTENING on no-input step → INPUT_NOT_REQUIRED', () => {
    const sm = new LessonStateMachine(LESSON_SINGLE);
    // Reach LISTENING at step 2 (no inputs)
    let s = toInputRequired(sm);
    s = step(sm, s, { type: 'submit_input', value: '118.70' }); // READY_TO_ADVANCE
    s = step(sm, s, { type: 'right_arrow', by: 'student' }); // LISTENING step 2
    const r = go(sm, s, { type: 'ptt', by: 'tutor', pressed: false });
    expect(r.state.state).toBe('INPUT_NOT_REQUIRED');
  });

  it('PTT emits peer_ptt event', () => {
    const sm = new LessonStateMachine(LESSON_SINGLE);
    const s = toListening(sm);
    const r = go(sm, s, { type: 'ptt', by: 'tutor', pressed: true });
    expect(r.emit).toContainEqual(
      expect.objectContaining({ type: 'peer_ptt', by: 'tutor', pressed: true }),
    );
  });

  it('tutor PTT press in LISTENING does not change state', () => {
    const sm = new LessonStateMachine(LESSON_SINGLE);
    const s = toListening(sm);
    const r = go(sm, s, { type: 'ptt', by: 'tutor', pressed: true });
    expect(r.state.state).toBe('LISTENING');
  });

  it('tutor PTT release in INPUT_REQUIRED does not change state', () => {
    const sm = new LessonStateMachine(LESSON_SINGLE);
    const s = toInputRequired(sm);
    const r = go(sm, s, { type: 'ptt', by: 'tutor', pressed: false });
    expect(r.state.state).toBe('INPUT_REQUIRED');
  });

  it('student PTT in LISTENING does not change state', () => {
    const sm = new LessonStateMachine(LESSON_SINGLE);
    const s = toListening(sm);
    const r = go(sm, s, { type: 'ptt', by: 'student', pressed: true });
    expect(r.state.state).toBe('LISTENING');
    expect(r.emit).toContainEqual(
      expect.objectContaining({ type: 'peer_ptt', by: 'student', pressed: true }),
    );
  });
});

// ============================================================
// §7.10 — Multi-input step
// ============================================================

describe('§7.10 — multi-input step (4 inputs)', () => {
  it('correct path: all 4 inputs → READY_TO_ADVANCE, indices and attempt_count correct', () => {
    const sm = new LessonStateMachine(LESSON_MULTI);
    let s = toInputRequired(sm);
    expect(s.current_input_index).toBe(0);

    // Input 0: correct → stays INPUT_REQUIRED, index advances
    let r = go(sm, s, { type: 'submit_input', value: '118.00' });
    expect(r.state.state).toBe('INPUT_REQUIRED');
    expect(r.state.current_input_index).toBe(1);
    expect(r.state.attempt_count).toBe(0); // resets for next input
    expect(r.emit).toContainEqual(
      expect.objectContaining({
        type: 'input_result',
        correct: true,
        input_index: 0,
        more_inputs: true,
      }),
    );
    s = r.state;

    // Input 1: wrong then correct
    r = go(sm, s, { type: 'submit_input', value: '999' });
    expect(r.state.current_input_index).toBe(1); // stays
    expect(r.state.attempt_count).toBe(1);
    s = r.state;

    r = go(sm, s, { type: 'submit_input', value: '090' });
    expect(r.state.current_input_index).toBe(2);
    expect(r.state.attempt_count).toBe(0); // resets on correct intermediate
    s = r.state;

    // Input 2: correct
    r = go(sm, s, { type: 'submit_input', value: '30000' });
    expect(r.state.current_input_index).toBe(3);
    s = r.state;

    // Input 3 (last): correct → READY_TO_ADVANCE
    r = go(sm, s, { type: 'submit_input', value: '4721' });
    expect(r.state.state).toBe('READY_TO_ADVANCE');
    expect(r.emit).toContainEqual(
      expect.objectContaining({
        type: 'input_result',
        correct: true,
        input_index: 3,
        more_inputs: false,
      }),
    );

    // Single step lesson → Right Arrow → COMPLETED
    const final = step(sm, r.state, { type: 'right_arrow', by: 'student' });
    expect(final.state).toBe('COMPLETED');
  });

  it('wrong intermediate input does not advance input_index', () => {
    const sm = new LessonStateMachine(LESSON_MULTI);
    let s = toInputRequired(sm);
    s = step(sm, s, { type: 'submit_input', value: 'bad' }); // wrong
    expect(s.current_input_index).toBe(0); // stayed
    expect(s.attempt_count).toBe(1);
  });

  it('state stays INPUT_REQUIRED until all inputs are correct', () => {
    const sm = new LessonStateMachine(LESSON_MULTI);
    let s = toInputRequired(sm);
    s = step(sm, s, { type: 'submit_input', value: '118.00' }); // input 0 correct
    expect(s.state).toBe('INPUT_REQUIRED');
    s = step(sm, s, { type: 'submit_input', value: '090' }); // input 1 correct
    expect(s.state).toBe('INPUT_REQUIRED');
    s = step(sm, s, { type: 'submit_input', value: '30000' }); // input 2 correct
    expect(s.state).toBe('INPUT_REQUIRED');
    s = step(sm, s, { type: 'submit_input', value: '4721' }); // input 3 correct
    expect(s.state).toBe('READY_TO_ADVANCE'); // NOW transitions
  });
});

// ============================================================
// §7.9 — Reset and Exit
// ============================================================

describe('§7.9 — reset_lesson and exit', () => {
  it('reset from COMPLETED → LISTENING at step 0', () => {
    const sm = new LessonStateMachine(LESSON_SINGLE);
    let s = toInputNotRequired();
    s = step(sm, s, { type: 'right_arrow', by: 'student' }); // READY_TO_ADVANCE
    s = step(sm, s, { type: 'right_arrow', by: 'student' }); // COMPLETED
    const r = go(sm, s, { type: 'reset_lesson', by: 'student' });
    expect(r.state.state).toBe('LISTENING');
    expect(r.state.current_step_index).toBe(0);
    expect(r.state.attempt_count).toBe(0);
    expect(r.emit).toContainEqual(expect.objectContaining({ type: 'lesson_reset' }));
    expect(r.emit).toContainEqual(
      expect.objectContaining({ type: 'step_changed', step_index: 0, reason: 'reset' }),
    );
  });

  it('reset from mid-lesson INPUT_REQUIRED → LISTENING at step 0', () => {
    const sm = new LessonStateMachine(LESSON_THREE);
    let s = toInputRequired(sm); // INPUT_REQUIRED at step 1 (index 0)
    s = step(sm, s, { type: 'submit_input', value: 'bad' }); // wrong, attempt_count=1
    const r = go(sm, s, { type: 'reset_lesson', by: 'tutor' });
    expect(r.state.state).toBe('LISTENING');
    expect(r.state.current_step_index).toBe(0);
    expect(r.state.attempt_count).toBe(0);
  });

  it('reset from LISTENING → LISTENING at step 0', () => {
    const sm = new LessonStateMachine(LESSON_THREE);
    let s = toInputRequired(sm); // INPUT_REQUIRED step 0
    s = step(sm, s, { type: 'submit_input', value: '4721' }); // READY_TO_ADVANCE
    s = step(sm, s, { type: 'right_arrow', by: 'student' }); // LISTENING step 2 (index 1)
    expect(s.current_step_index).toBe(1);
    const r = go(sm, s, { type: 'reset_lesson', by: 'tutor' });
    expect(r.state.state).toBe('LISTENING');
    expect(r.state.current_step_index).toBe(0);
    expect(r.state.current_input_index).toBe(0);
  });

  it('reset is blocked from IDLE', () => {
    const sm = new LessonStateMachine(LESSON_SINGLE);
    const r = sm.transition(sm.initial(), { type: 'reset_lesson', by: 'student' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('invalid_action');
  });

  it('reset is blocked from ENDED', () => {
    const sm = new LessonStateMachine(LESSON_SINGLE);
    let s = toListening(sm);
    s = step(sm, s, { type: 'end_lesson', by: 'tutor' }); // ENDED
    const r = sm.transition(s, { type: 'reset_lesson', by: 'student' });
    expect(r.ok).toBe(false);
  });

  it('exit from COMPLETED → ENDED with reason "exit"', () => {
    const sm = new LessonStateMachine(LESSON_SINGLE);
    let s = toInputNotRequired();
    s = step(sm, s, { type: 'right_arrow', by: 'student' }); // READY_TO_ADVANCE
    s = step(sm, s, { type: 'right_arrow', by: 'student' }); // COMPLETED
    const r = go(sm, s, { type: 'exit', by: 'student' });
    expect(r.state.state).toBe('ENDED');
    expect(r.emit).toContainEqual(
      expect.objectContaining({ type: 'lesson_ended', reason: 'exit' }),
    );
  });

  it('exit from INPUT_REQUIRED → ENDED', () => {
    const sm = new LessonStateMachine(LESSON_SINGLE);
    const s = toInputRequired(sm);
    const r = go(sm, s, { type: 'exit', by: 'student' });
    expect(r.state.state).toBe('ENDED');
  });

  it('end_lesson by tutor emits reason by_tutor', () => {
    const sm = new LessonStateMachine(LESSON_SINGLE);
    const s = toListening(sm);
    const r = go(sm, s, { type: 'end_lesson', by: 'tutor' });
    expect(r.state.state).toBe('ENDED');
    expect(r.emit).toContainEqual(
      expect.objectContaining({ type: 'lesson_ended', reason: 'by_tutor' }),
    );
  });

  it('end_lesson by student emits reason by_student', () => {
    const sm = new LessonStateMachine(LESSON_SINGLE);
    const s = toListening(sm);
    const r = go(sm, s, { type: 'end_lesson', by: 'student' });
    expect(r.emit).toContainEqual(
      expect.objectContaining({ type: 'lesson_ended', reason: 'by_student' }),
    );
  });

  it('end_lesson from IDLE → invalid_action', () => {
    const sm = new LessonStateMachine(LESSON_SINGLE);
    const r = sm.transition(sm.initial(), { type: 'end_lesson', by: 'tutor' });
    expect(r.ok).toBe(false);
  });

  it('ENDED blocks all further transitions', () => {
    const sm = new LessonStateMachine(LESSON_SINGLE);
    let s = toListening(sm);
    s = step(sm, s, { type: 'end_lesson', by: 'tutor' });
    expect(s.state).toBe('ENDED');

    const events: StateMachineEvent[] = [
      { type: 'start_lesson', by: 'tutor' },
      { type: 'ptt', by: 'tutor', pressed: false },
      { type: 'right_arrow', by: 'student' },
      { type: 'repeat_step', by: 'tutor' },
      { type: 'skip_step', by: 'tutor' },
    ];
    for (const ev of events) {
      const r = sm.transition(s, ev);
      expect(r.ok).toBe(false);
    }
  });
});

// ============================================================
// repeat_step and skip_step
// ============================================================

describe('repeat_step', () => {
  it('emits repeat_signal from LISTENING without changing state', () => {
    const sm = new LessonStateMachine(LESSON_SINGLE);
    const s = toListening(sm);
    const r = go(sm, s, { type: 'repeat_step', by: 'tutor' });
    expect(r.state.state).toBe('LISTENING');
    expect(r.emit).toContainEqual(expect.objectContaining({ type: 'repeat_signal' }));
  });

  it('emits repeat_signal from INPUT_REQUIRED without changing state', () => {
    const sm = new LessonStateMachine(LESSON_SINGLE);
    const s = toInputRequired(sm);
    const r = go(sm, s, { type: 'repeat_step', by: 'tutor' });
    expect(r.state.state).toBe('INPUT_REQUIRED');
    expect(r.emit).toContainEqual(expect.objectContaining({ type: 'repeat_signal' }));
  });
});

describe('skip_step', () => {
  it('skip from LISTENING advances to next step (LISTENING)', () => {
    const sm = new LessonStateMachine(LESSON_THREE);
    const s = toListening(sm); // step 1 (index 0)
    const r = go(sm, s, { type: 'skip_step', by: 'tutor' });
    expect(r.state.state).toBe('LISTENING');
    expect(r.state.current_step_index).toBe(1);
    expect(r.state.current_input_index).toBe(0);
    expect(r.state.attempt_count).toBe(0);
    expect(r.emit).toContainEqual(
      expect.objectContaining({ type: 'step_changed', step_index: 1, reason: 'skip' }),
    );
  });

  it('skip from INPUT_REQUIRED advances step and resets indices', () => {
    const sm = new LessonStateMachine(LESSON_THREE);
    let s = toInputRequired(sm); // step 0
    s = step(sm, s, { type: 'submit_input', value: 'bad' }); // wrong, input_index=0, attempt_count=1
    const r = go(sm, s, { type: 'skip_step', by: 'tutor' });
    expect(r.state.current_step_index).toBe(1);
    expect(r.state.current_input_index).toBe(0);
    expect(r.state.attempt_count).toBe(0);
  });

  it('skip on last step → COMPLETED', () => {
    const sm = new LessonStateMachine(LESSON_SINGLE);
    const s = toListening(sm); // only 2 steps; step at index 0 is not last
    // Advance to last step first
    let s2 = step(sm, s, { type: 'ptt', by: 'tutor', pressed: false }); // INPUT_REQUIRED
    s2 = step(sm, s2, { type: 'submit_input', value: '118.70' }); // READY_TO_ADVANCE
    s2 = step(sm, s2, { type: 'right_arrow', by: 'student' }); // LISTENING step 2 (index 1) — last step
    const r = go(sm, s2, { type: 'skip_step', by: 'tutor' });
    expect(r.state.state).toBe('COMPLETED');
    expect(r.emit).toContainEqual(expect.objectContaining({ type: 'lesson_completed' }));
  });
});

// ============================================================
// start_lesson guards
// ============================================================

describe('start_lesson guards', () => {
  it('start_lesson from LISTENING → invalid_action', () => {
    const sm = new LessonStateMachine(LESSON_SINGLE);
    const s = toListening(sm);
    const r = sm.transition(s, { type: 'start_lesson', by: 'tutor' });
    expect(r.ok).toBe(false);
  });

  it('start_lesson from INPUT_REQUIRED → invalid_action', () => {
    const sm = new LessonStateMachine(LESSON_SINGLE);
    const s = toInputRequired(sm);
    const r = sm.transition(s, { type: 'start_lesson', by: 'tutor' });
    expect(r.ok).toBe(false);
  });
});

// ============================================================
// viewStepForRole
// ============================================================

describe('viewStepForRole', () => {
  const step1 = LESSON_THREE.steps[0]!; // has squawk input with value '4721'

  it('tutor gets the full Step object', () => {
    const view = viewStepForRole(step1, 'tutor');
    expect(view).toBe(step1); // same reference
    expect(view.expected_readback).toBeDefined();
    expect(view.required_inputs[0]?.value).toBe('4721');
  });

  it('student gets StepView: step, phase, required_inputs types only — no values', () => {
    const view = viewStepForRole(step1, 'student');
    expect(view.step).toBe(1);
    expect(view.phase).toBe('TAXI');
    expect(view.required_inputs).toEqual([{ type: 'squawk' }]);
    // Student view must NOT have expected values or ATC text
    expect((view as Record<string, unknown>)['atc']).toBeUndefined();
    expect((view as Record<string, unknown>)['expected_readback']).toBeUndefined();
    expect((view as Record<string, unknown>)['required_inputs'][0]?.value).toBeUndefined();
  });

  it('student view for step with no inputs has empty required_inputs array', () => {
    const noInputStep = LESSON_THREE.steps[1]!; // LINE-UP, no inputs
    const view = viewStepForRole(noInputStep, 'student');
    expect(view.required_inputs).toEqual([]);
  });

  const flightPhaseArb = fc.constantFrom<FlightPhase>(
    'PREFLIGHT',
    'PUSHBACK',
    'TAXI',
    'LINE-UP',
    'TAKEOFF',
    'CLIMB',
    'ENROUTE',
    'DESCENT',
    'APPROACH',
    'LANDING',
    'TAXI-IN',
  );
  const requiredInputTypeArb = fc.constantFrom<Exclude<RequiredInputType, 'none'>>(
    'com_frequency',
    'squawk',
    'heading',
    'altitude',
  );
  const stepArb = fc.record({
    step: fc.integer({ min: 1, max: 100 }),
    phase: flightPhaseArb,
    atc: fc.string({ minLength: 1 }),
    expected_readback: fc.string({ minLength: 1 }),
    required_inputs: fc.array(
      fc.record({ type: requiredInputTypeArb, value: fc.string({ minLength: 1 }) }),
      { maxLength: 4 },
    ),
  });

  itProp.prop([stepArb])(
    'student view never exposes sensitive fields — only step, phase, required_inputs[].type',
    (arbitraryStep) => {
      const view = viewStepForRole(arbitraryStep as unknown as Step, 'student');
      expect(Object.keys(view).sort()).toEqual(['phase', 'required_inputs', 'step']);
      for (const ri of view.required_inputs) {
        expect(Object.keys(ri)).toEqual(['type']);
      }
    },
  );
});
