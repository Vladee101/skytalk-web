# SkyTalk Web — Task Breakdown

> Read `PROJECT_BRIEF.md`, `ARCHITECTURE.md`, `DOMAIN_MODEL.md` first.
>
> Each ticket is sized for **one focused AI-agent session** (1–2 hours of work). Each ticket is self-contained: it specifies inputs, outputs, acceptance criteria, and explicit dependencies. Pick one at a time. Do not bundle.
>
> **Ticket size principle:** if a ticket feels like more than 2 hours of focused agent work, break it down further before starting.
>
> **Working with the agent:** at the start of each session, paste this single ticket plus the supporting docs the ticket lists. Don't paste the whole TASKS.md or original v1 source materials unless the ticket explicitly requires them.

## Legend

- **Phase**: groups tickets by the milestone they belong to.
- **Depends on**: tickets that must be completed first.
- **Context to load**: which docs/files to give the agent at session start.
- **Acceptance**: testable conditions for "done".

---

## Phase 0 — Project skeleton (Day 1)

### T-001: Initialize pnpm monorepo

**Goal:** Create the repository structure described in `ARCHITECTURE.md` §9, with all root-level configuration in place from day one. This ticket is the foundation — getting it right prevents an entire class of bugs where agents edit per-package configs but forget root-level ripple effects.

**Depends on:** —

**Context to load:** `ARCHITECTURE.md` §9 (Repository structure), `CLAUDE.md` (entire file — pay special attention to "Monorepo navigation rules")

**Important:** Place all four reference documents (`PROJECT_BRIEF.md`, `ARCHITECTURE.md`, `DOMAIN_MODEL.md`, `TASKS.md`) plus `CLAUDE.md` in the repo root **before** starting any code. They are part of the deliverable.

**Steps:**

**Root level (these are the files agents most often forget):**
1. `pnpm init` at root, set `"name": "skytalk-web"`, `"private": true`
2. Create `pnpm-workspace.yaml` listing `packages/*`
3. Create root `package.json` with:
   - `engines: { node: ">=20", pnpm: ">=9" }`
   - devDependencies (shared across all packages): `typescript`, `vitest`, `@vitest/coverage-v8`, `eslint`, `@typescript-eslint/*`, `prettier`, `eslint-config-prettier`, `eslint-plugin-import`
   - Scripts: `build`, `test`, `test:coverage`, `lint`, `typecheck`, `format`, `format:check` — all using `pnpm -r` to run across workspaces
   - Additional convenience scripts: `dev:server` (filters to server), `dev:web` (filters to web), `clean` (removes all dist/ and node_modules)
4. Create root `tsconfig.base.json` with strict settings (`strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`, `target: "ES2022"`, `module: "ES2022"`, `moduleResolution: "bundler"`)
5. Create root `tsconfig.json` that uses project references to all packages
6. Create root `.eslintrc.cjs` with shared rules
7. Create root `.prettierrc.json`
8. Create `.gitignore`: `node_modules/`, `dist/`, `*.db`, `*.db-journal`, `*.db-wal`, `*.db-shm`, `.env`, `.env.local`, `.deploy.env`, `coverage/`, `.DS_Store`
9. Create `.nvmrc` with `20`
10. Create `.npmrc` at root with `engine-strict=true` and `auto-install-peers=true`
11. Copy reference docs into root: `PROJECT_BRIEF.md`, `ARCHITECTURE.md`, `DOMAIN_MODEL.md`, `TASKS.md`, `CLAUDE.md`
12. Create `README.md` that briefly describes the project and points readers to `CLAUDE.md` and `PROJECT_BRIEF.md`

**Per-package level:**
13. Create `packages/core/`, `packages/server/`, `packages/web/` directories
14. Each gets its own `package.json` with package-specific runtime deps only (none yet, just the structure: name, version, type=module, main, types, scripts)
15. Each gets its own `tsconfig.json` extending `../../tsconfig.base.json` with its own `outDir`, `rootDir`, and `references` to its workspace dependencies
16. Each gets a tiny `README.md` (3-5 lines) describing its purpose and public API surface

**Verification:** Before declaring done, run from repo root:
```bash
pnpm install
pnpm -r build       # may produce nothing if packages are empty, but must not error
pnpm -r typecheck   # must pass
pnpm -r lint        # must pass (zero warnings)
pnpm format:check   # must pass
```

**Acceptance:**
- All commands above succeed without errors or warnings
- Adding a dependency to one package and re-running `pnpm install` from root updates only the relevant `pnpm-lock.yaml` entries
- The repo can be opened in VS Code without TypeScript complaining about missing references
- A new agent reading `CLAUDE.md` would understand the structure within 2 minutes
- All five reference docs (`PROJECT_BRIEF.md`, `ARCHITECTURE.md`, `DOMAIN_MODEL.md`, `TASKS.md`, `CLAUDE.md`) present in repo root

---

### T-002: Set up `@skytalk/core` package skeleton

**Goal:** Empty but importable core package with type stubs.

**Depends on:** T-001

**Context to load:** `DOMAIN_MODEL.md` §1 (Core types)

**Steps:**
1. Add `vitest` as dev dependency in `packages/core`
2. Create `src/types.ts` with all the type/interface definitions from `DOMAIN_MODEL.md` §1 (verbatim — they are the spec)
3. Create stub files: `src/validate-input.ts`, `src/validate-lesson.ts`, `src/state-machine.ts`, `src/index.ts` with `export *` re-exports
4. Write a smoke test in `tests/smoke.test.ts` that just imports from `@skytalk/core` and asserts true
5. Configure `package.json` with `"main": "./dist/index.js"`, `"types": "./dist/index.d.ts"`

