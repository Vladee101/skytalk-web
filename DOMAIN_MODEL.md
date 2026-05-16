# SkyTalk Web — Domain Model

> Read `PROJECT_BRIEF.md` and `ARCHITECTURE.md` first. This document specifies the **shape and rules of the data**.
>
> **Authority:** The Annexes in `docs/v1-source/` are normative. This document translates them into TypeScript-flavored pseudocode for `@skytalk/core`. When this document and an Annex disagree, the Annex wins; please open an issue or notify the project owner so this document can be corrected.
>
> **Source mapping:**
>
> - Section 1 (types) — based on `ANNEX_A_flight_schema.txt`
> - Section 2 (lesson validation) — based on `ANNEX_A` + `ANNEX_D`
> - Section 3 (input validation) — based on `ANNEX_C` only (NOT Operational Rules — see explanation)
> - Section 4 (state machine) — based on `ANNEX_B` (with web-server adaptation noted)
> - Section 5 (role filtering) — web-version-specific, no v1 source
> - Section 6 (event log) — web-version-specific
> - Section 7 (test cases) — drawn from Annex examples

---

## 1. Core types

These types reflect the **actual `flight.json` format produced by the desktop tutor app**, as observed in production files. Where the desktop format differs from Annex A, the desktop format wins — the web version must be able to load real lesson files without modification.

**Key differences from Annex A (idealized spec) vs actual desktop format:**

| Annex A says                            | Desktop tutor actually produces         | Resolution                                |
| --------------------------------------- | --------------------------------------- | ----------------------------------------- |
| `required_input` (singular object)      | `required_inputs` (array, max ~4 items) | Use array — multi-input is a real feature |
| No `{ type: "none" }` needed when empty | Empty array `[]` for no-input steps     | Accept empty array as "no input required" |
| No `input_id` on inputs                 | Each input has `input_id` (UUID)        | Accept and preserve, not required         |
| No `id` on steps                        | Each step has `id` (UUID)               | Accept and preserve, not required         |
| No top-level `id`                       | Document has `id` (UUID)                | Accept, ignore                            |
| `aircraft_type` only                    | Both `aircraft_type` AND `aircraft`     | Accept both, use `aircraft_type`          |
| `difficulty` only                       | Both `difficulty` AND `level`           | Accept both, use `difficulty`             |

````ts
// ============================================================
// FlightLesson — mirrors actual desktop tutor output
// ============================================================

export interface FlightLesson {
  schema_version: "1.0";
  id?: string;                    // top-level UUID, optional (desktop adds it)
  lesson: LessonMetadata;
  steps: Step[];                  // minItems: 1
}

export interface LessonMetadata {
  name: string;
  callsign: string;               // pattern: ^[A-Z0-9]+$
  route: string;                  // pattern: ^[A-Z]{4}-[A-Z]{4}$
  aircraft_type: string;          // primary field
  aircraft?: string;              // legacy alias, ignored at runtime
  difficulty: "beginner" | "intermediate" | "advanced";
  level?: string;                 // legacy alias, ignored at runtime
}

export interface Step {
  step: number;                   // integer, sequential, starts at 1
  id?: string;                    // UUID, optional (desktop adds it)
  phase: FlightPhase;
  atc: string;
  expected_readback: string;
  required_inputs: RequiredInput[]; // ALWAYS present, empty array [] = no input
  notes?: string;
  strictness?: Strictness;
  // Translation fields (used by Flashcards mode, ignored in simulator)
  atc_translation?: string;
  readback_translation?: string;
  atc_translation_ru?: string;
  readback_translation_ru?: string;
  // Internal desktop field, ignored in web
  required_inputs_local?: RequiredInput[];
}

export type FlightPhase =
  | "PREFLIGHT" | "PUSHBACK" | "TAXI" | "LINE-UP" | "TAKEOFF"
  | "CLIMB" | "ENROUTE" | "DESCENT" | "APPROACH" | "LANDING" | "TAXI-IN";

export type Strictness = "standard" | "critical" | "training" | "listen_only";

// ============================================================
// RequiredInput — one typed input field
// Source: Annex C (validation regexes), desktop format (array + input_id)
// ============================================================

export type RequiredInputType =
  | "none"            // kept for Annex A compatibility, but desktop uses empty array instead
  | "com_frequency"
  | "squawk"
  | "heading"
  | "altitude";

export interface RequiredInput {
  type: Exclude<RequiredInputType, "none">; // in the array form, type is never "none"
  value: string;
  input_id?: string;                        // UUID, desktop adds it, web preserves it
}

// Helper: does this step require any typed input?
export function stepExpectsInput(step: Step): boolean {
  return step.required_inputs.length > 0;
}

// Helper: get the Nth required input for a step (0-indexed)
export function getRequiredInput(step: Step, index: number): RequiredInput | null {
  return step.required_inputs[index] ?? null;
}

// ============================================================
// Multi-input steps — how they work
// ============================================================
// A step may have 1–4 required inputs (observed max: 4 in test files).
// The student enters them SEQUENTIALLY, one at a time.
// currentInputIndex in the store tracks which input is active.
// The server state remains INPUT_REQUIRED until ALL inputs are submitted correctly.
// Only after the last input does the state transition to READY_TO_ADVANCE.
//
// Example (step 1 of test file):
//   required_inputs: [
//     { type: "com_frequency", value: "118.00" },
//     { type: "heading",       value: "090"    },
//     { type: "altitude",      value: "30000"  },
//     { type: "squawk",        value: "4721"   },
//   ]
// Student sees input field styled as "COM frequency window", types "118.00", Enter → green flash.
// Field immediately changes style to "heading selector", student types "090", Enter → green flash.
// Continues until all 4 done → state → READY_TO_ADVANCE.

