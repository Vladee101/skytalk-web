import { describe, expect, it } from 'vitest';

import { validateFlightJson } from '../src/validate-lesson';

// Inline fixture matching packages/core/tests/fixtures/valid-jfk-tower.json
const VALID_FIXTURE = {
  schema_version: '1.0',
  id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  lesson: {
    name: 'JFK Tower Departure',
    callsign: 'KLM642',
    route: 'KJFK-EHAM',
    aircraft_type: 'B777',
    aircraft: 'Boeing 777',
    difficulty: 'beginner',
    level: '1',
  },
  steps: [
    {
      step: 1,
      id: 'step-001',
      phase: 'TAXI',
      atc: 'KLM642, ground, taxi to runway 31L via taxiway Bravo, squawk 4721',
      expected_readback: 'Taxi runway 31L via Bravo, squawk 4721, KLM642',
      required_inputs: [{ type: 'squawk', value: '4721', input_id: 'input-001' }],
    },
    {
      step: 2,
      id: 'step-002',
      phase: 'LINE-UP',
      atc: 'KLM642, Tower, runway 31L, line up and wait',
      expected_readback: 'Runway 31L, line up and wait, KLM642',
      required_inputs: [],
    },
    {
      step: 3,
      id: 'step-003',
      phase: 'TAKEOFF',
      atc: 'KLM642, runway 31L, cleared for takeoff, wind 290 at 12, contact Departure 118.70',
      expected_readback: 'Cleared for takeoff runway 31L, KLM642',
      required_inputs: [{ type: 'com_frequency', value: '118.70', input_id: 'input-003' }],
      required_inputs_local: [],
      atc_translation: 'KLM642, полоса 31L, разрешен взлет',
      readback_translation: 'Разрешен взлет полоса 31L, KLM642',
    },
  ],
};

function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

// ============================================================
// §7.8 — valid round-trip
// ============================================================

describe('validateFlightJson — valid round-trip', () => {
  it('accepts a well-formed lesson and returns valid: true with no warnings', () => {
    const result = validateFlightJson(deepClone(VALID_FIXTURE));
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.warnings).toEqual([]);
      expect(result.lesson.lesson.name).toBe('JFK Tower Departure');
      expect(result.lesson.steps).toHaveLength(3);
    }
  });

  it('returns the normalized lesson object with correct types', () => {
    const result = validateFlightJson(deepClone(VALID_FIXTURE));
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.lesson.schema_version).toBe('1.0');
      expect(result.lesson.lesson.difficulty).toBe('beginner');
      expect(result.lesson.steps[0]?.required_inputs[0]?.type).toBe('squawk');
      expect(result.lesson.steps[2]?.required_inputs[0]?.type).toBe('com_frequency');
    }
  });

  it('accepts extra desktop fields (id, aircraft, level, required_inputs_local) silently', () => {
    const result = validateFlightJson(deepClone(VALID_FIXTURE));
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.warnings).toEqual([]);
    }
  });
});

// ============================================================
// Root structure
// ============================================================

describe('validateFlightJson — root structure', () => {
  it('rejects null', () => {
    const result = validateFlightJson(null);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0]?.rule).toBe('root-must-be-object');
    }
  });

  it('rejects a string', () => {
    const result = validateFlightJson('{}');
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0]?.rule).toBe('root-must-be-object');
    }
  });

  it('rejects an array', () => {
    const result = validateFlightJson([]);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0]?.rule).toBe('root-must-be-object');
    }
  });
});

// ============================================================
// schema_version
// ============================================================

describe('validateFlightJson — schema_version', () => {
  it('halts early on wrong schema_version and reports exactly one error', () => {
    const result = validateFlightJson({ ...deepClone(VALID_FIXTURE), schema_version: '2.0' });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.rule).toBe('schema-version');
      expect(result.errors[0]?.path).toBe('schema_version');
    }
  });

  it('halts early on missing schema_version', () => {
    const raw = deepClone(VALID_FIXTURE) as Record<string, unknown>;
    delete raw['schema_version'];
    const result = validateFlightJson(raw);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0]?.rule).toBe('schema-version');
    }
  });
});

// ============================================================
// Lesson metadata
// ============================================================