**Acceptance:**
- `pnpm --filter @skytalk/core build` produces `dist/`
- `pnpm --filter @skytalk/core test` passes the smoke test
- Importing `FlightLesson`, `Step`, `RequiredInput` types from `@skytalk/core` works in another package

---

## Phase 1 — Domain logic (Days 2–4) — the highest-leverage work

### T-010: Implement input format validators with full test coverage

**Goal:** Implement format validators for the 4 typed input types (`com_frequency`, `squawk`, `heading`, `altitude`) and the master `validateInput` function per `DOMAIN_MODEL.md` §3.

**Depends on:** T-002

**Context to load:** `DOMAIN_MODEL.md` §3 (full), `docs/v1-source/ANNEX_C_input_types.txt`

**Critical clarification:** Format validation follows **Annex C only**. Operational Rules TA-01..TA-04 (trailing zeros, kHz spacing) are tutor authoring guidance, not runtime validation. Read `DOMAIN_MODEL.md §3.1` for the full reasoning. Do NOT enforce trailing-zero rules in `validateInputFormat`. Trailing-zero discipline is enforced via exact-match in `validateInput`.

**Implementation:**
1. Implement `validateInputFormat` exactly per `DOMAIN_MODEL §3.2` — regexes verbatim from Annex C
2. Implement `validateInput` master function per `DOMAIN_MODEL §3.3`
3. Write tests covering every example in `DOMAIN_MODEL §7.1`, `§7.2`, `§7.3`
4. Add property-based tests using `@fast-check/vitest`: assert `validateInput(type, x, x)` returns `correct: true` for all `x` that pass `validateInputFormat`

**Acceptance:**
- All test cases from `DOMAIN_MODEL §7.1–7.3` pass
- Coverage >95% on `validate-input.ts`
- Public API matches `DOMAIN_MODEL §3.3` exactly
- The function names use Annex C terminology: `com_frequency` (not `frequency`), `squawk`, `heading`, `altitude`

---

### T-011: Implement `validateFlightJson`

**Goal:** Validate uploaded JSON files against the v1.0 schema per `DOMAIN_MODEL.md §2`.

**Depends on:** T-010

**Context to load:** `DOMAIN_MODEL.md` §1 (types) + §2 (validation rules), `docs/v1-source/ANNEX_A_flight_schema.txt` (the formal JSON schema), `docs/v1-source/ANNEX_D_tutor_UI.txt` (tighter authoring constraints to apply as warnings)

**Critical points:**
- `required_input` is **always present** on every step (Annex A `step.required` includes it). When no input is needed, the JSON contains `"required_input": { "type": "none" }` — not omission of the field.
- Field names are Annex A's: `aircraft_type` (not `aircraft`), `difficulty` (not `level`), `step` integer (not `id` string).
- Use `RequiredInput` as a discriminated union (per `DOMAIN_MODEL §1`) — TypeScript should refuse code that accesses `.value` without narrowing `.type`.

**Implementation:**
1. Implement function signature from `DOMAIN_MODEL §2`
2. Validate top-level structure including `additionalProperties: false`
3. Validate `schema_version === "1.0"` and halt on mismatch
4. Validate lesson metadata per Annex A patterns + Annex D length limits
5. For each step: validate sequential `step` numbering (`steps[i].step === i + 1`), phase enum, required text fields, `required_input` discriminated union (presence/absence of `value` per `type`)
6. Generate cross-field warnings (per `DOMAIN_MODEL §2.4`) — soft, non-blocking
7. Provide the sample fixture `packages/core/tests/fixtures/valid-jfk-tower.json` based on Operational Rules Scenarios 5.1, 5.2, 5.3 — but using **Annex A field names** (`aircraft_type`, `difficulty`, `step` integer, `required_input.type === "com_frequency"`, etc.)

**Tests required:**
- All cases in `DOMAIN_MODEL §7.8`
- Valid file → `{ valid: true, lesson, warnings: [] }`
- Wrong `schema_version` → single error, no further validation runs
- Step missing `required_input` → error with `path: "steps[N].required_input"`
- Step with `required_input: { type: "none", value: "x" }` → error (value forbidden when type is none)
- Step with `required_input: { type: "com_frequency" }` (no value) → error (value required when type is not none)
- Non-sequential `step` numbers → error
- Each format-violating value (e.g. `value: "118"` for `com_frequency`) → error per Annex C regex

**Acceptance:**
- Valid v1.0 file → `{ valid: true, lesson }` with full type
- Wrong `schema_version` → `valid: false` with single error, no further validation
- Each broken case produces a useful error with `path` and `rule`
- Coverage >90%

---

### T-012: Implement `LessonStateMachine`

**Goal:** Pure-function state machine implementing the 6 states from Annex B per `DOMAIN_MODEL.md §4`.

**Depends on:** T-011

**Context to load:** `DOMAIN_MODEL.md` §4 (full), `docs/v1-source/ANNEX_B_state_machine.txt` (the authoritative source)