// ============================================================
// LessonRuntime — server-side authoritative session state
// ============================================================

export type LessonState =
  | "IDLE"
  | "LISTENING"
  | "INPUT_REQUIRED"        // step has required_inputs.length > 0, at least one pending
  | "INPUT_NOT_REQUIRED"    // step has required_inputs.length === 0
  | "READY_TO_ADVANCE"
  | "COMPLETED"
  | "ENDED";

export interface LessonRuntime {
  room_id: string;
  current_step_index: number;       // 0-indexed into lesson.steps
  current_input_index: number;      // 0-indexed into current step's required_inputs
  state: LessonState;
  attempt_count: number;            // attempts on current input (not step), diagnostic only
  last_input?: { value: string; correct: boolean; ts: number };
}

```ts
// ============================================================
// FlightLesson — the parsed and validated flight.json file
// Source: Annex A (root schema)
// ============================================================

export interface FlightLesson {
  schema_version: "1.0";          // exact match required, no fallback
  lesson: LessonMetadata;
  steps: Step[];                  // minItems: 1
}

export interface LessonMetadata {
  name: string;                   // required, non-empty, must match filename without .json
  callsign: string;               // pattern: ^[A-Z0-9]+$
  route: string;                  // pattern: ^[A-Z]{4}-[A-Z]{4}$
  aircraft_type: string;          // required, non-empty, free text
  difficulty: "beginner" | "intermediate" | "advanced";  // lowercase enum
}

export interface Step {
  step: number;                   // integer, sequential, starts at 1
  phase: FlightPhase;
  atc: string;                    // required, non-empty
  expected_readback: string;      // required, non-empty
  required_input: RequiredInput;  // REQUIRED FIELD (always present, possibly { type: "none" })
  notes?: string;                 // optional, tutor-only
  strictness?: Strictness;        // optional, NO RUNTIME EFFECT in v1.0 (Annex A note)
}

export type FlightPhase =
  | "PREFLIGHT" | "PUSHBACK" | "TAXI" | "LINE-UP" | "TAKEOFF"
  | "CLIMB" | "ENROUTE" | "DESCENT" | "APPROACH" | "LANDING" | "TAXI-IN";

export type Strictness = "standard" | "critical" | "training" | "listen_only";

// ============================================================
// RequiredInput — discriminated by `type`
// Source: Annex A definitions.required_input + Annex C
// ============================================================

export type RequiredInputType =
  | "none"            // no typed input expected; `value` MUST be absent
  | "com_frequency"   // COM radio frequency
  | "squawk"          // transponder code
  | "heading"         // magnetic heading
  | "altitude";       // altitude in feet

// Discriminated union: `value` is present iff type !== "none"
export type RequiredInput =
  | { type: "none" }
  | { type: "com_frequency"; value: string }
  | { type: "squawk";        value: string }
  | { type: "heading";       value: string }
  | { type: "altitude";      value: string };

// Helper for code that needs to ask "does this step expect input?"
export function expectsInput(ri: RequiredInput): ri is Exclude<RequiredInput, { type: "none" }> {
  return ri.type !== "none";
}

// ============================================================
// LessonRuntime — server-side authoritative session state
// Source: Annex B (mapped from client states to server's authoritative role)
// ============================================================

// These are the SERVER's room states. They mirror the student's client states from Annex B
// (because the server is the source of truth and broadcasts state to both clients).
// One canonical state per room at any time.
export type LessonState =
  | "IDLE"                  // room created, no client has triggered start yet
  | "LISTENING"             // current step active, tutor giving instruction (or about to)
  | "INPUT_REQUIRED"        // tutor has finished transmitting; student must type & submit
  | "INPUT_NOT_REQUIRED"    // tutor has finished transmitting; no input needed; awaiting student's right-arrow
  | "READY_TO_ADVANCE"      // input correct OR student signaled ready (no-input step); tutor approval expected
  | "COMPLETED"             // last step done; student may reset or exit
  | "ENDED";                // explicit exit by either party; room is closed, tokens invalidated

export interface LessonRuntime {
  room_id: string;
  current_step_index: number;     // 0-indexed into lesson.steps; lesson.steps[i].step === i+1
  state: LessonState;
  // Note: Annex B does NOT track attempts. v1 has no 3-strike enforcement in the app.
  // The tutor enforces TE-13 verbally. We track attempts for diagnostics only.
  attempt_count: number;
  last_input?: { value: string; correct: boolean; ts: number };
}
````

### Why `RequiredInput` is a discriminated union

Annex A enforces this structurally via JSON Schema `allOf` + `if`/`then`: when `type === "none"`, `value` must NOT be present; when `type !== "none"`, `value` is required. We mirror this in TypeScript so the type system catches misuse at compile time. Code that accesses `ri.value` won't compile unless it has narrowed `ri.type` first.

### Why `notes` is optional but `required_input` is not

Annex A `step.required` lists: `step, phase, atc, expected_readback, required_input`. `notes` is in `properties` but not in `required`. So in v1, every step **must** have `required_input` (with `{ type: "none" }` for steps that don't need typed input). This is different from how it might intuitively be modeled — the schema is explicit and we follow it.

## 2. Validation: flight.json file

```ts
export type ValidationError = {
  path: string;
  rule: string;
  message: string;
  severity: 'error' | 'warning';
};

