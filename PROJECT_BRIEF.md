# SkyTalk Web — Project Brief

> **Read this first.** Everything else (`ARCHITECTURE.md`, `DOMAIN_MODEL.md`, `TASKS.md`) assumes you've internalized this document.

---

## What we're building

A **single-page web application** that lets one tutor (the project owner) conduct live aviation radio communication training sessions with one student at a time. The app replaces the v1 desktop architecture (two independent apps + Zoom) with a **unified web experience**: tutor and student share a session, communicate over built-in audio, and progress through a structured lesson together.

The simulation must feel like a real cockpit radio exchange. Authenticity over convenience. Procedure over speed.

## Who it's for

- **Tutor:** the project owner (single, hardcoded credentials in env). Conducts lessons as ATC.
- **Student:** people training for ICAO English aviation exams. One at a time. Joins via magic link, no account creation.
- **Concurrency target for MVP:** 1 active session at a time. Architecture should not preclude scaling later, but optimization for multi-session is out of scope.

## Why a web app (not desktop port)

The v1 desktop apps required Zoom for voice and shared `flight.json` files for state alignment. This was deliberate (human-in-the-loop, no networked simulator) but introduced friction:

- Zoom dependency (audio quality, scheduling, account requirements)
- Manual file distribution
- No source of truth for lesson state — tutor and student could drift

The web version keeps the **pedagogical principles** (tutor as judge, app as gatekeeper, exact-match validation, no AI scoring) but removes infrastructure friction by:

- Hosting both UIs on the same backend (server is the source of truth for lesson state)
- Embedding voice as P2P WebRTC audio
- Streaming student input directly to tutor's UI in real time (no screen share needed)

## Core architectural decisions (locked)

1. **Server is the single source of truth for lesson state.** Both clients render what the server says. Optimistic UI is allowed but must reconcile with server state.
2. **Lesson logic and media are separate channels.** Lesson state flows through WebSocket. Voice flows through WebRTC P2P (audio only, no video, no screen share). They never cross.
3. **No screen sharing.** Tutor sees student's input field state natively in their own UI via WebSocket events. This is faster, lighter, and more accurate than streaming pixels.
4. **Authentic radio audio.** Voice is processed through Web Audio API (bandpass filter, compression, slight distortion) to sound like VHF. Static and PTT effects play locally on the receiving side, synchronized via WebSocket events.
5. **Tutor authoring stays on desktop.** The existing desktop tutor app remains the lesson editor. The web app only consumes `flight.json` files (uploaded at room creation) — it does not author them.
6. **Magic link auth.** No passwords, no accounts. Tutor logs in with env-var password to create rooms. Each room generates a tutor URL and a student URL with embedded tokens. Tokens TTL 24h.
7. **Schema v1.0 only.** The actual `flight.json` format is defined by the desktop tutor app output (documented in `DOMAIN_MODEL.md §1`) and formally specified in `docs/v1-source/ANNEX_A_flight_schema.txt`. Files with mismatched `schema_version` are rejected at upload. Legacy field `"type": "frequency"` is normalized to `"com_frequency"` silently.

## Non-goals (explicitly out of scope for MVP)

- Multi-tutor support. One tutor (the owner). Adding more is a future migration.
- Multi-student concurrent sessions. Architecture allows it eventually; MVP optimizes for 1.
- Speech recognition / automated readback validation. Human judges. App enforces input fields only.
- Lesson authoring in the web UI. Use the existing desktop tutor app.
- Mobile tutor UI. The tutor works on a desktop browser (1280px+); the **student** session page supports phones (on-screen PTT, numeric keypad, responsive layout).
- Recording / playback of past sessions. Stretch goal, not MVP.
- Internationalization beyond what already exists in the source materials. UI is bilingual (RU/EN) where the user manual is bilingual; otherwise EN.
- Flashcards mode. v1 has it; web MVP doesn't. Add later if demanded.

## Authoritative source documents

When in doubt, these documents win — in this order:

1. **`docs/v1-source/ANNEX_A_flight_schema.txt`** — formal JSON Schema (draft-07) for `flight.json`. **Normative.** Defines the file contract.
2. **`docs/v1-source/ANNEX_B_state_machine.txt`** — student-app state machine (6 states), input field locking rules, Right Arrow authority matrix. **Normative.** Web version's server state machine is a faithful translation of this.
3. **`docs/v1-source/ANNEX_C_input_types.txt`** — input type definitions and validation regexes. **Normative.** Runtime format validation follows these regexes verbatim.
4. **`docs/v1-source/ANNEX_D_tutor_UI.txt`** — tutor UI to schema-path mapping, authoring constraints. **Normative** for what valid v1 lessons look like.
5. **`docs/v1-source/Executive_Summary.txt`** — system design v1, architectural intent. Descriptive, not normative.
6. **`docs/v1-source/OPERATIONAL_RULES_v1_0.txt`** — Rules TA-01 through SP-18. **Mixed authority**: the structural rules (which input types exist, what fields are required) are normative; the authoring guidance (trailing zeros, kHz spacing, ICAO pronunciation) is recommendation for tutors, NOT runtime validation. See `DOMAIN_MODEL.md §3.1` for the distinction.
7. **`docs/v1-source/User_Manual.html`** (Руководство пользователя) — user-facing manual. Defines UI feedback semantics (blue blink, red/green flash) and pedagogical philosophy.

If a v1 source contradicts a web-architecture decision in this document, **this document wins for the web version**. But the **Annexes are non-negotiable** for the formal contract — schema, state machine, validation regexes must be implemented faithfully.

## Tech stack (locked)

- **Frontend:** React 18 + Vite + TypeScript. Tailwind for styling.
- **Backend:** Node.js 20 LTS + Fastify + `ws` (WebSocket) + `better-sqlite3`.
- **Realtime media:** PeerJS client + self-hosted PeerServer + coturn (TURN/STUN).
- **Audio processing:** Web Audio API (browser-native, no external libs).
- **Persistence:** SQLite, single file at `/var/lib/skytalk/skytalk.db`.
- **Reverse proxy:** nginx + Let's Encrypt (certbot).
- **Process supervision:** systemd.
- **Monorepo layout:** pnpm workspaces. Three packages: `@skytalk/core` (domain logic, shared), `@skytalk/server` (backend), `@skytalk/web` (frontend).

## Deployment target

- **VPS:** Ubuntu 22.04, 2 vCPU, 2 GB RAM, 10 GB disk (upgraded from existing 1/1 before launch).
- **Coexisting service:** an existing quiz app (~5 users, low traffic) on the same VPS. SkyTalk lives at `skytalk.<domain>` subdomain, separate systemd unit, separate SQLite file, separate port (3001 internal). The two apps must not interfere.
- **Resource budget for SkyTalk:** ~500 MB RAM steady-state, ~800 MB peak during a lesson with TURN relay.

## What "done" looks like for the MVP

A live demo where:

1. Tutor logs in, uploads a `flight.json` (schema 1.0, validated), gets a student URL.
2. Student opens the URL in another browser, lands on the cockpit UI.
3. Both establish a WebRTC audio connection. Voice sounds like radio (filtered, with static).
4. Tutor presses spacebar, speaks ATC instruction. Student hears it with PTT click + static + tail.
5. Student presses spacebar, gives readback verbally, releases spacebar.
6. Student types required input value (e.g. "118.70"), presses Enter.
7. Server validates exact-match. Green flash to student, card turns green on tutor's panel showing what student typed.
8. Tutor verbally approves ("Roger"). Student presses Right Arrow. Server advances state.
9. For steps with multiple required inputs (up to 4): student enters each value sequentially, each card turns green in order, then advances after the last one.
10. Lesson completes. Both see "Lesson complete" screen. Student can Reset (restart from step 1) or Exit (return to home).

## How to use this document set when working with an AI agent

Five documents form a **layered context**:

- `CLAUDE.md` — **auto-loaded** by Claude Code and Gemini when opening the repo. Monorepo navigation rules, common mistakes, document hierarchy. Never needs to be pasted manually.
- `PROJECT_BRIEF.md` (this) — orientation, principles, constraints. Always paste at the start of every session.
- `ARCHITECTURE.md` — how components talk. Load for any backend or integration work.
- `DOMAIN_MODEL.md` — types, validation rules, state machine. Load for any work on `@skytalk/core` or validation.
- `TASKS.md` — discrete units of work with acceptance criteria. Pick one ticket per agent session.

When starting a new agent session: paste `PROJECT_BRIEF.md`, then the supplementary docs listed in the ticket's "Context to load", then the specific ticket. Don't paste the original v1 source documents unless the ticket explicitly requires them — they're long and dilute focus. The agent reads `CLAUDE.md` automatically from the repo root.