**Critical points:**
- Six states: `IDLE`, `LISTENING`, `INPUT_REQUIRED`, `INPUT_NOT_REQUIRED`, `READY_TO_ADVANCE`, `COMPLETED` — exact case from Annex B
- **No 3-strike rule.** Annex B doesn't enforce attempt limits. Wrong input keeps state at `INPUT_REQUIRED` indefinitely. `attempt_count` is a diagnostic field only.
- **Tutor's PTT release is the trigger** that moves `LISTENING → INPUT_REQUIRED` (or `INPUT_NOT_REQUIRED`). The condition checks the current step's `required_input.type`.
- **Right Arrow authority matrix** (Annex B §B.5) is enforced by the machine: only allowed in `INPUT_NOT_REQUIRED` and `READY_TO_ADVANCE`. Other states return `error: "invalid_action"`.

**Implementation:**
1. Implement `LessonStateMachine` class with `initial()` and `transition()` methods per `DOMAIN_MODEL §4.5`
2. State must be **immutable** — `transition` returns a new state object, never mutates input
3. Implement every row of the transition table from `DOMAIN_MODEL §4.3`
4. Tests: every test case in `DOMAIN_MODEL §7.4`, `§7.5`, `§7.6`, `§7.7`, plus exhaustive coverage of disallowed transitions

**Acceptance:**
- All §7.4–7.7 tests pass
- Coverage >95%
- Calling `transition` with same state and event produces same result (pure)
- A complete lesson run goes through `IDLE → LISTENING → ... → COMPLETED` deterministically
- No 3-strike rule exists in code (verify via grep — `attempt_count >= 3` should appear nowhere as a control-flow guard)

---

### T-013: Implement `viewStepForRole`

**Goal:** Role-based filtering of step data per `DOMAIN_MODEL.md` §5.

**Depends on:** T-002

**Context to load:** `DOMAIN_MODEL.md` §5

**Implementation:**
1. Implement `viewStepForRole(step, role)` function
2. Tests: feed a step with all fields, assert tutor view has all fields, student view has only `id`, `phase`, `required_input.type` (no value, no atc, no expected_readback, no notes)
3. Property test: for any valid step, the student view must not contain the strings of `atc`, `expected_readback`, `required_input.value`, or `notes`

**Acceptance:**
- Function exists, exported from `@skytalk/core`
- Tests pass
- The "no leakage" property test passes

---

## Phase 2 — Backend (Days 5–9)

### T-020: Fastify server skeleton with graceful shutdown

**Goal:** A running Fastify server on port 3001 that responds to `/api/health`.

**Depends on:** T-002

**Context to load:** `ARCHITECTURE.md` §3, §11

**Implementation:**
1. Set up `packages/server` with Fastify, pino logger
2. Bootstrap function reads env vars: `PORT` (default 3001), `SKYTALK_TUTOR_PASSWORD` (required), `JWT_SECRET` (required)
3. Implement `/api/health` returning `{ status: "ok", uptime_seconds }`
4. Graceful shutdown on SIGTERM (close server, drain WebSocket connections — empty stub for now)
5. Unit test using Fastify's `inject()` for `/api/health`
6. Provide `.env.example` with placeholder values

**Acceptance:**
- `pnpm --filter @skytalk/server dev` starts the server
- `curl localhost:3001/api/health` returns 200 with expected body
- Server exits cleanly on SIGTERM
- Test passes

---

### T-021: SQLite setup with migrations

**Goal:** Initialize the `rooms` and `session_events` tables on startup.

**Depends on:** T-020

**Context to load:** `ARCHITECTURE.md` §5

**Implementation:**
1. Add `better-sqlite3` dependency
2. `src/db.ts`: opens DB at `process.env.SKYTALK_DB_PATH || './skytalk.db'`, applies WAL mode
3. Migration system: simple — read `src/migrations/*.sql` in order, track applied in a `_migrations` table
4. Migration `001_init.sql` containing the CREATE TABLE statements from `ARCHITECTURE.md §5`
5. Cleanup: function `cleanupExpiredRooms()` that deletes rooms older than 7 days; called once at startup, then every hour via `setInterval`
6. Tests: in-memory SQLite (`:memory:`) for testing schema and cleanup logic

**Acceptance:**
- Server startup creates DB file and tables
- Re-running doesn't duplicate or break
- Cleanup function works on test data
- All operations use parameterized queries (no string concatenation)

---

### T-022: Tutor authentication endpoint

**Goal:** `POST /api/auth/login` per `ARCHITECTURE.md §3`.

**Depends on:** T-020

**Context to load:** `ARCHITECTURE.md` §3, §13

**Implementation:**
1. At server startup, hash `SKYTALK_TUTOR_PASSWORD` with bcrypt (10 rounds), store in memory
2. Endpoint compares submitted password with bcrypt hash (constant-time)
3. On success: issue JWT with claim `{ role: "tutor", iat, exp: iat+3600 }`, return as both body and HTTP-only Secure cookie
4. Rate limiter: 10/min per IP using `@fastify/rate-limit`
5. Tests: correct password → 200 + token; wrong password → 401; rate limit kicks in after 10 attempts

**Acceptance:**
- All tests pass
- Token verifies with `jsonwebtoken.verify` using `JWT_SECRET`
- No timing leak on wrong-vs-right password (bcrypt handles this)
- Cookie has `HttpOnly`, `Secure`, `SameSite=Strict`

---

### T-023: Room creation endpoint

**Goal:** `POST /api/rooms` per `ARCHITECTURE.md §3`.

**Depends on:** T-011, T-021, T-022

**Context to load:** `ARCHITECTURE.md` §3, `DOMAIN_MODEL.md` §1