export type ValidationResult =
  | { valid: true; lesson: FlightLesson; warnings: ValidationError[] }
  | { valid: false; errors: ValidationError[]; warnings: ValidationError[] };

export function validateFlightJson(raw: unknown): ValidationResult;
```

### Validation strategy

The validator must accept files produced by the **desktop tutor app** without modification. Files will have extra fields (`id`, `input_id`, `required_inputs_local`, `aircraft`, `level`) — these must be accepted silently, not rejected as "additional properties".

The validator does **not** enforce `additionalProperties: false` (unlike Annex A's JSON Schema) because the desktop tutor adds internal fields that don't affect semantics.

### Top-level checks

| Check                      | Severity                        |
| -------------------------- | ------------------------------- |
| Input is a non-null object | error                           |
| `schema_version === "1.0"` | error, halts further validation |
| `lesson` object present    | error                           |
| `steps` is non-empty array | error                           |

### Lesson metadata checks

| Field                     | Rule                                        | Severity |
| ------------------------- | ------------------------------------------- | -------- |
| `name`                    | non-empty string                            | error    |
| `callsign`                | matches `^[A-Z0-9]+$`                       | error    |
| `route`                   | matches `^[A-Z]{4}-[A-Z]{4}$`               | error    |
| `aircraft_type`           | non-empty string                            | error    |
| `difficulty`              | one of `beginner`/`intermediate`/`advanced` | error    |
| `aircraft`, `level`, `id` | if present, accepted silently               | —        |

### Per-step checks

| Check                                                                                                               | Severity       |
| ------------------------------------------------------------------------------------------------------------------- | -------------- |
| `step` is integer, sequential from 1 (`steps[i].step === i + 1`)                                                    | error          |
| `phase` is one of the 11 enum values                                                                                | error          |
| `atc` non-empty string                                                                                              | error          |
| `expected_readback` non-empty string                                                                                | error          |
| `required_inputs` is an array (may be empty)                                                                        | error          |
| Each item in `required_inputs`: `type` is valid enum (excluding `"none"`), `value` present and matches type's regex | error per item |
| `required_inputs.length <= 4` (observed max, sanity cap)                                                            | warning        |
| `id`, `required_inputs_local`, translation fields: accepted silently                                                | —              |

### Empty array = no input required

```ts
// Both of these mean "no typed input needed on this step":
step.required_inputs === []; // desktop tutor produces this
step.required_inputs === undefined; // older files might omit it

// NOT: { type: "none" } — desktop doesn't produce that form
// The validator normalizes: if required_inputs is missing, treat as []
```

### Legacy field normalization

During `validateFlightJson`, before validation, apply these normalizations silently:

```ts
// Normalize legacy "frequency" type → "com_frequency"
// Old tutor-app versions produced { type: "frequency" } before the rename.
// Both are semantically identical; web version only knows "com_frequency".
for (const step of raw.steps) {
  for (const input of step.required_inputs ?? []) {
    if (input.type === 'frequency') input.type = 'com_frequency';
  }
}
```

This normalization happens **before** Zod parsing so the schema never sees the legacy value. A warning is added to the result: `{ severity: "warning", path: "steps[N].required_inputs[M].type", rule: "legacy-frequency-rename", message: "Normalized 'frequency' → 'com_frequency'" }`.

This ensures backwards compatibility with any lesson files created by early tutor-app versions.

- Step with `required_inputs` containing a `com_frequency` but `atc` text doesn't mention a number → warning
- `expected_readback` doesn't end with lesson's callsign → warning (SP-05)

## 3. Validation: required-input values

This is the heart of runtime validation. Source: **Annex C only**. Operational Rules TA-01..TA-04 (trailing zeros, kHz spacing, etc.) are tutor authoring guidance, NOT runtime validation rules.

### 3.1 Why we follow Annex C, not Operational Rules

Operational Rules say "118.7" is invalid (TA-03: must include trailing zero).
Annex C regex `^[1-9][0-9]{2}\.[0-9]{1,3}$` says "118.7" is valid format.

These do not actually conflict because they answer different questions:

- **Annex C answers:** "Does this string have the structural shape of a frequency?" (yes, "118.7" does)
- **Operational Rules answers:** "Is this how a tutor should write a frequency in a lesson, and is this what a student should type in response to a tutor saying '118 decimal seven zero'?" (no — the student should type "118.70" because that's what the tutor wrote in the lesson)

The real enforcement of trailing-zero is **exact-match** between expected and submitted: if the lesson `value` is `"118.70"` and the student types `"118.7"`, both pass Annex C format check, but exact-match fails — student gets red flash. That's the desired behavior. We don't need to bake "trailing zero required" into the format rule.

### 3.2 Format validators

```ts
// Source: Annex C regex column, verbatim.
// Note: "none" is not in this map — it never appears in required_inputs array items.
const FORMAT_PATTERNS: Record<Exclude<RequiredInputType, 'none'>, RegExp> = {
  com_frequency: /^[1-9][0-9]{2}\.[0-9]{1,3}$/,
  squawk: /^[0-7]{4}$/,
  heading: /^[0-9]{3}$/,
  altitude: /^[0-9]+$/,
};

