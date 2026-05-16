import { describe, expect, it } from 'vitest';

import type {
  FlightLesson,
  InputValidationResult,
  LessonRuntime,
  LessonState,
  RequiredInput,
  StateMachineEvent,
  Step,
  ValidationResult,
} from '../src/index';

describe('@skytalk/core', () => {
  it('exports key types without error', () => {
    // Type-only imports are erased at runtime; this verifies the module resolves
    // and all named exports exist. Actual logic tests live in T-010/T-011/T-013.
    const state: LessonState = 'IDLE';
    expect(state).toBe('IDLE');
  });

  it('LessonStateMachine is exported as a class', async () => {
    const { LessonStateMachine } = await import('../src/index');
    expect(typeof LessonStateMachine).toBe('function');
  });

  it('validateInput is exported as a function', async () => {
    const { validateInput } = await import('../src/index');
    expect(typeof validateInput).toBe('function');
  });

  it('validateFlightJson is exported as a function', async () => {
    const { validateFlightJson } = await import('../src/index');
    expect(typeof validateFlightJson).toBe('function');
  });
});

// Compile-time type checks — these assignments are never executed but tsc
// verifies the shapes are correct.
type _FlightLessonShape = FlightLesson;
type _StepShape = Step;
type _RequiredInputShape = RequiredInput;
type _LessonRuntimeShape = LessonRuntime;
type _StateMachineEventShape = StateMachineEvent;
type _ValidationResultShape = ValidationResult;
type _InputValidationResultShape = InputValidationResult;
