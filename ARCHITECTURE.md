# SkyTalk Web — Architecture

> Read `PROJECT_BRIEF.md` first. This document specifies **how components communicate**.

---

## 1. System topology

```
                        VPS (Ubuntu 22.04, 2 vCPU, 2 GB RAM)
   ┌────────────────────────────────────────────────────────────────┐
   │                                                                │
   │  nginx :443  (TLS termination, static files, reverse proxy)    │
   │     │                                                          │
   │     ├──► quiz-app :3000     (existing, untouched)              │
   │     │                                                          │
   │     ├──► skytalk-server :3001                                  │
   │     │      ├─ HTTP REST  (room management, flight.json upload) │
   │     │      ├─ WebSocket  (lesson state sync)                   │
   │     │      └─ SQLite     (/var/lib/skytalk/skytalk.db)         │
   │     │                                                          │
   │     ├──► peerserver :9000  (WebRTC signaling for PeerJS)       │
   │     │                                                          │
   │     └──► coturn :3478 (UDP/TCP), :5349 (TLS), 49152-65535/UDP  │
   │              (STUN + TURN relay for NAT traversal)             │
   │                                                                │
   └────────────────────────────────────────────────────────────────┘
                          ▲                       ▲
                          │ HTTPS / WSS           │ HTTPS / WSS
                          │                       │
                   ┌──────┴──────┐         ┌──────┴──────┐
                   │   Tutor     │◄───────►│   Student   │
                   │   browser   │ WebRTC  │   browser   │
                   │             │ (audio) │             │
                   └─────────────┘         └─────────────┘
```

### Data plane separation

Two independent channels per session, with strict responsibilities:

| Channel          | Transport                | Purpose                                                   | Server role                                                  |
| ---------------- | ------------------------ | --------------------------------------------------------- | ------------------------------------------------------------ |
| **Lesson state** | WebSocket (`wss://`)     | Step progression, input validation, PTT events, approvals | Source of truth, validates everything                        |
| **Voice**        | WebRTC (P2P or via TURN) | Tutor↔student audio                                       | Signaling only (PeerServer); media never touches our backend |

This separation is the architecture's most important property. Lesson state cannot get out of sync between clients (server is authoritative). Voice cannot lag behind state (it's P2P, low latency). Failure of one doesn't crash the other.

## 2. nginx routing

Single domain `skytalk.<domain>` for the SkyTalk app. Configuration outline:

```nginx
server {
  listen 443 ssl http2;
  server_name skytalk.<domain>;

  # Static frontend (Vite build output)
  root /var/www/skytalk;
  index index.html;

  # SPA fallback
  location / {
    try_files $uri $uri/ /index.html;
  }

  # API + WebSocket → Node backend
  location /api/ {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
  }

  location /ws/ {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;  # WebSocket connections may be long-lived
  }

  # PeerJS signaling
  location /peerjs/ {
    proxy_pass http://127.0.0.1:9000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
  }
}
```