export function validateInputFormat(
  type: Exclude<RequiredInputType, 'none'>,
  value: string,
): boolean {
  return FORMAT_PATTERNS[type].test(value);
}
```

Test cases (from Annex C tables):

| Type            | Valid examples                                  | Invalid examples                                                  |
| --------------- | ----------------------------------------------- | ----------------------------------------------------------------- |
| `com_frequency` | `"118.7"`, `"121.900"`, `"118.70"`, `"118.725"` | `"011.7"` (leading zero), `"118"` (no decimal), `"118,7"` (comma) |
| `squawk`        | `"4721"`, `"1200"`, `"7500"`                    | `"8888"` (8 not octal), `"129"` (3 digits), `"47210"` (5 digits)  |
| `heading`       | `"090"`, `"270"`, `"360"`, `"999"`              | `"90"` (2 digits), `"27"`, `"270°"` (suffix)                      |
| `altitude`      | `"5000"`, `"35000"`, `"0"`                      | `"FL350"`, `"35,000"` (comma), `"5000ft"` (suffix)                |

Note: `heading: "999"` IS valid format-wise per Annex C "no range enforcement". Don't add range checks. v1 trusts the tutor.

### 3.3 Master validator: format + exact-match

```ts
export type InputValidationResult =
  | { correct: true }
  | { correct: false; reason: 'format_invalid' | 'value_mismatch' };

export function validateInput(
  type: Exclude<RequiredInputType, 'none'>,
  expectedValue: string,
  submittedValue: string,
): InputValidationResult {
  if (!validateInputFormat(type, submittedValue)) {
    return { correct: false, reason: 'format_invalid' };
  }
  // Exact-match, case-sensitive, no trimming beyond UI sanitation (Annex C §C.2).
  if (submittedValue !== expectedValue) {
    return { correct: false, reason: 'value_mismatch' };
  }
  return { correct: true };
}
```

This function runs **server-side** on every `submit_input` WebSocket message and is also exported for use in the desktop tutor app (which can validate that lessons it produces have well-formed expected values).

## 4. Lesson state machine

**Authoritative source: Annex B.** Annex B describes student-app state transitions. Our server holds an authoritative version of the same state and broadcasts it to both clients. The tutor UI mirrors this state to know what student is currently doing.

### 4.1 The 6 states (from Annex B §B.1)

| State                | Meaning                                                                                                                                 |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `IDLE`               | Room created, lesson not yet started. Pre-everything.                                                                                   |
| `LISTENING`          | Current step is active. Tutor is (or will be) speaking. Student is listening. Input field disabled.                                     |
| `INPUT_REQUIRED`     | Tutor finished transmission. Step has `required_input.type !== "none"`. Student must type and submit.                                   |
| `INPUT_NOT_REQUIRED` | Tutor finished transmission. Step has `required_input.type === "none"`. No typed input expected.                                        |
| `READY_TO_ADVANCE`   | Either input was correct OR student gave verbal readback for no-input step. Awaiting tutor approval (verbal) and student's right-arrow. |
| `COMPLETED`          | Last step finished.                                                                                                                     |

### 4.2 Trigger sources

Annex B mixes triggers from three sources:

1. **Local key events** (spacebar press/release, Enter, Right Arrow, Esc) — happen on student's keyboard
2. **External events** (tutor finishes speaking) — in v1 desktop, this was implicit/perceptual; **in the web version, this is observable**: the tutor's PTT release (`peer_ptt: { pressed: false, by: "tutor" }`) is the explicit signal
3. **Submit events** (Enter triggering input validation)

Web translation: where Annex B says "external", we use the tutor's PTT release as the trigger. This is more deterministic than v1 and removes the ambiguity Annex B leaves.

### 4.3 Server-side transition table

| Current State                     | Trigger                          | Condition                               | New State                                 | Server emits                                                     |
| --------------------------------- | -------------------------------- | --------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------- |
| `IDLE`                            | tutor: `start_lesson`            | —                                       | `LISTENING`                               | `step_changed{step_index:0}`                                     |
| `LISTENING`                       | student: `ptt(true/false)`       | —                                       | `LISTENING` (stay)                        | `peer_ptt`                                                       |
| `LISTENING`                       | tutor: `ptt(false)`              | step has `required_inputs.length > 0`   | `INPUT_REQUIRED`                          | `state_changed`                                                  |
| `LISTENING`                       | tutor: `ptt(false)`              | step has `required_inputs.length === 0` | `INPUT_NOT_REQUIRED`                      | `state_changed`                                                  |
| `INPUT_REQUIRED`                  | student: `submit_input`          | correct AND more inputs remain          | `INPUT_REQUIRED` (stay)                   | `input_result{correct:true, input_index:N, more_inputs:true}`    |
| `INPUT_REQUIRED`                  | student: `submit_input`          | correct AND last input                  | `READY_TO_ADVANCE`                        | `input_result{correct:true, more_inputs:false}`, `state_changed` |
| `INPUT_REQUIRED`                  | student: `submit_input`          | wrong                                   | `INPUT_REQUIRED` (stay)                   | `input_result{correct:false, input_index:N}`, `attempt_count++`  |
| `INPUT_NOT_REQUIRED`              | student: `right_arrow`           | —                                       | `READY_TO_ADVANCE`                        | `state_changed`                                                  |
| `READY_TO_ADVANCE`                | student: `right_arrow`           | more steps remain                       | `LISTENING` (next step)                   | `step_changed{step_index:N+1}`                                   |
| `READY_TO_ADVANCE`                | student: `right_arrow`           | last step                               | `COMPLETED`                               | `lesson_completed`                                               |
| any (except IDLE/COMPLETED/ENDED) | tutor: `repeat_step`             | —                                       | unchanged                                 | `repeat_signal`                                                  |
| any (except IDLE/COMPLETED/ENDED) | tutor: `skip_step`               | —                                       | next step's initial state, or `COMPLETED` | `step_changed{reason:"skip"}`                                    |
| any (except IDLE/ENDED)           | tutor or student: `reset_lesson` | —                                       | `LISTENING` step 0, input_index 0         | `lesson_reset`, `step_changed{reason:"reset"}`                   |
| any (except ENDED)                | tutor or student: `end_lesson`   | —                                       | `ENDED`                                   | `lesson_ended`                                                   |
| any (except ENDED)                | student: `exit`                  | —                                       | `ENDED`                                   | `lesson_ended{reason:"exit"}`                                    |
| `COMPLETED`                       | student: `right_arrow`           | —                                       | unchanged                                 | (no-op)                                                          |

### Multi-input step progression

When `required_inputs.length > 1`, state stays `INPUT_REQUIRED` across all inputs. The server tracks `current_input_index` alongside `current_step_index`:

```
Step with 4 inputs: [com_frequency, heading, altitude, squawk]