**Implementation:**
1. Endpoint requires valid tutor JWT (middleware)
2. Accepts multipart upload, max 256 KB
3. Parses uploaded file as JSON, calls `validateFlightJson` from `@skytalk/core`
4. On invalid: 422 with full error array
5. On valid: generates `room_id`, `tutor_token`, `student_token` using `crypto.randomBytes`, inserts row, generates TURN credentials (HMAC), returns response per spec
6. Tests: valid upload → 200; invalid JSON → 400; invalid lesson → 422; no auth → 401

**Acceptance:**
- All tests pass
- Returned URLs work (will fail at WebSocket layer for now, but validate the URL parsing in T-030)
- DB row created with correct fields
- TURN credentials are time-limited (`ttl=86400`)

---

### T-024: Room state GET endpoint

**Goal:** `GET /api/rooms/:room_id?token=...` per `ARCHITECTURE.md §3`.

**Depends on:** T-013, T-023

**Context to load:** `ARCHITECTURE.md` §3, `DOMAIN_MODEL.md` §5

**Implementation:**
1. Endpoint extracts `token` from query string, looks up room
2. If `tutor_token` matches → role tutor; if `student_token` matches → role student; otherwise 401
3. If room expired or ended → 410 Gone
4. Returns role-filtered current step data using `viewStepForRole`
5. Tests: tutor token returns full data; student token returns filtered; bad token 401; expired room 410

**Acceptance:**
- All tests pass
- Student response NEVER contains `atc`, `expected_readback`, `required_input.value`, or `notes`

---

### T-025: WebSocket server bootstrap + room manager

**Goal:** WebSocket endpoint at `/ws/rooms/:room_id?token=...` with in-memory room state.

**Depends on:** T-024

**Context to load:** `ARCHITECTURE.md` §4

**Implementation:**
1. Use `@fastify/websocket` plugin
2. On connection: validate `room_id` + `token` (same logic as T-024); reject if invalid
3. Maintain `RoomManager` class: `Map<room_id, { tutorWs, studentWs, runtime }>`
4. Send `state_snapshot` to new connection immediately
5. Handle disconnect: clean up reference, log event to `session_events`
6. Heartbeat: server sends `ping` every 30s, expects `pong`; close after 2 missed
7. Tests: connect with valid token → receive snapshot; connect with bad token → close 1008; second connection on same role replaces first

**Acceptance:**
- Two clients can connect simultaneously to same room with different role tokens
- `state_snapshot` arrives within 100ms of connection
- Disconnects logged

---

### T-026: WebSocket message handlers

**Goal:** Implement all client → server message types from `ARCHITECTURE.md §4`.

**Depends on:** T-012, T-025

**Context to load:** `ARCHITECTURE.md` §4 (updated for Annex B states), `DOMAIN_MODEL.md` §4

**Implementation:**
1. Schema validation for incoming messages using Zod (reject malformed with `error: "validation_failed"`)
2. Per-message-type handler:
   - `ping` → reply `pong`
   - `ptt` → broadcast `peer_ptt` to other client; if it's a **tutor `ptt(false)` in `LISTENING` state**, also drive state machine transition to `INPUT_REQUIRED` or `INPUT_NOT_REQUIRED` based on current step's `required_input.type`
   - `submit_input` (student only, only in `INPUT_REQUIRED`) → run `LessonStateMachine.transition`, persist, broadcast `input_result` and `state_changed` if applicable
   - `right_arrow` (student only) → server consults state machine; allowed only in `INPUT_NOT_REQUIRED` and `READY_TO_ADVANCE` per Annex B §B.5; otherwise `error: "invalid_action"`
   - `start_lesson` (tutor only, only in `IDLE`) → transition to `LISTENING` step 0
   - `skip_step` (tutor only) → transition + broadcast
   - `repeat_step` (tutor only) → broadcast `repeat_signal`, no state change
   - `reset_lesson` (tutor or student, any state except `IDLE` and `ENDED`) → transition to `LISTENING` step 0, increment `reset_count` in DB, broadcast `lesson_reset` + `step_changed{reason:"reset"}`
   - `exit` (student only) → same as `end_lesson` but `reason: "exit"`, room closed
3. Role enforcement: tutor sending `submit_input` → error `wrong_role`
4. Persist all transitions to DB before broadcasting
5. Tests: simulate full happy-path lesson via WebSocket (Annex B §B.7); simulate error recovery (Annex B §B.8); simulate Right Arrow rejection in non-allowed states; simulate tutor sending student-only message

**Acceptance:**
- All test scenarios pass
- DB rows reflect every transition with the new state names
- Both clients receive identical broadcasts (within milliseconds)
- Right Arrow in `INPUT_REQUIRED` results in `error: "invalid_action"` and no state change

---

### T-027: TURN credential generation endpoint

**Goal:** Generate time-limited TURN credentials embedded in `/api/rooms` response.

**Depends on:** T-023

**Context to load:** `ARCHITECTURE.md` §6 (ICE configuration), coturn `lt-cred-mech` docs

**Implementation:**
1. Function `generateTurnCreds(secret, ttl)` — HMAC-SHA1 based per coturn standard
2. Username = `${unix_timestamp_expiry}:skytalk`
3. Password = `base64(hmac_sha1(secret, username))`
4. Embed in `/api/rooms` response and refresh endpoint `GET /api/rooms/:id/turn-creds` for token-holders
5. Tests: generated creds match coturn's expected format; expired creds detectable

