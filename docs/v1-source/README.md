# v1 Source Materials

These documents are the **authoritative specification of SkyTalk v1** (the desktop applications). They define the domain rules — schema, validation, state machine, UI constraints — that the web version inherits and must not violate.

## What's in here

| File                         | Authority level                | Purpose                                                                                                                                    |
| ---------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `Executive_Summary.txt`      | High                           | System-design overview. Architecture intent, locked structure of `flight.json`, flight phases, tutor/student app design.                   |
| `OPERATIONAL_RULES_v1_0.txt` | High (with caveat — see below) | Tutor authoring rules (TA-01..TA-17), tutor execution rules (TE-01..TE-17), student rules (SP-01..SP-18), pronunciation tables, scenarios. |
| `ANNEX_A_flight_schema.txt`  | **Highest (normative)**        | Formal JSON Schema (draft-07) for `flight.json`. The single source of truth for file format.                                               |
| `ANNEX_B_state_machine.txt`  | **Highest (normative)**        | Student state machine: 6 states, transition table, input field locking rules, right-arrow authority matrix.                                |
| `ANNEX_C_input_types.txt`    | **Highest (normative)**        | Input type definitions and validation regexes.                                                                                             |
| `ANNEX_D_tutor_UI.txt`       | **Highest (normative)**        | Tutor UI to schema-path mapping, export guarantees.                                                                                        |

## Conflict resolution rules

Where documents disagree, this is the resolution order:

1. **Annexes A, B, C, D** are **normative**. They explicitly say so ("This annex is normative"). They define the formal contract.
2. `Executive_Summary.txt` is **descriptive** — design intent. When it conflicts with an Annex, the Annex wins.
3. `OPERATIONAL_RULES_v1_0.txt` mixes two distinct concerns:
   - **Authoring guidance** (e.g. TA-01: "use trailing zeros") — recommendations for tutors writing lessons. NOT enforced in code.
   - **Procedural rules** (e.g. TE-13: "three attempts then demonstrate") — describe tutor behavior. NOT enforced in code either.
     When Operational Rules suggest stricter validation than Annex C provides (e.g. frequency spacing on 5 kHz boundaries), **Annex C wins** — code validates per Annex C, the tutor follows Operational Rules verbally.

## Notable conflicts you'll see between v1 and the web version

The web version (`PROJECT_BRIEF.md`, `ARCHITECTURE.md`, `DOMAIN_MODEL.md`) intentionally departs from v1 in these places:

- **No screen sharing.** v1 user manual mentions screen share heavily; web version replaces it with native tutor-side display of student state via WebSocket. Pedagogically equivalent, technically simpler.
- **No Zoom dependency.** v1 routes voice through Zoom; web version has built-in WebRTC audio.
- **Single application.** v1 has two independent apps + manual file sharing. Web version has one server-mediated session per room.
- **Tutor authoring stays on desktop.** Web version doesn't reimplement the lesson editor — it consumes lessons authored in the existing desktop tutor app.

These are documented in `PROJECT_BRIEF.md` § "Why a web app".

## Do not modify these files

These are historical reference. If a flaw is found, document it in the relevant web doc (PROJECT_BRIEF, ARCHITECTURE, etc.) and explain how the web version handles it. The v1 spec is frozen.