INPUT_REQUIRED (input_index=0) → student submits "118.00" → correct → more_inputs: true
INPUT_REQUIRED (input_index=1) → student submits "090"    → correct → more_inputs: true
INPUT_REQUIRED (input_index=2) → student submits "30000"  → correct → more_inputs: true
INPUT_REQUIRED (input_index=3) → student submits "4721"   → correct → more_inputs: false → READY_TO_ADVANCE
```

On each correct intermediate submission the student's UI immediately changes field style to match the next input type (COM frequency → heading selector → altitude window → squawk box). This happens client-side: the client knows the full `required_inputs` array for the current step (it's in the step snapshot), and uses `input_index` to determine which field to show next.

On wrong submission: `attempt_count` increments, `current_input_index` stays unchanged, student retries the same field.

On `skip_step`: both indices reset, server moves to next step entirely.

### 4.4 Critical rules NOT to lose

#### Rule IF-01: Input field locking (Annex B §B.2)

When student presses spacebar, the input field is **immediately disabled**. When released, it is **re-enabled** (if state allows). This is a **client-side rule**, but the server tracks PTT state because it needs to inform the tutor's UI.

Implementation: this is enforced in the React student page via the PTT hook — input element is `disabled` when local `pttPressed === true`. The server doesn't need to refuse anything; the client UI prevents typing during transmission.

#### Right Arrow authority matrix (Annex B §B.5)

| State                | Right Arrow allowed?                        | If not allowed           |
| -------------------- | ------------------------------------------- | ------------------------ |
| `IDLE`               | No                                          | (no feedback, key dead)  |
| `LISTENING`          | No                                          | red flash on input field |
| `INPUT_REQUIRED`     | No                                          | red flash on input field |
| `INPUT_NOT_REQUIRED` | **Yes** (transitions to `READY_TO_ADVANCE`) | —                        |
| `READY_TO_ADVANCE`   | **Yes** (advances or completes)             | —                        |
| `COMPLETED`          | No                                          | (no feedback)            |

This is enforced server-side: a `right_arrow` message in a state where it's blocked → server responds with `error{code:"invalid_action"}` and the client UI flashes red.

#### No 3-strike rule in v1.0

Annex B explicitly says: on wrong input, state stays `INPUT_REQUIRED`, red flash, input cleared. **No counter, no auto-skip, no app-side enforcement of "max attempts".** Operational Rules TE-13 ("3 attempts then demonstrate") is **tutor procedure**, not app logic.

The web app tracks `attempt_count` for diagnostic display in the tutor's panel ("Student has tried 3 times") but **does not change behavior** based on it. Tutor uses `skip_step` (Right Arrow ×2 in old desktop terminology) when they decide to demonstrate.

### 4.5 Server-side enforcement

The state machine class lives in `@skytalk/core`:

```ts
export type StateMachineEvent =
  | { type: 'start_lesson'; by: 'tutor' }
  | { type: 'ptt'; by: 'tutor' | 'student'; pressed: boolean }
  | { type: 'submit_input'; value: string } // server uses current_input_index to know which input
  | { type: 'right_arrow'; by: 'student' }
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

export class LessonStateMachine {
  constructor(private readonly lesson: FlightLesson) {}
  initial(): LessonRuntime;
  transition(state: LessonRuntime, event: StateMachineEvent): TransitionResult;
}
```

`transition` is **pure**: same input → same output, no mutation of `state` argument.

### 4.6 State persistence

After every successful transition, the server:

1. Writes the new `LessonRuntime` to the `rooms` row
2. Appends an entry to `session_events` (audit log)
3. Broadcasts the emitted events to both clients via WebSocket

If the server restarts, in-memory state is rebuilt by reading the `rooms` row. Reconnecting clients receive a `state_snapshot` with the current state and resume.

## 5. Role-based view filtering

Server-only. Lives in `@skytalk/core` so the same logic governs both REST GET and WebSocket broadcasts.

```ts
export type StepView = {
  step: number;
  phase: FlightPhase;
  required_input: { type: RequiredInputType }; // type only, no value
};