describe('validateFlightJson — lesson metadata', () => {
  it('rejects missing lesson', () => {
    const raw = deepClone(VALID_FIXTURE) as Record<string, unknown>;
    delete raw['lesson'];
    const result = validateFlightJson(raw);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      const paths = result.errors.map((e) => e.path);
      expect(paths).toContain('lesson');
    }
  });

  it('rejects empty lesson.name', () => {
    const raw = deepClone(VALID_FIXTURE);
    raw.lesson.name = '';
    const result = validateFlightJson(raw);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.path === 'lesson.name')).toBe(true);
    }
  });

  it('rejects non-string lesson.name', () => {
    const raw = deepClone(VALID_FIXTURE) as Record<string, unknown>;
    (raw['lesson'] as Record<string, unknown>)['name'] = 42;
    const result = validateFlightJson(raw);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.rule === 'lesson-name-required')).toBe(true);
    }
  });

  it('rejects callsign with lowercase letters', () => {
    const raw = deepClone(VALID_FIXTURE);
    raw.lesson.callsign = 'klm642';
    const result = validateFlightJson(raw);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.rule === 'lesson-callsign-format')).toBe(true);
    }
  });

  it('rejects callsign with special characters', () => {
    const raw = deepClone(VALID_FIXTURE);
    raw.lesson.callsign = 'KLM-642';
    const result = validateFlightJson(raw);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.rule === 'lesson-callsign-format')).toBe(true);
    }
  });

  it('rejects route with wrong format (3-letter ICAO)', () => {
    const raw = deepClone(VALID_FIXTURE);
    raw.lesson.route = 'JFK-EHA';
    const result = validateFlightJson(raw);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.rule === 'lesson-route-format')).toBe(true);
    }
  });

  it('rejects route with lowercase letters', () => {
    const raw = deepClone(VALID_FIXTURE);
    raw.lesson.route = 'kjfk-EHAM';
    const result = validateFlightJson(raw);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.rule === 'lesson-route-format')).toBe(true);
    }
  });

  it('rejects empty aircraft_type', () => {
    const raw = deepClone(VALID_FIXTURE);
    raw.lesson.aircraft_type = '';
    const result = validateFlightJson(raw);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.rule === 'lesson-aircraft-type-required')).toBe(true);
    }
  });

  it('rejects invalid difficulty', () => {
    const raw = deepClone(VALID_FIXTURE) as Record<string, unknown>;
    (raw['lesson'] as Record<string, unknown>)['difficulty'] = 'expert';
    const result = validateFlightJson(raw);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.rule === 'lesson-difficulty-enum')).toBe(true);
    }
  });

  it.each(['beginner', 'intermediate', 'advanced'] as const)(
    'accepts difficulty "%s"',
    (difficulty) => {
      const raw = deepClone(VALID_FIXTURE) as Record<string, unknown>;
      (raw['lesson'] as Record<string, unknown>)['difficulty'] = difficulty;
      const result = validateFlightJson(raw);
      expect(result.valid).toBe(true);
    },
  );
});

// ============================================================
// Steps
// ============================================================

describe('validateFlightJson — steps', () => {
  it('rejects empty steps array', () => {
    const raw = deepClone(VALID_FIXTURE) as Record<string, unknown>;
    raw['steps'] = [];
    const result = validateFlightJson(raw);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.rule === 'steps-non-empty-array')).toBe(true);
    }
  });

  it('rejects missing steps', () => {
    const raw = deepClone(VALID_FIXTURE) as Record<string, unknown>;
    delete raw['steps'];
    const result = validateFlightJson(raw);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.rule === 'steps-non-empty-array')).toBe(true);
    }
  });

  it('rejects step with wrong sequential number', () => {
    const raw = deepClone(VALID_FIXTURE);
    (raw.steps[1] as Record<string, unknown>)['step'] = 99;
    const result = validateFlightJson(raw);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.rule === 'step-sequential')).toBe(true);
    }
  });

  it('rejects invalid phase', () => {
    const raw = deepClone(VALID_FIXTURE);
    (raw.steps[0] as Record<string, unknown>)['phase'] = 'CRUISE';
    const result = validateFlightJson(raw);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.rule === 'step-phase-enum')).toBe(true);
    }
  });

  it.each([
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
  ])('accepts phase "%s"', (phase) => {
    const raw = deepClone(VALID_FIXTURE);
    (raw.steps[0] as Record<string, unknown>)['phase'] = phase;
    const result = validateFlightJson(raw);
    expect(result.valid).toBe(true);
  });

  it('rejects empty atc string', () => {
    const raw = deepClone(VALID_FIXTURE);
    (raw.steps[0] as Record<string, unknown>)['atc'] = '';
    const result = validateFlightJson(raw);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.rule === 'step-atc-required')).toBe(true);
    }
  });

  it('rejects empty expected_readback string', () => {
    const raw = deepClone(VALID_FIXTURE);
    (raw.steps[0] as Record<string, unknown>)['expected_readback'] = '';
    const result = validateFlightJson(raw);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.rule === 'step-readback-required')).toBe(true);
    }
  });

  it('normalizes missing required_inputs to [] and returns valid', () => {
    const raw = deepClone(VALID_FIXTURE);
    delete (raw.steps[1] as Record<string, unknown>)['required_inputs'];
    const result = validateFlightJson(raw);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.lesson.steps[1]?.required_inputs).toEqual([]);
    }
  });

  it('rejects required_inputs that is not an array', () => {
    const raw = deepClone(VALID_FIXTURE);
    (raw.steps[0] as Record<string, unknown>)['required_inputs'] = 'squawk:4721';
    const result = validateFlightJson(raw);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.rule === 'required-inputs-array')).toBe(true);
    }
  });

  it('produces a warning when required_inputs.length > 4', () => {
    const raw = deepClone(VALID_FIXTURE);
    (raw.steps[0] as Record<string, unknown>)['required_inputs'] = [
      { type: 'squawk', value: '4721' },
      { type: 'heading', value: '090' },
      { type: 'altitude', value: '5000' },
      { type: 'com_frequency', value: '118.700' },
      { type: 'squawk', value: '1200' },
    ];
    const result = validateFlightJson(raw);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.warnings.some((w) => w.rule === 'required-inputs-count-sanity')).toBe(true);
    }
  });

  it('rejects invalid required_input type', () => {
    const raw = deepClone(VALID_FIXTURE);
    (raw.steps[0] as Record<string, unknown>)['required_inputs'] = [
      { type: 'transponder', value: '4721' },
    ];
    const result = validateFlightJson(raw);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.rule === 'required-input-type-enum')).toBe(true);
    }
  });

  it('rejects "none" as required_input type (only valid outside the array)', () => {
    const raw = deepClone(VALID_FIXTURE);
    (raw.steps[0] as Record<string, unknown>)['required_inputs'] = [
      { type: 'none', value: '' },
    ];
    const result = validateFlightJson(raw);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.rule === 'required-input-type-enum')).toBe(true);
    }
  });

  it('rejects required_input value that fails format check (squawk with digit 8)', () => {
    const raw = deepClone(VALID_FIXTURE);
    (raw.steps[0] as Record<string, unknown>)['required_inputs'] = [
      { type: 'squawk', value: '8888' },
    ];
    const result = validateFlightJson(raw);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.rule === 'required-input-value-format')).toBe(true);
    }
  });

  it('rejects required_input value that fails format check (com_frequency missing decimal)', () => {
    const raw = deepClone(VALID_FIXTURE);
    (raw.steps[2] as Record<string, unknown>)['required_inputs'] = [
      { type: 'com_frequency', value: '118' },
    ];
    const result = validateFlightJson(raw);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.rule === 'required-input-value-format')).toBe(true);
    }
  });

  it('reports path correctly for nested required_input error', () => {
    const raw = deepClone(VALID_FIXTURE);
    (raw.steps[0] as Record<string, unknown>)['required_inputs'] = [
      { type: 'squawk', value: '8888' },
    ];
    const result = validateFlightJson(raw);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      const e = result.errors.find((e) => e.rule === 'required-input-value-format');
      expect(e?.path).toBe('steps[0].required_inputs[0].value');
    }
  });
});

