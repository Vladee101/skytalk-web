import type {
  EmittedEvent,
  FlightLesson,
  LessonRuntime,
  LessonState,
  StateMachineEvent,
  Step,
  StepView,
  TransitionResult,
} from './types';
import { validateInput } from './validate-input';

// ============================================================
// Helpers
// ============================================================

function ok(state: LessonRuntime, emit: EmittedEvent[]): TransitionResult {
  return { ok: true, state, emit };
}

function invalid(message: string): TransitionResult {
  return { ok: false, error: 'invalid_action', message };
}

function stateChangedEvent(s: LessonState): EmittedEvent {
  return { type: 'state_changed', state: s };
}

// ============================================================
// LessonStateMachine
// ============================================================

export class LessonStateMachine {
  constructor(private readonly lesson: FlightLesson) {}

  initial(): LessonRuntime {
    return {
      room_id: '',
      current_step_index: 0,
      current_input_index: 0,
      state: 'IDLE',
      attempt_count: 0,
    };
  }

  transition(state: LessonRuntime, event: StateMachineEvent): TransitionResult {
    // ENDED is terminal — nothing is allowed
    if (state.state === 'ENDED') {
      return invalid('No transitions allowed from ENDED');
    }

    // ---- Universal: exit (student leaves, all non-ENDED states) ----
    if (event.type === 'exit') {
      return ok({ ...state, state: 'ENDED' }, [{ type: 'lesson_ended', reason: 'exit' }]);
    }

    // ---- Universal: end_lesson (all non-IDLE, non-ENDED states) ----
    if (event.type === 'end_lesson') {
      if (state.state === 'IDLE') return invalid('end_lesson is not allowed from IDLE');
      const reason = event.by === 'tutor' ? 'by_tutor' : 'by_student';
      return ok({ ...state, state: 'ENDED' }, [{ type: 'lesson_ended', reason }]);
    }

    // ---- Universal: reset_lesson (all non-IDLE, non-ENDED states) ----
    if (event.type === 'reset_lesson') {
      if (state.state === 'IDLE') return invalid('reset_lesson is not allowed from IDLE');
      // Rebuild without last_input so attempt diagnostics start fresh
      const next: LessonRuntime = {
        room_id: state.room_id,
        current_step_index: 0,
        current_input_index: 0,
        state: 'LISTENING',
        attempt_count: 0,
      };
      return ok(next, [
        { type: 'lesson_reset' },
        { type: 'step_changed', step_index: 0, reason: 'reset' },
        stateChangedEvent('LISTENING'),
      ]);
    }

    // ---- State-specific transitions ----
    switch (state.state) {
      case 'IDLE': {
        if (event.type === 'start_lesson') {
          const next: LessonRuntime = {
            ...state,
            state: 'LISTENING',
            current_step_index: 0,
            current_input_index: 0,
            attempt_count: 0,
          };
          return ok(next, [
            stateChangedEvent('LISTENING'),
            { type: 'step_changed', step_index: 0, reason: 'start' },
          ]);
        }
        if (event.type === 'ptt') {
          return ok(state, [{ type: 'peer_ptt', by: event.by, pressed: event.pressed }]);
        }
        return invalid(`Event '${event.type}' is not allowed in IDLE`);
      }

      case 'LISTENING': {
        if (event.type === 'ptt') {
          const pttEmit: EmittedEvent = { type: 'peer_ptt', by: event.by, pressed: event.pressed };
          // Tutor PTT release is the observable "tutor finished speaking" signal (web adaptation of Annex B)
          if (event.by === 'tutor' && !event.pressed) {
            const step = this.currentStep(state);
            if (!step) return invalid('current_step_index out of bounds');
            const nextLessonState: LessonState =
              step.required_inputs.length > 0 ? 'INPUT_REQUIRED' : 'INPUT_NOT_REQUIRED';
            return ok({ ...state, state: nextLessonState }, [pttEmit, stateChangedEvent(nextLessonState)]);
          }
          return ok(state, [pttEmit]);
        }
        if (event.type === 'right_arrow') return invalid('Right Arrow is blocked in LISTENING');
        if (event.type === 'submit_input') return invalid('submit_input is not allowed in LISTENING');
        if (event.type === 'start_lesson') return invalid('start_lesson is not allowed in LISTENING');
        if (event.type === 'repeat_step') return ok(state, [{ type: 'repeat_signal' }]);
        if (event.type === 'skip_step') return this.doSkip(state);
        return invalid('Unexpected event in LISTENING');
      }

      case 'INPUT_REQUIRED': {
        if (event.type === 'submit_input') {
          const step = this.currentStep(state);
          if (!step) return invalid('current_step_index out of bounds');
          const input = step.required_inputs[state.current_input_index];
          if (!input) return invalid('current_input_index out of bounds');

          const validation = validateInput(input.type, input.value, event.value);

          if (validation.correct) {
            const isLast = state.current_input_index >= step.required_inputs.length - 1;
            if (isLast) {
              // Last correct input → READY_TO_ADVANCE; attempt_count counts this attempt too
              const newAttemptCount = state.attempt_count + 1;
              const next: LessonRuntime = {
                ...state,
                state: 'READY_TO_ADVANCE',
                attempt_count: newAttemptCount,
                last_input: { value: event.value, correct: true, ts: Date.now() },
              };
              return ok(next, [
                {
                  type: 'input_result',
                  correct: true,
                  input_index: state.current_input_index,
                  more_inputs: false,
                  attempt_count: newAttemptCount,
                },
                stateChangedEvent('READY_TO_ADVANCE'),
              ]);
            } else {
              // Intermediate correct input → stay INPUT_REQUIRED, advance input pointer, reset attempt_count
              const next: LessonRuntime = {
                ...state,
                current_input_index: state.current_input_index + 1,
                attempt_count: 0,
                last_input: { value: event.value, correct: true, ts: Date.now() },
              };
              return ok(next, [
                {
                  type: 'input_result',
                  correct: true,
                  input_index: state.current_input_index,
                  more_inputs: true,
                  attempt_count: 0,
                },
              ]);
            }
          } else {
            const newAttemptCount = state.attempt_count + 1;
            const next: LessonRuntime = {
              ...state,
              attempt_count: newAttemptCount,
              last_input: { value: event.value, correct: false, ts: Date.now() },
            };
            return ok(next, [
              {
                type: 'input_result',
                correct: false,
                input_index: state.current_input_index,
                more_inputs: false,
                attempt_count: newAttemptCount,
              },
            ]);
          }
        }
        if (event.type === 'right_arrow') return invalid('Right Arrow is blocked in INPUT_REQUIRED');
        if (event.type === 'start_lesson') return invalid('start_lesson is not allowed in INPUT_REQUIRED');
        if (event.type === 'ptt') {
          return ok(state, [{ type: 'peer_ptt', by: event.by, pressed: event.pressed }]);
        }
        if (event.type === 'repeat_step') return ok(state, [{ type: 'repeat_signal' }]);
        if (event.type === 'skip_step') return this.doSkip(state);
        return invalid('Unexpected event in INPUT_REQUIRED');
      }

      case 'INPUT_NOT_REQUIRED': {
        if (event.type === 'right_arrow') {
          return ok({ ...state, state: 'READY_TO_ADVANCE' }, [stateChangedEvent('READY_TO_ADVANCE')]);
        }
        if (event.type === 'ptt') {
          return ok(state, [{ type: 'peer_ptt', by: event.by, pressed: event.pressed }]);
        }
        if (event.type === 'submit_input') return invalid('submit_input is not allowed in INPUT_NOT_REQUIRED');
        if (event.type === 'start_lesson') return invalid('start_lesson is not allowed in INPUT_NOT_REQUIRED');
        if (event.type === 'repeat_step') return ok(state, [{ type: 'repeat_signal' }]);
        if (event.type === 'skip_step') return this.doSkip(state);
        return invalid('Unexpected event in INPUT_NOT_REQUIRED');
      }

      case 'READY_TO_ADVANCE': {
        if (event.type === 'right_arrow') {
          const nextStepIndex = state.current_step_index + 1;
          if (nextStepIndex >= this.lesson.steps.length) {
            return ok({ ...state, state: 'COMPLETED' }, [{ type: 'lesson_completed' }]);
          }
          const next: LessonRuntime = {
            ...state,
            state: 'LISTENING',
            current_step_index: nextStepIndex,
            current_input_index: 0,
            attempt_count: 0,
          };
          return ok(next, [
            { type: 'step_changed', step_index: nextStepIndex, reason: 'advance' },
            stateChangedEvent('LISTENING'),
          ]);
        }
        if (event.type === 'ptt') {
          return ok(state, [{ type: 'peer_ptt', by: event.by, pressed: event.pressed }]);
        }
        if (event.type === 'submit_input') return invalid('submit_input is not allowed in READY_TO_ADVANCE');
        if (event.type === 'start_lesson') return invalid('start_lesson is not allowed in READY_TO_ADVANCE');
        if (event.type === 'repeat_step') return ok(state, [{ type: 'repeat_signal' }]);
        if (event.type === 'skip_step') return this.doSkip(state);
        return invalid('Unexpected event in READY_TO_ADVANCE');
      }

      case 'COMPLETED': {
        if (event.type === 'right_arrow') return ok(state, []); // no-op per Annex B §B.3 table
        if (event.type === 'ptt') {
          return ok(state, [{ type: 'peer_ptt', by: event.by, pressed: event.pressed }]);
        }
        // reset_lesson and end_lesson/exit are handled universally above and cannot reach here
        return invalid(`Event '${event.type}' is not allowed in COMPLETED`);
      }

      default: {
        const _exhaustive: never = state.state;
        return invalid(`Unexpected state: ${String(_exhaustive)}`);
      }
    }
  }