export type StepViewTutor = Step; // full data including answers

export function viewStepForRole<R extends 'tutor' | 'student'>(
  step: Step,
  role: R,
): R extends 'tutor' ? Step : StepView {
  if (role === 'tutor') return step as any;
  return {
    step: step.step,
    phase: step.phase,
    required_input: { type: step.required_input.type },
  } as any;
}
```

The student client must **never** receive `atc`, `expected_readback`, `required_input.value` (when type !== "none"), `notes`, or `strictness`. This is the security boundary: even with DevTools open, a student cannot extract answers from the running app.

The server must always route step data through `viewStepForRole` before sending. There is **one** exception: when the server emits `input_result` to the student, it omits the value; when emitting to the tutor, it includes the submitted value. This is handled in the broadcast layer, not in `viewStepForRole`.

## 6. Event log schema

Every meaningful runtime event is appended to `session_events`. Source: web-version specific.

```ts
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
```

Common payloads:

```ts
// state_changed
{ from: "LISTENING", to: "INPUT_REQUIRED" }

// step_changed
{ from_step_index: 2, to_step_index: 3, reason: "advance" }

// input_submitted
{ step_index: 3, value: "118.70", correct: true, attempt_count: 1 }

// ptt_changed
{ by: "student", pressed: true }

// lesson_ended
{ reason: "by_student" }
```

## 7. Test cases drawn from Annex examples

These are mandatory test cases for `@skytalk/core`. They're transcribed from Annex B and Annex C, so passing them = behavior matches v1 spec.

### 7.1 Format validation (from Annex C tables)

```ts
// com_frequency
expect(validateInputFormat('com_frequency', '118.7')).toBe(true);
expect(validateInputFormat('com_frequency', '121.900')).toBe(true);
expect(validateInputFormat('com_frequency', '118.725')).toBe(true);
expect(validateInputFormat('com_frequency', '011.7')).toBe(false);
expect(validateInputFormat('com_frequency', '118')).toBe(false);
expect(validateInputFormat('com_frequency', '118,7')).toBe(false);

// squawk
expect(validateInputFormat('squawk', '4721')).toBe(true);
expect(validateInputFormat('squawk', '8888')).toBe(false); // 8 not octal
expect(validateInputFormat('squawk', '129')).toBe(false); // 3 digits
expect(validateInputFormat('squawk', '47210')).toBe(false); // 5 digits

// heading
expect(validateInputFormat('heading', '090')).toBe(true);
expect(validateInputFormat('heading', '999')).toBe(true); // no range check (Annex C explicit)
expect(validateInputFormat('heading', '90')).toBe(false);
expect(validateInputFormat('heading', '270°')).toBe(false);

// altitude
expect(validateInputFormat('altitude', '5000')).toBe(true);
expect(validateInputFormat('altitude', '0')).toBe(true);
expect(validateInputFormat('altitude', 'FL350')).toBe(false);
expect(validateInputFormat('altitude', '35,000')).toBe(false);
```

### 7.2 Exact-match enforcement of trailing zero

```ts
// Lesson author wrote "118.70". Student types "118.7". Both are valid format,
// but exact-match fails — this is how trailing-zero discipline is enforced.
expect(validateInput('com_frequency', '118.70', '118.7')).toEqual({
  correct: false,
  reason: 'value_mismatch',
});

// Same value → correct
expect(validateInput('com_frequency', '118.70', '118.70')).toEqual({ correct: true });
```

### 7.3 Format-vs-mismatch ordering

```ts
// Format failure is reported before value mismatch (cheaper check first, clearer error)
expect(validateInput('squawk', '4721', '129')).toEqual({
  correct: false,
  reason: 'format_invalid',
});

// Format passes but value differs
expect(validateInput('squawk', '4721', '4720')).toEqual({
  correct: false,
  reason: 'value_mismatch',
});
```

### 7.4 State machine: full happy path with single input

```ts
// Lesson fixture: use actual JSON format (required_inputs array, not required_input object)
const lesson: FlightLesson = {
  schema_version: '1.0',
  lesson: {
    name: 'test',
    callsign: 'KLM641',
    route: 'KJFK-EHAM',
    aircraft_type: 'B747',
    difficulty: 'beginner',
  },
  steps: [
    {
      step: 1,
      phase: 'TAXI',
      atc: 'contact Tower 118.70',
      expected_readback: '...',
      required_inputs: [{ type: 'com_frequency', value: '118.70' }],
    },
    {
      step: 2,
      phase: 'TAKEOFF',
      atc: 'cleared for takeoff',
      expected_readback: '...',
      required_inputs: [],
    },
  ],
};
const sm = new LessonStateMachine(lesson);
let state = sm.initial();
expect(state.state).toBe('IDLE');
expect(state.current_input_index).toBe(0);

// Tutor starts
state = sm.transition(state, { type: 'start_lesson', by: 'tutor' }).state;
expect(state.state).toBe('LISTENING');

// Tutor speaks (PTT press then release)
state = sm.transition(state, { type: 'ptt', by: 'tutor', pressed: true }).state;
state = sm.transition(state, { type: 'ptt', by: 'tutor', pressed: false }).state;
expect(state.state).toBe('INPUT_REQUIRED');