// ============================================================
// Legacy normalization
// ============================================================

describe('validateFlightJson — legacy normalization', () => {
  it('renames frequency → com_frequency and adds a warning', () => {
    const raw = deepClone(VALID_FIXTURE);
    (raw.steps[2] as Record<string, unknown>)['required_inputs'] = [
      { type: 'frequency', value: '118.70' },
    ];
    const result = validateFlightJson(raw);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.warnings.some((w) => w.rule === 'legacy-frequency-rename')).toBe(true);
      expect(result.lesson.steps[2]?.required_inputs[0]?.type).toBe('com_frequency');
    }
  });

  it('records the correct path for the frequency rename warning', () => {
    const raw = deepClone(VALID_FIXTURE);
    (raw.steps[0] as Record<string, unknown>)['required_inputs'] = [
      { type: 'frequency', value: '4721' },
    ];
    const result = validateFlightJson(raw);
    // value '4721' fails com_frequency format — renaming succeeds but value check fails
    expect(result.valid).toBe(false);
    if (!result.valid) {
      const w = result.warnings.find((w) => w.rule === 'legacy-frequency-rename');
      expect(w?.path).toBe('steps[0].required_inputs[0].type');
    }
  });

  it('frequency rename + valid com_frequency value → valid with warning only', () => {
    const raw = deepClone(VALID_FIXTURE);
    (raw.steps[0] as Record<string, unknown>)['required_inputs'] = [
      { type: 'frequency', value: '121.900' },
    ];
    const result = validateFlightJson(raw);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]?.rule).toBe('legacy-frequency-rename');
    }
  });

  it('accumulates warnings from multiple frequency renames', () => {
    const raw = deepClone(VALID_FIXTURE);
    (raw.steps[0] as Record<string, unknown>)['required_inputs'] = [
      { type: 'frequency', value: '118.700' },
      { type: 'frequency', value: '121.900' },
    ];
    const result = validateFlightJson(raw);
    expect(result.valid).toBe(true);
    if (result.valid) {
      const renames = result.warnings.filter((w) => w.rule === 'legacy-frequency-rename');
      expect(renames).toHaveLength(2);
    }
  });
});

// ============================================================
// Multiple errors accumulate
// ============================================================

describe('validateFlightJson — error accumulation', () => {
  it('reports errors from both lesson metadata and steps in a single result', () => {
    const raw = deepClone(VALID_FIXTURE);
    raw.lesson.name = '';
    raw.lesson.callsign = 'klm642';
    (raw.steps[0] as Record<string, unknown>)['phase'] = 'CRUISE';
    const result = validateFlightJson(raw);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.length).toBeGreaterThanOrEqual(3);
    }
  });
});