The existing `quiz.<domain>` (or whatever it's served at) keeps its own server block, untouched.

## 3. REST API

Base path: `/api`. All responses JSON. Authentication via tokens in URL or `Authorization` header where noted.

### `POST /api/auth/login`

Tutor logs in. Body: `{ "password": "<TUTOR_PASSWORD>" }`. Compares against env var `SKYTALK_TUTOR_PASSWORD`. Returns `{ "tutor_session_token": "<jwt>" }`. Token is short-lived (1h), HTTP-only cookie + body.

### `POST /api/rooms`

Tutor creates a new lesson room. Authenticated (tutor session token). Multipart body:

- `flight_json`: file upload (the lesson file)
- `student_name`: string, optional, for display

Server:

1. Reads file content as JSON
2. Calls `validateFlightJson()` from `@skytalk/core` — rejects with 422 + error array if invalid
3. Generates `room_id` (16-char nanoid), `tutor_token` (32-char), `student_token` (32-char)
4. Stores: `{ room_id, flight_json (raw), tutor_token, student_token, current_step: 0, state: 'idle', created_at, expires_at: created_at + 24h }`
5. Returns:

```json
{
  "room_id": "abc123...",
  "tutor_url": "https://skytalk.<domain>/tutor/abc123...?token=<tutor_token>",
  "student_url": "https://skytalk.<domain>/student/abc123...?token=<student_token>",
  "expires_at": "2026-04-28T12:00:00Z"
}
```

### `GET /api/rooms/:room_id?token=<token>`

Either tutor or student fetches current room state. Token determines role (tutor token → returns `expected_readback`, `required_input.value`; student token → omits answers). Used by the SPA on page load to bootstrap the UI before the WebSocket connects.

Response (student view):

```json
{
  "room_id": "abc123",
  "role": "student",
  "lesson": {
    "name": "JFK Tower Basics",
    "callsign": "KLM641",
    "route": "KJFK-EHAM",
    "aircraft_type": "B747-400",
    "difficulty": "beginner"
  },
  "total_steps": 12,
  "current_step_index": 3,
  "state": "INPUT_REQUIRED",
  "attempt_count": 0,
  "current_step_data": {
    "step": 4,
    "phase": "TAXI",
    "required_input": { "type": "com_frequency" }
    // NOTE: no atc, no expected_readback, no required_input.value, no notes, no strictness
    // — student doesn't see answers
  }
}
```

Response (tutor view): includes full step data with `atc`, `expected_readback`, `required_input.value`, `notes`, `strictness`.

### `POST /api/rooms/:room_id/end`

Either party can end the lesson early. Authenticated by token in body. Marks room as `ended`. WebSocket connections receive `lesson_ended` event and close.

### `GET /api/health`

Returns `{ "status": "ok", "uptime_seconds": N }`. Used by UptimeRobot.

## 4. WebSocket protocol

Connection URL: `wss://skytalk.<domain>/ws/rooms/:room_id?token=<token>`.

On connect:

- Server validates token, attaches role (`tutor` | `student`)
- Server sends `state_snapshot` with full current state
- Server registers connection in the room's broadcast list

All messages are JSON with a `type` discriminator and a `seq` (monotonic per-connection counter for dedup).

### Client → Server messages

#### From either role

```ts
// Heartbeat. Server replies with { type: "pong", seq }.
{ type: "ping", seq: number }

// PTT (push-to-talk) state change. Spacebar pressed/released.
// Tutor's ptt(false) is the trigger that moves LISTENING → INPUT_REQUIRED
// or INPUT_NOT_REQUIRED (per Annex B §B.3 + DOMAIN_MODEL §4.3).
{ type: "ptt", seq: number, pressed: boolean }
```

#### From student only

```ts
// Student submitted a value in the required-input field (Enter pressed).
// Only valid in INPUT_REQUIRED state.
{ type: "submit_input", seq: number, value: string }

// Student presses Right Arrow. Allowed only in INPUT_NOT_REQUIRED and READY_TO_ADVANCE
// per Annex B §B.5. Otherwise server responds with error: "invalid_action".
{ type: "right_arrow", seq: number }

// Student exits to home page. Room is closed, tokens invalidated.
// Mirrors desktop "Exit" button. Available in any state.
{ type: "exit", seq: number }

// Student restarts the lesson from step 0. Same flight.json, same room.
// Mirrors desktop "Reset" button (key R in desktop). Available in any state except IDLE.
// Both clients receive lesson_reset and return to LISTENING at step 0.
{ type: "reset_lesson", seq: number }
```

#### From tutor only

```ts
// Tutor explicitly starts the lesson from IDLE.
{ type: "start_lesson", seq: number }

// Tutor explicitly skips the current step. Used after they've decided to demonstrate
// (Operational Rules TE-13 procedure — but enforced verbally, not by app).
{ type: "skip_step", seq: number }

// Tutor signals "I'll repeat the instruction". Sends repeat_signal to student
// (visual cue) but does not change state.
{ type: "repeat_step", seq: number }

// Tutor ends the session. Room is closed.
{ type: "end_lesson", seq: number }

// Tutor restarts the lesson from step 0. Same as student reset_lesson.
// Both clients receive lesson_reset and return to LISTENING at step 0.
{ type: "reset_lesson", seq: number }
```

### Server → Client messages

Broadcast to **both** clients in a room unless noted.

```ts
// Full state on connect or after structural change.
{
  type: "state_snapshot",
  room_id: string,
  current_step_index: number,         // 0-indexed
  current_input_index: number,        // 0-indexed within current step's required_inputs
  total_steps: number,
  state: LessonState,
  current_step_data: StepData,        // role-filtered (see DOMAIN_MODEL §5)
  attempt_count: number,              // attempts on current input, resets per input
  last_input_result: null | { correct: boolean, value?: string }   // value present in tutor view only
}

// State changed within the same step.
{
  type: "state_changed",
  state: LessonState
}

// Step changed (advance, skip, reset, or initial start).
{
  type: "step_changed",
  current_step_index: number,
  current_step_data: StepData,
  reason: "advance" | "skip" | "start" | "reset"
}

// Student submitted one input. Emitted for EVERY submit, correct or not.
// Client uses input_index + more_inputs to update the input field immediately.
// Tutor's card UI uses submitted_value to show "expected: X / entered: Y".
{
  type: "input_result",
  correct: boolean,
  input_index: number,        // which card to update on tutor UI
  more_inputs: boolean,       // true = more inputs remain; false = step done
  submitted_value?: string,   // present in tutor view only — exact string student typed
  attempt_count: number       // attempts on THIS input (resets per input on correct)
}

// PTT state from peer. Each client receives the OTHER party's PTT state.
{
  type: "peer_ptt",
  pressed: boolean,
  by: "tutor" | "student"
}

// PeerJS peer registration handshake (see Section 6).
// Student sends once when their PeerJS peer fires 'open' (registered on PeerServer).
// Server forwards to tutor. Tutor initiates peer.call() only after receiving this.
// This eliminates the race condition where tutor calls before student is registered.
// Client → Server (student only): { type: "peer_ready", seq: number }
// Server → Client (tutor only):   { type: "peer_ready" }
{
  type: "peer_ready"
}

// Tutor signaled "I'll repeat". Visual cue for student, no state change.
{
  type: "repeat_signal"
}

// Lesson reset to step 0. Both clients receive this and return to LISTENING.
// The room stays open, same flight.json, same tokens. Student UI clears all state.
{
  type: "lesson_reset",
  triggered_by: "tutor" | "student"
}

// Lesson finished or ended.
{
  type: "lesson_ended",
  reason: "completed" | "by_tutor" | "by_student" | "exit" | "expired"
}

// Error response to a client message.
{
  type: "error",
  ack_seq: number,
  code: "invalid_action" | "wrong_role" | "wrong_state" | "rate_limited" | "validation_failed",
  message: string
}

// Heartbeat reply.
{ type: "pong", seq: number }
```

### State machine (server-side, per room)

The room state machine is the authoritative server-side translation of **Annex B** (the v1 student-app state machine). Full transition table and rationale lives in `DOMAIN_MODEL.md §4`. Summary:

```
        ┌──────┐
        │ IDLE │ (room created, lesson not started)
        └──┬───┘
           │ tutor: start_lesson
           ▼
        ┌──────────────┐ ◄────────────────────────┐
        │  LISTENING   │ (current step active,    │
        └──────┬───────┘  tutor speaking)         │
               │                                   │
               │ tutor: ptt(false)  (PTT release)  │
               ▼                                   │
       ┌────────────────────────────┐              │
       │ INPUT_REQUIRED             │              │
       │   OR                       │              │
       │ INPUT_NOT_REQUIRED         │              │
       │ (depends on current step)  │              │
       └──────────┬─────────────────┘              │
                  │                                │
       ┌──────────┴───────────┐                    │
       │                      │                    │
       │ INPUT_REQUIRED       │ INPUT_NOT_REQUIRED │
       │   student:           │    student:        │
       │   submit_input       │    right_arrow     │
       │   (correct)          │                    │
       │                      │                    │
       └──────────┬───────────┘                    │
                  ▼                                │
        ┌─────────────────────┐                    │
        │ READY_TO_ADVANCE    │                    │
        └─────────┬───────────┘                    │
                  │ student: right_arrow           │
                  │                                │
        ┌─────────┴───────────┐                    │
        │                     │                    │
   more steps              last step               │
        │                     │                    │
        ▼                     ▼                    │
   (next step) ───────────────┘                    │
        │                                          │
        └──────────────────────────────────────────┘
                  │
                  │ (last step)
                  ▼
              ┌───────────┐
              │ COMPLETED │
              └───────────┘
```

Critical rules from Annex B that the server must enforce:

- **Tutor's PTT release is the trigger** that moves `LISTENING → INPUT_REQUIRED` or `LISTENING → INPUT_NOT_REQUIRED`. This is the explicit signal that replaces v1's "tutor finishes speaking (external)" perceptual cue.
- **Wrong input keeps the state at `INPUT_REQUIRED`**, increments `attempt_count`, but **does not** auto-advance or auto-skip. There is **no 3-strike rule in v1.0**. The tutor decides verbally and uses `skip_step` if demonstrating.
- **Right Arrow is allowed only in `INPUT_NOT_REQUIRED` and `READY_TO_ADVANCE`** (Annex B §B.5). All other states reject it with `error: invalid_action` — the student's UI flashes the input field red.

### Authoritative validation

When the server receives `submit_input`:

1. Verify state is `INPUT_REQUIRED`. If not → `error: invalid_action`.
2. Extract `step.required_input` from the lesson. (Guaranteed to be present and `type !== "none"` since we're in `INPUT_REQUIRED`.)
3. Call `validateInput(step.required_input.type, step.required_input.value, submitted_value)` from `@skytalk/core` (per `DOMAIN_MODEL.md §3`).
4. Correct → state becomes `READY_TO_ADVANCE`, broadcast `input_result { correct: true }`.
5. Wrong → state stays `INPUT_REQUIRED`, increment `attempt_count`, broadcast `input_result { correct: false, attempt_count }`.

The validation function is the **same code** that runs in the desktop tutor app (it's in `@skytalk/core`). This eliminates drift between authoring-time and run-time validation.

## 5. SQLite schema

Single database at `/var/lib/skytalk/skytalk.db`. WAL mode enabled.

```sql
CREATE TABLE rooms (
  room_id           TEXT PRIMARY KEY,           -- nanoid, 16 chars
  tutor_token       TEXT NOT NULL UNIQUE,       -- 32 chars
  student_token     TEXT NOT NULL UNIQUE,       -- 32 chars
  flight_json       TEXT NOT NULL,              -- raw JSON string, validated at insert
  student_name      TEXT,                       -- optional display name

  current_step_index INTEGER NOT NULL DEFAULT 0, -- 0-indexed step number
  current_input_index INTEGER NOT NULL DEFAULT 0, -- 0-indexed within current step's required_inputs
  state             TEXT NOT NULL DEFAULT 'IDLE', -- enum (Annex B + web):
                                                  -- IDLE|LISTENING|INPUT_REQUIRED|INPUT_NOT_REQUIRED|
                                                  -- READY_TO_ADVANCE|COMPLETED|ENDED
  attempt_count     INTEGER NOT NULL DEFAULT 0, -- attempts on current step (diagnostic; no max in v1)
  reset_count       INTEGER NOT NULL DEFAULT 0, -- how many times lesson was reset (audit only)

  created_at        INTEGER NOT NULL,           -- unix epoch ms
  expires_at        INTEGER NOT NULL,           -- unix epoch ms, 24h after creation
  ended_at          INTEGER                     -- unix epoch ms, set when state=ENDED or COMPLETED
);

CREATE INDEX idx_rooms_expires ON rooms(expires_at);
CREATE INDEX idx_rooms_tutor_token ON rooms(tutor_token);
CREATE INDEX idx_rooms_student_token ON rooms(student_token);

-- Audit log of every step transition and input attempt. Useful for debugging
-- and for future "lesson replay" feature. Append-only, never updated.
CREATE TABLE session_events (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id           TEXT NOT NULL REFERENCES rooms(room_id),
  ts                INTEGER NOT NULL,           -- unix epoch ms
  actor             TEXT NOT NULL,              -- 'tutor'|'student'|'server'
  event_type        TEXT NOT NULL,              -- e.g. 'step_advanced', 'input_submitted', 'input_validated'
  payload_json      TEXT                        -- arbitrary event-specific data
);

CREATE INDEX idx_events_room ON session_events(room_id, ts);
```

### Cleanup

Cron job (or systemd timer) every hour:

```sql
DELETE FROM session_events WHERE room_id IN (SELECT room_id FROM rooms WHERE expires_at < ?);
DELETE FROM rooms WHERE expires_at < ?;
```

Where `?` is `now() - 7 days`. So expired rooms hang around for a week (in case student rejoins late or for debugging) before purging.

## 6. WebRTC media layer

### Signaling

PeerServer running on :9000 internally, exposed via nginx at `/peerjs/`. Configuration: minimal — just `path: '/peerjs'`, no extra auth (the room's WebSocket session is the trust anchor; PeerJS IDs are derived from room/role tokens and are unguessable enough for MVP).

### Peer ID convention

```
peerId = `${room_id}-${role}`     // e.g. "abc123-tutor", "abc123-student"
```

This makes it trivial for each side to call the other: tutor calls `${room_id}-student`, student waits for incoming call.

### ICE configuration

```js
const peer = new Peer(peerId, {
  host: 'skytalk.<domain>',
  path: '/peerjs',
  secure: true,
  config: {
    iceServers: [
      { urls: 'stun:skytalk.<domain>:3478' },
      {
        urls: 'turn:skytalk.<domain>:3478',
        username: '<TURN_USER>',
        credential: '<TURN_PASS>',
      },
      {
        urls: 'turns:skytalk.<domain>:5349',
        username: '<TURN_USER>',
        credential: '<TURN_PASS>',
      },
    ],
    iceTransportPolicy: 'all', // try direct first, fall back to relay
  },
});
```

TURN credentials are time-limited (HMAC-based, computed server-side per session) — the `/api/rooms` response includes them along with the room URLs. Don't hardcode static credentials.

### Audio constraints

```js
navigator.mediaDevices.getUserMedia({
  audio: {
    echoCancellation: true, // keep — tutor and student in same room headphones avoid feedback
    noiseSuppression: false, // OFF — we want to allow our radio static through
    autoGainControl: true, // ok
    sampleRate: 16000, // narrowband, classic VHF feel
    channelCount: 1, // mono
  },
  video: false,
});
```

### Call flow

1. Both clients establish WebSocket to backend (lesson channel).
2. In parallel, both initialize PeerJS with `peerId = ${room_id}-${role}`.
3. Tutor's PeerJS `on('open')` → calls `${room_id}-student`.
4. Student's PeerJS `on('call')` → answers with own audio stream.
5. Both sides apply Web Audio API processing to their **outgoing** stream (radio effect): bandpass 300–3000 Hz, compression, light distortion.
6. Both sides mix incoming stream with locally generated static + PTT click/squelch effects (driven by `peer_ptt` events from WebSocket).
7. On lesson end or page close: `peer.destroy()`.

## 7. Audio processing chain (browser-side)

This is the radio-realism layer. Lives in `@skytalk/web` as a `RadioAudioEngine` class.

### Outbound (microphone → peer)

```
mic getUserMedia stream
   ↓
MediaStreamSource
   ↓
BiquadFilter (highpass, 300 Hz)        ┐
   ↓                                    │ "VHF voice band"
BiquadFilter (lowpass, 3000 Hz)        ┘
   ↓
DynamicsCompressor (ratio 4:1)          ─ "AGC + presence"
   ↓
WaveShaper (subtle saturation curve)    ─ "AM-ish edge"
   ↓
MediaStreamDestination → WebRTC send
```

### Inbound (peer audio + local effects → speakers)

```
peer audio stream                      ─┐
   ↓                                    │
MediaStreamSource                       │
                                        │
local static generator (white noise →   │
   bandpass 500–2500 Hz, gain 0.05)    ├─► GainNode → AudioContext.destination
                                        │
PTT click sample (on peer_ptt true)    │
PTT tail sample  (on peer_ptt false)   │
channel-change click (on step_changed) │
                                       ─┘
```

Sample assets (~10 KB total): one short click WAV, one squelch tail WAV, one channel-change WAV. All can be sourced from freesound.org under CC0 or generated synthetically. Static is generated, not loaded.

A user setting (slider in student UI) controls overall radio-realism intensity from 0% (clean voice, no static) to 100% (full simulation). Default 60%.

## 8. Frontend routing

```
/                       → Landing (tutor login form)
/tutor                  → Tutor dashboard: list active rooms, "Create new room" form
/tutor/:roomId          → Tutor session UI (requires ?token=)
/student/:roomId        → Student cockpit UI (requires ?token=)
/ended                  → Generic "lesson has ended" page
```

The tutor dashboard at `/tutor` requires a valid tutor session JWT (set by `/api/auth/login`). The session URLs (`/tutor/:roomId?token=...`, `/student/:roomId?token=...`) authenticate by URL token alone — anyone with the link gets in. This is the magic-link model.

## 9. Repository structure

```
skytalk-web/
├── PROJECT_BRIEF.md
├── ARCHITECTURE.md
├── DOMAIN_MODEL.md
├── TASKS.md
├── package.json                    # pnpm workspace root
├── pnpm-workspace.yaml
├── packages/
│   ├── core/                       # @skytalk/core — shared domain logic
│   │   ├── src/
│   │   │   ├── types.ts            # FlightLesson, Step, RequiredInput, ...
│   │   │   ├── validate-lesson.ts  # validateFlightJson()
│   │   │   ├── validate-input.ts   # validateInput() — TA-01..TA-10 rules
│   │   │   ├── state-machine.ts    # LessonStateMachine class
│   │   │   └── index.ts
│   │   ├── tests/
│   │   └── package.json
│   │
│   ├── server/                     # @skytalk/server — Fastify backend
│   │   ├── src/
│   │   │   ├── server.ts           # Fastify bootstrap
│   │   │   ├── auth.ts             # tutor login, JWT
│   │   │   ├── routes/
│   │   │   │   ├── rooms.ts        # POST/GET/DELETE /api/rooms
│   │   │   │   ├── auth.ts
│   │   │   │   └── health.ts
│   │   │   ├── ws/
│   │   │   │   ├── server.ts       # WebSocket setup
│   │   │   │   ├── room-manager.ts # in-memory room state, broadcast
│   │   │   │   └── handlers.ts     # message handlers per type
│   │   │   ├── db.ts               # better-sqlite3 setup, migrations
│   │   │   └── turn-creds.ts       # HMAC-based TURN credential generation
│   │   ├── tests/
│   │   └── package.json
│   │
│   └── web/                        # @skytalk/web — React SPA
│       ├── src/
│       │   ├── main.tsx
│       │   ├── App.tsx             # router
│       │   ├── pages/
│       │   │   ├── Landing.tsx
│       │   │   ├── TutorDashboard.tsx
│       │   │   ├── TutorSession.tsx
│       │   │   └── StudentSession.tsx
│       │   ├── components/         # reusable UI bits
│       │   ├── hooks/
│       │   │   ├── useWebSocket.ts
│       │   │   ├── usePeer.ts
│       │   │   └── usePTT.ts
│       │   ├── audio/
│       │   │   ├── RadioAudioEngine.ts
│       │   │   └── samples/        # click.wav, squelch.wav, channel-change.wav
│       │   └── styles/
│       ├── public/
│       ├── index.html
│       └── package.json
│
└── infra/
    ├── nginx/skytalk.conf          # nginx server block
    ├── systemd/
    │   ├── skytalk-server.service
    │   └── skytalk-peerserver.service
    ├── coturn/turnserver.conf
    ├── deploy.sh                   # build clean HEAD, ship archive over one SSH session
    └── remote-deploy.sh            # runs on the VPS: backup, swap, restart, health check, rollback
```

## 10. Deployment flow

### First-time setup (one evening)

1. Point DNS A-record `skytalk.<domain>` → VPS IP.
2. SSH in, `apt install nginx coturn certbot python3-certbot-nginx`. Install Node 20 via NodeSource.
3. Configure coturn (see `infra/coturn/turnserver.conf`), open UDP ports 3478, 5349, 49152–65535.
4. Create user `skytalk`, directories `/var/lib/skytalk`, `/var/www/skytalk`, `/var/log/skytalk`.
5. Copy systemd units, `systemctl enable --now skytalk-server skytalk-peerserver`.
6. Run certbot for `skytalk.<domain>` — certbot edits the existing nginx config block.
7. Verify: `curl https://skytalk.<domain>/api/health` returns 200.

### Ongoing deploys

```bash
# On dev machine (Git Bash on Windows works — no rsync needed)
./infra/deploy.sh [--web-only] [user@host]
# deploy.sh:
#   build committed HEAD in a temporary git worktree (uncommitted changes never ship)
#   tar server dist + web dist + infra/remote-deploy.sh, pipe it into one `ssh` session
# remote-deploy.sh (on the VPS):
#   backup → /opt/skytalk/backup-<ts> (newest 5 kept)
#   web dist → /var/www/skytalk, server dist → /opt/skytalk/server/dist
#   systemctl restart skytalk-server, health check, automatic rollback of the server on failure
```

Server `node_modules` are not shipped (pnpm's are platform-specific symlinks). If the server's
runtime dependencies change, the deploy stops before touching anything; install them on the VPS
and re-run with `--deps-installed`.

No CI/CD for MVP. Manual deploy from local. Add GitHub Actions later if pace warrants it.

## 11. Observability

Minimum viable monitoring:

- **systemd journals:** `journalctl -u skytalk-server -f` for live debugging.
- **Application logs:** structured JSON to stdout (Fastify default), captured by journald, rotated automatically.
- **Health endpoint:** `/api/health`. UptimeRobot pings every 5 minutes from outside.
- **Metrics file:** a 1-minute cron writes `vmstat`, `free`, `ss -s` summary to `/var/log/skytalk/metrics.log`. Append-only, rotated weekly. This is poor man's monitoring but covers the "is it dying?" question without standing up Prometheus.
- **TURN bandwidth:** coturn logs to `/var/log/turnserver/`. Useful to see how often relay kicks in.

Add proper metrics (Prometheus + Grafana, or hosted like Better Stack) only when running cost of debugging without them exceeds the cost of setup.

## 12. Backups

- Hourly: `litestream` replicates SQLite to local secondary file. (Optional for MVP but cheap.)
- Daily 02:00: cron `tar czf /var/backups/skytalk-$(date +%F).tgz /var/lib/skytalk`. Keeps last 14 days locally.
- Weekly: rsync `/var/backups/` to external storage (Hetzner Storage Box, Backblaze B2, whatever's cheap). Keeps last 8 weeks.

## 13. Security notes for MVP

- Tutor password: env var, bcrypt-hashed at startup, **never** logged.
- Tokens (room, tutor session): generated with `crypto.randomBytes(16).toString('hex')`. 128 bits of entropy, fine.
- TLS: enforced everywhere. HSTS header. No HTTP serving except certbot's challenge.
- CORS: locked to `https://skytalk.<domain>`. No wildcards.
- Rate limit: 10 req/sec per IP on `/api/auth/login` (Fastify rate limiter), 100 msg/sec per WebSocket connection.
- Input size limits: flight.json upload max 256 KB. Any single WebSocket message max 4 KB.
- No user content in flight.json files is rendered as HTML on the client. All text goes through React's default escaping.
- TURN `lt-cred-mech` enabled with rotating credentials per session. Prevents random internet from using your TURN server as a proxy.
- Quiz app data on the same VPS is **untouched**: separate user, separate directories, separate systemd unit.

## 14. What this architecture does NOT cover

These are real concerns but not in MVP scope. Listed so you don't accidentally design them away:

- Recording / playback of past sessions (would require capturing WebRTC streams server-side or client-side recording; significant work)
- Multi-tutor: would require user accounts, role table, tutor-room ownership
- Multi-student concurrent: room-manager already handles independent rooms in memory; the limit is VPS resources, not architecture
- Lesson authoring in web: would re-implement what desktop tutor app already does; intentionally deferred
- Mobile responsive UI: cockpit metaphor doesn't translate well; deferred
- i18n framework: text strings hardcoded EN+RU per page where needed; if more languages emerge, retrofit i18next
