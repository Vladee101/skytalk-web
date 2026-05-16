import type { FlightLesson, FlightPhase, RequiredInputType, ValidationError, ValidationResult } from './types';
import { validateInputFormat } from './validate-input';

const VALID_PHASES: ReadonlySet<string> = new Set<FlightPhase>([
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
]);

const VALID_DIFFICULTIES: ReadonlySet<string> = new Set(['beginner', 'intermediate', 'advanced']);

const VALID_INPUT_TYPES: ReadonlySet<string> = new Set([
  'com_frequency',
  'squawk',
  'heading',
  'altitude',
]);

const CALLSIGN_RE = /^[A-Z0-9]+$/;
const ROUTE_RE = /^[A-Z]{4}-[A-Z]{4}$/;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function validateFlightJson(raw: unknown): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  function addError(path: string, rule: string, message: string): void {
    errors.push({ path, rule, message, severity: 'error' });
  }
  function addWarning(path: string, rule: string, message: string): void {
    warnings.push({ path, rule, message, severity: 'warning' });
  }

  if (!isPlainObject(raw)) {
    addError('', 'root-must-be-object', 'Root must be a non-null object');
    return { valid: false, errors, warnings };
  }

  if (raw['schema_version'] !== '1.0') {
    addError(
      'schema_version',
      'schema-version',
      `schema_version must be "1.0", got ${JSON.stringify(raw['schema_version'])}`,
    );
    return { valid: false, errors, warnings };
  }

  // Legacy normalization — mutate before field validation so the validator never sees 'frequency'
  if (Array.isArray(raw['steps'])) {
    const steps = raw['steps'] as unknown[];
    for (let si = 0; si < steps.length; si++) {
      const step = steps[si];
      if (isPlainObject(step) && Array.isArray(step['required_inputs'])) {
        const inputs = step['required_inputs'] as unknown[];
        for (let ii = 0; ii < inputs.length; ii++) {
          const input = inputs[ii];
          if (isPlainObject(input) && input['type'] === 'frequency') {
            input['type'] = 'com_frequency';
            addWarning(
              `steps[${si}].required_inputs[${ii}].type`,
              'legacy-frequency-rename',
              "Normalized 'frequency' → 'com_frequency'",
            );
          }
        }
      }
    }
  }

  // Lesson metadata
  if (!isPlainObject(raw['lesson'])) {
    addError('lesson', 'lesson-must-be-object', 'lesson must be a non-null object');
  } else {
    const lesson = raw['lesson'];

    if (typeof lesson['name'] !== 'string' || lesson['name'] === '') {
      addError('lesson.name', 'lesson-name-required', 'lesson.name must be a non-empty string');
    }

    if (typeof lesson['callsign'] !== 'string' || !CALLSIGN_RE.test(lesson['callsign'])) {
      addError(
        'lesson.callsign',
        'lesson-callsign-format',
        'lesson.callsign must match ^[A-Z0-9]+$',
      );
    }

    if (typeof lesson['route'] !== 'string' || !ROUTE_RE.test(lesson['route'])) {
      addError('lesson.route', 'lesson-route-format', 'lesson.route must match ^[A-Z]{4}-[A-Z]{4}$');
    }

    if (typeof lesson['aircraft_type'] !== 'string' || lesson['aircraft_type'] === '') {
      addError(
        'lesson.aircraft_type',
        'lesson-aircraft-type-required',
        'lesson.aircraft_type must be a non-empty string',
      );
    }

    if (typeof lesson['difficulty'] !== 'string' || !VALID_DIFFICULTIES.has(lesson['difficulty'])) {
      addError(
        'lesson.difficulty',
        'lesson-difficulty-enum',
        `lesson.difficulty must be one of beginner/intermediate/advanced, got ${JSON.stringify(lesson['difficulty'])}`,
      );
    }
  }

  // Steps
  if (!Array.isArray(raw['steps']) || (raw['steps'] as unknown[]).length === 0) {
    addError('steps', 'steps-non-empty-array', 'steps must be a non-empty array');
  } else {
    const steps = raw['steps'] as unknown[];
    for (let si = 0; si < steps.length; si++) {
      const prefix = `steps[${si}]`;
      const rawStep = steps[si];

      if (!isPlainObject(rawStep)) {
        addError(prefix, 'step-must-be-object', `${prefix} must be a non-null object`);
        continue;
      }

      if (rawStep['step'] !== si + 1) {
        addError(
          `${prefix}.step`,
          'step-sequential',
          `${prefix}.step must be ${si + 1}, got ${JSON.stringify(rawStep['step'])}`,
        );
      }

      if (typeof rawStep['phase'] !== 'string' || !VALID_PHASES.has(rawStep['phase'])) {
        addError(
          `${prefix}.phase`,
          'step-phase-enum',
          `${prefix}.phase must be a valid FlightPhase, got ${JSON.stringify(rawStep['phase'])}`,
        );
      }

      if (typeof rawStep['atc'] !== 'string' || rawStep['atc'] === '') {
        addError(`${prefix}.atc`, 'step-atc-required', `${prefix}.atc must be a non-empty string`);
      }

      if (typeof rawStep['expected_readback'] !== 'string' || rawStep['expected_readback'] === '') {
        addError(
          `${prefix}.expected_readback`,
          'step-readback-required',
          `${prefix}.expected_readback must be a non-empty string`,
        );
      }

      // Normalize missing required_inputs to []
      if (rawStep['required_inputs'] === undefined || rawStep['required_inputs'] === null) {
        rawStep['required_inputs'] = [];
      } else if (!Array.isArray(rawStep['required_inputs'])) {
        addError(
          `${prefix}.required_inputs`,
          'required-inputs-array',
          `${prefix}.required_inputs must be an array`,
        );
      } else {
        const inputs = rawStep['required_inputs'] as unknown[];

        if (inputs.length > 4) {
          addWarning(
            `${prefix}.required_inputs`,
            'required-inputs-count-sanity',
            `${prefix}.required_inputs has ${inputs.length} items; expected at most 4`,
          );
        }

        for (let ii = 0; ii < inputs.length; ii++) {
          const iPrefix = `${prefix}.required_inputs[${ii}]`;
          const rawInput = inputs[ii];

          if (!isPlainObject(rawInput)) {
            addError(iPrefix, 'required-input-must-be-object', `${iPrefix} must be a non-null object`);
            continue;
          }

          if (typeof rawInput['type'] !== 'string' || !VALID_INPUT_TYPES.has(rawInput['type'])) {
            addError(
              `${iPrefix}.type`,
              'required-input-type-enum',
              `${iPrefix}.type must be one of com_frequency/squawk/heading/altitude, got ${JSON.stringify(rawInput['type'])}`,
            );
          } else {
            const inputType = rawInput['type'] as Exclude<RequiredInputType, 'none'>;
            if (
              typeof rawInput['value'] !== 'string' ||
              !validateInputFormat(inputType, rawInput['value'])
            ) {
              addError(
                `${iPrefix}.value`,
                'required-input-value-format',
                `${iPrefix}.value must match the ${inputType} format pattern`,
              );
            }
          }
        }
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors, warnings };
  }

  return { valid: true, lesson: raw as unknown as FlightLesson, warnings };
}