**Acceptance:**
- coturn accepts the generated credentials when configured with the same `static-auth-secret`
- Tests pass

---

## Phase 3 — Frontend (Days 10–14)

### T-030: React + Vite + Tailwind project bootstrap

**Goal:** `packages/web` skeleton with router and a placeholder for each route.

**Depends on:** T-001

**Context to load:** `ARCHITECTURE.md` §8

**Implementation:**
1. `pnpm create vite@latest` template react-ts inside `packages/web`
2. Add Tailwind CSS, configure
3. Add `react-router-dom`, set up routes per `ARCHITECTURE.md §8`
4. Each page renders a placeholder `<h1>` with the route name
5. Vite dev server proxies `/api` and `/ws` to `localhost:3001`, `/peerjs` to `localhost:9000`
6. Add `@skytalk/core` as workspace dependency

**Acceptance:**
- `pnpm --filter @skytalk/web dev` runs on http://localhost:5173
- Each route shows its placeholder
- Importing types from `@skytalk/core` works

---

### T-031: Tutor login page

**Goal:** Landing page with login form that authenticates and redirects to `/tutor`.

**Depends on:** T-022, T-030

**Context to load:** `ARCHITECTURE.md` §3, §8

**Implementation:**
1. Single password field, submit button
2. POST to `/api/auth/login`, on success store JWT in memory (Zustand store) AND rely on HTTP-only cookie for actual auth
3. On error: display message
4. Loading state during request
5. Already-logged-in users skip the form (redirect to `/tutor`)

**Acceptance:**
- Wrong password shows error inline
- Correct password redirects to `/tutor`
- Refresh after login keeps session (cookie)

---

### T-032: Tutor dashboard — room list + create form

**Goal:** Authenticated `/tutor` page showing active rooms and a "Create new" form.

**Depends on:** T-023, T-031

**Context to load:** `ARCHITECTURE.md` §3, §8