  private currentStep(state: LessonRuntime): Step | undefined {
    return this.lesson.steps[state.current_step_index];
  }

  private doSkip(state: LessonRuntime): TransitionResult {
    const nextStepIndex = state.current_step_index + 1;
    if (nextStepIndex >= this.lesson.steps.length) {
      return ok({ ...state, state: 'COMPLETED' }, [{ type: 'lesson_completed' }]);
    }
    const next: LessonRuntime = {
      ...state,
      state: 'LISTENING',
      current_step_index: nextStepIndex,
      current_input_index: 0,
      attempt_count: 0,
    };
    return ok(next, [
      { type: 'step_changed', step_index: nextStepIndex, reason: 'skip' },
      stateChangedEvent('LISTENING'),
    ]);
  }
}

// ============================================================
// viewStepForRole — security boundary: student never sees expected values
// ============================================================

export function viewStepForRole<R extends 'tutor' | 'student'>(
  step: Step,
  role: R,
): R extends 'tutor' ? Step : StepView {
  if (role === 'tutor') return step as R extends 'tutor' ? Step : StepView;
  const view: StepView = {
    step: step.step,
    phase: step.phase,
    required_inputs: step.required_inputs.map((ri) => ({ type: ri.type })),
  };
  return view as R extends 'tutor' ? Step : StepView;
}