// Student submits correct value
const r = sm.transition(state, { type: 'submit_input', value: '118.70' });
expect(r.ok).toBe(true);
expect(r.state.state).toBe('READY_TO_ADVANCE');
expect(r.emit).toContainEqual(
  expect.objectContaining({
    type: 'input_result',
    correct: true,
    input_index: 0,
    more_inputs: false,
  }),
);

// Student presses Right Arrow → step 2 (no input)
state = sm.transition(r.state, { type: 'right_arrow', by: 'student' }).state;
expect(state.current_step_index).toBe(1);
expect(state.state).toBe('LISTENING');

// Tutor releases PTT on no-input step
state = sm.transition(state, { type: 'ptt', by: 'tutor', pressed: false }).state;
expect(state.state).toBe('INPUT_NOT_REQUIRED');

// Student Right Arrow → COMPLETED (last step)
state = sm.transition(state, { type: 'right_arrow', by: 'student' }).state;
expect(state.state).toBe('COMPLETED');
```

### 7.10 Multi-input step (from real flight.json — step 1 has 4 inputs)

```ts
const step1: Step = {
  step: 1,
  phase: 'PREFLIGHT',
  atc: '...',
  expected_readback: '...',
  required_inputs: [
    { type: 'com_frequency', value: '118.00' },
    { type: 'heading', value: '090' },
    { type: 'altitude', value: '30000' },
    { type: 'squawk', value: '4721' },
  ],
};
const lesson = { /* schema_version etc */ steps: [step1] };
const sm = new LessonStateMachine(lesson);
let state = sm.initial();

state = sm.transition(state, { type: 'start_lesson', by: 'tutor' }).state;
state = sm.transition(state, { type: 'ptt', by: 'tutor', pressed: false }).state;
expect(state.state).toBe('INPUT_REQUIRED');
expect(state.current_input_index).toBe(0);

// Input 0: correct
let r = sm.transition(state, { type: 'submit_input', value: '118.00' });
expect(r.state.state).toBe('INPUT_REQUIRED'); // still INPUT_REQUIRED
expect(r.state.current_input_index).toBe(1); // moved to next
expect(r.emit).toContainEqual(
  expect.objectContaining({
    type: 'input_result',
    correct: true,
    input_index: 0,
    more_inputs: true,
  }),
);
state = r.state;

// Input 1: wrong first, then correct
r = sm.transition(state, { type: 'submit_input', value: '999' });
expect(r.state.current_input_index).toBe(1); // stays at index 1
expect(r.state.attempt_count).toBe(1);
state = r.state;

r = sm.transition(state, { type: 'submit_input', value: '090' });
expect(r.state.current_input_index).toBe(2);
expect(r.state.attempt_count).toBe(0); // resets on correct
state = r.state;

// Input 2: correct
r = sm.transition(state, { type: 'submit_input', value: '30000' });
expect(r.state.current_input_index).toBe(3);
state = r.state;

// Input 3 (last): correct → READY_TO_ADVANCE
r = sm.transition(state, { type: 'submit_input', value: '4721' });
expect(r.state.state).toBe('READY_TO_ADVANCE');
expect(r.emit).toContainEqual(
  expect.objectContaining({
    type: 'input_result',
    correct: true,
    input_index: 3,
    more_inputs: false,
  }),
);

// Right Arrow → COMPLETED (single-step lesson)
state = sm.transition(r.state, { type: 'right_arrow', by: 'student' }).state;
expect(state.state).toBe('COMPLETED');
```

### 7.5 State machine: error recovery (from Annex B §B.8)

```ts
// Setup: at INPUT_REQUIRED for a step expecting "118.70"
let state = /* INPUT_REQUIRED state */;

// Wrong input
let r = sm.transition(state, { type: "submit_input", value: "118.7" });
expect(r.ok).toBe(true);
expect(r.state.state).toBe("INPUT_REQUIRED");   // stays
expect(r.state.attempt_count).toBe(1);
expect(r.emit).toContainEqual({ type: "input_result", correct: false, attempt_count: 1 });

// Try again, still wrong
state = r.state;
r = sm.transition(state, { type: "submit_input", value: "118.71" });
expect(r.state.state).toBe("INPUT_REQUIRED");
expect(r.state.attempt_count).toBe(2);

// 3rd attempt also wrong → STILL INPUT_REQUIRED, no auto-skip
state = r.state;
r = sm.transition(state, { type: "submit_input", value: "118.72" });
expect(r.state.state).toBe("INPUT_REQUIRED");
expect(r.state.attempt_count).toBe(3);

// 4th attempt allowed, ALSO no auto-skip (v1 has no max attempts in app)
state = r.state;
r = sm.transition(state, { type: "submit_input", value: "118.73" });
expect(r.ok).toBe(true);
expect(r.state.attempt_count).toBe(4);

// Correct on 5th
state = r.state;
r = sm.transition(state, { type: "submit_input", value: "118.70" });
expect(r.state.state).toBe("READY_TO_ADVANCE");
expect(r.state.attempt_count).toBe(5);  // counter doesn't reset until step advances
```

### 7.6 Right Arrow authority matrix (from Annex B §B.5)

```ts
// Student tries to advance from INPUT_REQUIRED → blocked
let state = /* INPUT_REQUIRED */;
let r = sm.transition(state, { type: "right_arrow", by: "student" });
expect(r.ok).toBe(false);
expect(r.error).toBe("invalid_action");