**Implementation:**
1. Fetch active rooms (we'll need a `GET /api/rooms` endpoint — add it as a sub-task with the same auth as T-022; lists rooms not yet ended)
2. Display each room: lesson name, student name, created timestamp, expires timestamp, status, link to tutor URL, "Copy student URL" button
3. "Create new room" form: file picker (drag-drop OK) for flight.json, optional student name field
4. On upload: POST to `/api/rooms`, on success redirect to `/tutor/:roomId?token=...`
5. On validation error: show error list inline (use the structured errors from `@skytalk/core`)

**Acceptance:**
- Drag-drop works
- Validation errors displayed clearly with rule references (e.g. "Step 3: missing trailing zero (TA-03)")
- Successful creation navigates to session
- Active rooms refresh on focus

---

### T-033: Shared WebSocket hook

**Goal:** `useWebSocket(roomId, token)` hook used by both tutor and student session pages.

**Depends on:** T-025, T-030

**Context to load:** `ARCHITECTURE.md` §4

**Implementation:**
1. Custom React hook returning `{ state, send, connectionStatus }`
2. Connects to `wss://.../ws/rooms/:roomId?token=:token`
3. Reconnect with exponential backoff up to 30s
4. Maintains client-side counter for `seq`
5. Stores latest `state_snapshot` reactively
6. Stores latest `input_result`, `peer_ptt`, etc. as transient events accessible via callbacks
7. Sends `ping` every 25s

**Acceptance:**
- Hook handles reconnect on transient network failure
- State updates are reactive (component re-renders on new snapshot)
- No memory leaks (proper cleanup on unmount, tested with React StrictMode double-invoke)

---

### T-034: PTT (push-to-talk) hook

**Goal:** `usePTT(send)` hook handling spacebar press/release globally.

**Depends on:** T-033

**Context to load:** `ARCHITECTURE.md` §4 (PTT semantics), `OPERATIONAL_RULES_v1_0.txt` §3.1 (radio discipline rules)

**Implementation:**
1. Listen on `keydown`/`keyup` globally for Space key
2. When pressed AND not already pressed (no auto-repeat): send `{ type: "ptt", pressed: true }` once
3. When released: send `{ type: "ptt", pressed: false }` once
4. Also fire local callback for UI feedback
5. Disable when focus is in a text input (so typing doesn't trigger PTT)
6. Tests with React Testing Library + jsdom keyboard events

**Acceptance:**
- Space in input field doesn't fire PTT
- Holding Space sends only one `pressed: true`
- Release sends `pressed: false`
- Tests pass

---

### T-035: Student session page — cockpit UI

**Goal:** `/student/:roomId?token=...` cockpit-style UI implementing Annex B's state-driven UI.

**Depends on:** T-033, T-034

**Context to load:** `Executive_Summary.txt` §6, `docs/v1-source/ANNEX_B_state_machine.txt` (especially §B.2 Input Field Locking, §B.5 Right Arrow Authority, §B.6 Input Field State Matrix), `Руководство_пользователя.txt` (UI feedback semantics)

**Critical rules to implement:**
- **Rule IF-01** (Annex B §B.2): when spacebar is held, input field is **immediately disabled**. When released, re-enabled if state allows. This applies in ALL states except `IDLE` and `COMPLETED`. Implementation: input element has `disabled={pttPressed || !inputAllowedInState(state)}`.
- **Right Arrow authority matrix** (Annex B §B.5): Right Arrow handler checks state. Only `INPUT_NOT_REQUIRED` and `READY_TO_ADVANCE` send the message to server. In other states, locally flash the input field red without sending anything (cheaper UX feedback than waiting for server reject).
- **Step counter** (Annex B §B.4): bottom status bar shows `Step: X/Y` where X = `current_step_index + 1`.

**Implementation:**
1. Layout: dark cockpit-themed background, callsign/aircraft_type/route bottom-left, required input field bottom-right styled per input type (4 visual variants: `com_frequency` → COM window, `squawk` → squawk box, `heading` → heading selector, `altitude` → altitude window). When `required_input.type === "none"` or state is `INPUT_NOT_REQUIRED`/`READY_TO_ADVANCE`/etc., render input as disabled/grayed-out
2. Input field state machine (mirrors Annex B §B.6):
   - `IDLE`: disabled, no flashing
   - `LISTENING`: disabled
   - `INPUT_REQUIRED`: enabled, blue blink at 1Hz; disabled while spacebar held (Rule IF-01)
   - `INPUT_NOT_REQUIRED`: disabled
   - `READY_TO_ADVANCE`: locked with the green-text correct value (or no value if no-input step)
   - `COMPLETED`: disabled
3. On Enter in `INPUT_REQUIRED`: send `submit_input` with current value; on `input_result.correct === false`, red flash and clear field; on `correct === true`, green flash and lock field
4. Step counter top-right: "Step: X/Y" per Annex B §B.4
5. **Exit button** (Esc или дискретная кнопка top-right): выход на главную страницу. Любое состояние. Confirmation modal перед отправкой `exit`. После `lesson_ended` — редирект на `/ended`.
6. **Reset button** (клавиша R или кнопка рядом с Exit): перезагрузка урока с шага 1. Любое состояние кроме `IDLE` и `ENDED`. Confirmation modal ("Restart from beginning?") перед отправкой `reset_lesson`. После `lesson_reset` — UI возвращается в `LISTENING` шаг 0, все поля очищаются.
7. Right Arrow handler: per authority matrix above
8. Display "Tutor is transmitting" indicator when `peer_ptt.by === "tutor" && pressed`

**Acceptance:**
- Input field locks immediately on spacebar press (Rule IF-01) in any state where it was enabled
- Input field re-enables on spacebar release if state allows
- Right Arrow in `INPUT_REQUIRED` triggers local red flash, no server message sent
- Wrong input → red flash → field clears → can retry (Annex B §B.8 flow)
- Step counter format matches `Step: X/Y` exactly
- All UI states from `Executive_Summary §6` reproduce correctly

---

### T-036: Tutor session page — instructor UI

**Goal:** `/tutor/:roomId?token=...` — two-panel layout matching the desktop tutor screenshot, with live student input status on required input cards.

**Depends on:** T-033, T-034

**Context to load:** `Executive_Summary.txt` §5.2, `ARCHITECTURE.md` §4, `docs/v1-source/ANNEX_D_tutor_UI.txt`

**Layout (matches desktop tutor app):**

Left panel (~60% width):
- Top bar: lesson name, callsign · route · aircraft_type, progress bar, Step X/Y
- Phase badge
- ATC Instruction box (large — this is what tutor speaks aloud)
- Expected Readback box (italic — what student should say verbally)
- Notes (if present, tutor-only)

Right panel (~40% width):
- Required Input Cards grid (see below)
- Navigation: ← prev / Reset / → next (skip)
- Student Status strip: connection indicators, PTT state, attempt count

**Required Input Cards — the central feature of this ticket:**

All cards for the current step are shown simultaneously (max 4). Each card corresponds to `required_inputs[N]` for the current step. Visual state driven by `input_result` WebSocket events:

```
PENDING (awaiting student submission):
  amber/gold border, expected value shown, type label below

ACTIVE (current_input_index === this card's index):
  pulsing amber border — highlights which card student is currently on

CORRECT (received input_result{correct:true, input_index:N}):
  green border + green glow
  Top line: expected value  ✓
  Bottom line: "entered: [what student typed]"
  → tutor can confirm student's pronunciation matched

WRONG (received input_result{correct:false, input_index:N}):
  red border + red glow
  Top line: expected value  ✗
  Bottom line: "entered: [what student typed]"
  → tutor sees exact wrong value to give precise verbal correction
  → e.g. "you typed 118.7, needs trailing zero: one one eight decimal seven ZERO"

NO_INPUT (step has required_inputs === []):
  Single card with text "NO INPUT REQUIRED" in gray
```

Cards reset to PENDING when step changes.

**Student Status strip:**
- "Student: [STATE] (input N/M)" — e.g. "Student: INPUT_REQUIRED (input 2/4)"
- "🔴 TX" indicator when student holds spacebar (peer_ptt)
- "Attempts: N" on current input — shown prominently when ≥3

**Bottom controls:**
- "Start lesson" button (IDLE only, sends `start_lesson`)
- "End lesson" (sends `end_lesson`)
- "Skip step" button + Shift+S shortcut (sends `skip_step`)
- "Reset lesson" (confirmation modal, sends `reset_lesson`, all states except IDLE/ENDED)

**Keyboard:**
- Spacebar → PTT (`usePTT`). Tutor PTT release in LISTENING triggers state transition
- Enter in IDLE → `start_lesson`
- Shift+S → `skip_step`
- Right Arrow → **no-op** (advancement is student-driven per Annex B)

**Note:** tutor does NOT press Right Arrow to advance. Only student can advance. Tutor controls: speak (PTT), skip (demonstrate), reset, end.

**Acceptance:**
- Left/right split layout matches desktop screenshot proportions
- All required input cards visible simultaneously, in order
- Active card (current input_index) has pulsing highlight
- Correct submission: card turns green, shows both expected and entered values
- Wrong submission: card turns red, shows expected AND what student actually typed
- Cards reset on step change
- attempt_count ≥ 3 shows prominently (tutor's cue for TE-13)
- Tutor PTT release correctly triggers LISTENING → INPUT_REQUIRED/NOT_REQUIRED

---

## Phase 4 — Audio (Days 15–17)

### T-040: PeerJS connection hook

**Goal:** `usePeer(roomId, role, turnCreds)` hook that establishes WebRTC audio between tutor and student.

**Depends on:** T-035, T-036, T-027

**Context to load:** `ARCHITECTURE.md` §6

**Implementation:**
1. Init PeerJS with peer ID `${roomId}-${role}` and ICE config from `turnCreds`
2. Tutor side: on `peer.open`, place call to `${roomId}-student` with local audio stream
3. Student side: on `peer.on('call')`, answer with local audio stream
4. Apply `getUserMedia` constraints from `ARCHITECTURE.md §6`
5. Expose: connection status, remote stream ref, mute control, error
6. Cleanup: destroy peer on unmount

**Acceptance:**
- Manual test: open both sessions in two browsers (or two tabs), verify audio flows both ways
- Mute button mutes local audio (peer no longer hears)
- Reconnect works after temporary network drop

---

### T-041: Radio audio engine — outbound processing

**Goal:** `RadioAudioEngine.processOutbound(stream)` returns a transformed stream sounding like VHF.

**Depends on:** T-040

**Context to load:** `ARCHITECTURE.md` §7

**Implementation:**
1. Class `RadioAudioEngine` in `packages/web/src/audio/`
2. `processOutbound(MediaStream): MediaStream` chain: source → highpass 300 → lowpass 3000 → compressor → waveshaper (mild saturation) → MediaStreamDestination
3. Expose `intensity: number` (0–1) controlling compression and saturation depth
4. Visual test page (`/dev/audio-test` route, dev-only): plays a sine sweep through the chain so you can hear the effect

**Acceptance:**
- The dev test page plays processed audio
- At intensity=1.0, voice sounds bandwidth-limited and slightly distorted
- At intensity=0, voice is unaffected (passthrough)
- No audio dropouts, no high CPU usage

---

### T-042: Radio audio engine — inbound static + PTT effects

**Goal:** Mix incoming peer stream with locally generated static and PTT click/squelch sounds.

**Depends on:** T-041

**Context to load:** `ARCHITECTURE.md` §7

**Implementation:**
1. `processInbound(peerStream, options)` → AudioNode connected to destination
2. Static: generate white noise via `AudioBufferSourceNode` (loop), bandpass 500–2500 Hz, gain controlled by intensity
3. Sample assets in `src/audio/samples/`: `click.wav`, `squelch-tail.wav`, `channel-change.wav` (CC0 from freesound.org or generated)
4. Public methods: `playPttClick()`, `playSquelchTail()`, `playChannelChange()`
5. Wire up in session pages: subscribe to `peer_ptt` from WebSocket → call click/tail; subscribe to `step_changed` → call channel change

**Acceptance:**
- Dev test page lets you trigger each effect and hear the difference
- During a real session, hearing the tutor speak is preceded by a click and followed by a squelch tail
- Static is audible but doesn't drown out voice
- Effects volume scales with the intensity slider

---

### T-043: Radio realism settings

**Goal:** User-facing slider in student UI to control radio simulation intensity.

**Depends on:** T-042

**Context to load:** `ARCHITECTURE.md` §7 (last paragraph)

**Implementation:**
1. Settings panel (gear icon top-right of student UI)
2. Slider 0–100, default 60, persisted in localStorage
3. Wires through to `RadioAudioEngine.setIntensity()`
4. Optional: separate sliders for "voice processing" and "static volume"

**Acceptance:**
- Slider visibly affects audio in real time
- Setting persists across page reloads
- Tutor UI also has the slider (for tutor's own monitoring)

---

## Phase 5 — Deployment (Days 18–19)

### T-050: nginx + systemd configuration files

**Goal:** Production config files in `infra/`.

**Depends on:** T-026, T-035, T-036

**Context to load:** `ARCHITECTURE.md` §2, §10

**Implementation:**
1. `infra/nginx/skytalk.conf` — server block per `ARCHITECTURE §2`
2. `infra/systemd/skytalk-server.service` — runs Node server as `skytalk` user, `Restart=always`, `WorkingDirectory=/opt/skytalk/server`, env file `/etc/skytalk/server.env`
3. `infra/systemd/skytalk-peerserver.service` — runs PeerServer
4. `infra/coturn/turnserver.conf` — TURN config with `lt-cred-mech`, `static-auth-secret`, realm = domain
5. `infra/skytalk-cleanup.timer` + `.service` — hourly DB cleanup
6. README in `infra/` explaining what each file does and how to install

**Acceptance:**
- All files present and pass syntax validation (`nginx -t`, `systemd-analyze verify`, etc.)
- README is detailed enough that you could follow it on a fresh VPS

---

### T-051: Deployment script

**Goal:** `infra/deploy.sh` that pushes a build to the VPS and restarts services.

**Depends on:** T-050

**Context to load:** `ARCHITECTURE.md` §10

**Implementation:**
1. Script reads VPS host from `.deploy.env` (gitignored)
2. `pnpm -r build` locally
3. `rsync -av packages/server/dist/ packages/server/node_modules/ skytalk@host:/opt/skytalk/server/`
4. `rsync -av packages/web/dist/ skytalk@host:/var/www/skytalk/`
5. `ssh host 'sudo systemctl restart skytalk-server'`
6. Output: timing for each step

**Acceptance:**
- Idempotent (running twice with no changes does nothing destructive)
- Failure at any step halts the script
- Logs the deployed git commit hash

---

### T-052: First deploy to VPS

**Goal:** SkyTalk live at `https://skytalk.<domain>`.

**Depends on:** T-051

**Context to load:** `ARCHITECTURE.md` §10 (First-time setup)

**Steps:**
1. Upgrade VPS to 2 vCPU / 2 GB (provider control panel)
2. SSH in, follow the README from T-050
3. Set up `skytalk` user, directories, env files
4. Install Node 20, nginx, coturn, certbot
5. Run certbot for `skytalk.<domain>`
6. Run deploy script
7. Manual smoke test: log in as tutor, upload a test flight.json, open student URL in incognito browser, complete one step end-to-end with audio

**Acceptance:**
- All five components running: nginx, skytalk-server, peerserver, coturn, quiz-app (untouched)
- TLS certificate valid
- Health endpoint returns 200 from public internet
- A manual end-to-end lesson works
- `htop` during the lesson shows reasonable resource usage

---

### T-053: Monitoring + backups

**Goal:** Observability per `ARCHITECTURE.md §11–12`.

**Depends on:** T-052

**Context to load:** `ARCHITECTURE.md` §11, §12

**Implementation:**
1. Cron job (or systemd timer) `/usr/local/bin/skytalk-metrics.sh` writing system stats every minute to `/var/log/skytalk/metrics.log`
2. `logrotate` config for `/var/log/skytalk/`
3. UptimeRobot account configured to ping `/api/health` every 5 minutes
4. Daily backup cron: `tar czf /var/backups/skytalk-$(date +%F).tgz /var/lib/skytalk` with 14-day retention
5. Weekly rsync to external storage (Hetzner Storage Box or similar)

**Acceptance:**
- After 1 hour, metrics.log has 60 entries
- Manually trigger backup, verify archive contents
- UptimeRobot shows green
- Email alert fires if you `systemctl stop skytalk-server` for >5 min

---

## Phase 6 — Polish & buffer (Days 20–21)

### T-060: Error pages and edge cases

**Goal:** Handle every "what if" the user might hit.

**Depends on:** T-035, T-036

**Implementation:**
1. `/ended` page with friendly message + "back to home" link
2. Connection lost banner: "Reconnecting..." with auto-retry
3. Token expired: redirect to `/ended` with "session expired" message
4. Microphone denied: clear instructions on how to grant permission
5. WebRTC failed: fallback message "Audio could not connect — check firewall or try a different network"

**Acceptance:**
- Each scenario tested manually
- No console errors anywhere

---

### T-061: Accessibility pass

**Goal:** Keyboard navigation works everywhere; screen readers don't trip.

**Implementation:**
1. All interactive elements have proper roles, labels, focus styles
2. Color contrast checked (cockpit dark UI is the risky one)
3. Page structure has correct landmarks (`<main>`, `<nav>`, etc.)
4. Test with VoiceOver/NVDA on the tutor login + dashboard at minimum

**Acceptance:**
- Lighthouse accessibility score >90
- Keyboard-only operation possible for all flows except actually conducting a lesson (which is keyboard-native by design)

---

### T-062: Documentation

**Goal:** README, runbook, and tutor user guide.

**Implementation:**
1. Top-level `README.md`: what it is, how to develop locally, link to architecture docs
2. `RUNBOOK.md` for operations: common issues, log locations, how to restart, how to roll back
3. Brief tutor guide (1 page) covering the new web flow vs. old desktop flow

**Acceptance:**
- A new developer can clone, install, and run locally following the README
- Operations actions are documented
- Tutor can follow the guide without questions for first session

---

## Suggested working order

A reasonable execution order assuming a single developer working with AI agents:

```
Day 1:        T-001, T-002
Days 2-4:     T-010, T-011, T-012, T-013     ← invest heavily here, this is the foundation
Days 5-9:     T-020 → T-027                  ← backend
Days 10-14:   T-030 → T-036                  ← frontend
Days 15-17:   T-040 → T-043                  ← audio
Days 18-19:   T-050 → T-053                  ← deploy
Days 20-21:   T-060 → T-062 + buffer
```

If a phase runs over budget, the buffer days at the end absorb it. If everything's smooth, T-062 + a real first lesson with a real student lands inside 3 weeks.

## Working with the agent: per-ticket session template

A good prompt to start each ticket:

```
You are working on the SkyTalk project. Read the following documents in order:

1. PROJECT_BRIEF.md   [paste]
2. The relevant supporting doc(s) listed in "Context to load" for this ticket
3. The ticket itself: [paste full ticket]

Before you write any code, summarize back to me:
- What you're going to build
- The exact files you'll create or change
- The acceptance criteria you'll verify

Then wait for my confirmation before writing code.
```

This forced-recap step catches misunderstandings before they become rewrites. It's worth the 30 seconds.