// Student tries from LISTENING → blocked
state = /* LISTENING */;
r = sm.transition(state, { type: "right_arrow", by: "student" });
expect(r.ok).toBe(false);

// Student in INPUT_NOT_REQUIRED → allowed, transitions to READY_TO_ADVANCE
state = /* INPUT_NOT_REQUIRED */;
r = sm.transition(state, { type: "right_arrow", by: "student" });
expect(r.ok).toBe(true);
expect(r.state.state).toBe("READY_TO_ADVANCE");

// Student in READY_TO_ADVANCE on last step → COMPLETED
state = /* READY_TO_ADVANCE on last step */;
r = sm.transition(state, { type: "right_arrow", by: "student" });
expect(r.ok).toBe(true);
expect(r.state.state).toBe("COMPLETED");
```

### 7.7 Tutor PTT release as state trigger (web-specific)

```ts
// Listening state with INPUT-needed step
let state = /* LISTENING, current step expects com_frequency */;
let r = sm.transition(state, { type: "ptt", by: "tutor", pressed: false });
expect(r.ok).toBe(true);
expect(r.state.state).toBe("INPUT_REQUIRED");

// Listening state with no-input step
state = /* LISTENING, current step has required_input.type === "none" */;
r = sm.transition(state, { type: "ptt", by: "tutor", pressed: false });
expect(r.state.state).toBe("INPUT_NOT_REQUIRED");

// Tutor releasing PTT in INPUT_REQUIRED (already past LISTENING) → no state change
state = /* INPUT_REQUIRED */;
r = sm.transition(state, { type: "ptt", by: "tutor", pressed: false });
expect(r.state.state).toBe("INPUT_REQUIRED");  // stays
```

### 7.8 Schema validation error cases (Annex A)

```ts
// Wrong schema_version → halt, no further errors
const r = validateFlightJson({ schema_version: '0.9', lesson: {}, steps: [] });
expect(r.valid).toBe(false);
expect(r.errors).toHaveLength(1);
expect(r.errors[0].rule).toBe('schema_version');

// required_input is REQUIRED on every step (Annex A)
const r2 = validateFlightJson({
  schema_version: '1.0',
  lesson: {
    name: 'x',
    callsign: 'ABC',
    route: 'AAAA-BBBB',
    aircraft_type: 'B747',
    difficulty: 'beginner',
  },
  steps: [
    { step: 1, phase: 'TAXI', atc: 'x', expected_readback: 'y' /* missing required_input */ },
  ],
});
expect(r2.valid).toBe(false);
expect(r2.errors).toContainEqual(
  expect.objectContaining({
    path: 'steps[0].required_input',
    rule: 'required-field',
  }),
);

// type === "none" should NOT have a value field (Annex A allOf)
const r3 = validateFlightJson({
  /* ... step with required_input: { type: "none", value: "x" } */
});
expect(r3.valid).toBe(false);
```

### 7.9 Reset and Exit (web-version additions)

```ts
// Reset from COMPLETED → back to LISTENING at step 0
let state = /* COMPLETED */;
let r = sm.transition(state, { type: "reset_lesson", by: "student" });
expect(r.ok).toBe(true);
expect(r.state.state).toBe("LISTENING");
expect(r.state.current_step_index).toBe(0);
expect(r.state.attempt_count).toBe(0);
expect(r.emit).toContainEqual({ type: "lesson_reset" });
expect(r.emit).toContainEqual({ type: "step_changed", step_index: 0, reason: "reset" });

// Reset from mid-lesson (e.g. INPUT_REQUIRED at step 5) → back to LISTENING step 0
state = /* INPUT_REQUIRED, step 5 */;
r = sm.transition(state, { type: "reset_lesson", by: "tutor" });
expect(r.ok).toBe(true);
expect(r.state.state).toBe("LISTENING");
expect(r.state.current_step_index).toBe(0);
expect(r.state.attempt_count).toBe(0);   // cleared on reset

// Exit from COMPLETED → ENDED
state = /* COMPLETED */;
r = sm.transition(state, { type: "exit", by: "student" });
expect(r.ok).toBe(true);
expect(r.state.state).toBe("ENDED");
expect(r.emit).toContainEqual(expect.objectContaining({ type: "lesson_ended", reason: "exit" }));

// Reset is NOT allowed from IDLE (nothing to reset)
state = /* IDLE */;
r = sm.transition(state, { type: "reset_lesson", by: "student" });
expect(r.ok).toBe(false);
expect(r.error).toBe("invalid_action");

// Reset from ENDED → not allowed (room is closed)
state = /* ENDED */;
r = sm.transition(state, { type: "reset_lesson", by: "student" });
expect(r.ok).toBe(false);
```

## 8. Open questions deliberately deferred (web MVP scope)

- **Multiple acceptable values**: should `required_input.value` ever be a list? **MVP: no, single string, exact match. Future: schema_version bump per Annex C §C.3.**
- **Tutor manual override** of red flash to green: **MVP: no. App enforces exact-match. Tutor can verbally accept "close enough" and use `skip_step` if needed.**
- **Pause/resume mid-lesson**: **MVP: no. State machine doesn't preclude adding it later.**
- **Markdown in `notes`**: **MVP: plain text.**
- **Same student token in two browser tabs**: **MVP: most recently connected wins; older becomes zombie until ping fails.**
- **`strictness` field**: present in schema, **no runtime effect** in v1.0 per Annex A. Future versions may use it to gate stricter validation paths.
