# CLAUDE.md — Repository Guide for AI Agents

> **You are reading this because you are an AI agent working on this repository.** This file is your map. Read it fully before making any changes.

---

## What this repository is

SkyTalk Web — an aviation radio communication training simulator. **One web application**, organized as a **pnpm monorepo with three packages** that work together. This is not multiple applications.

## The three packages and what they do

| Package | Path | Purpose | Imports from |
|---|---|---|---|
| `@skytalk/core` | `packages/core` | Domain logic: types, validation rules (TA-01..TA-17), lesson state machine. Pure functions, no I/O, no UI. | nothing — leaf package |
| `@skytalk/server` | `packages/server` | Fastify backend: REST API, WebSocket protocol, SQLite persistence, room management. | `@skytalk/core` |
| `@skytalk/web` | `packages/web` | React + Vite SPA: tutor and student session UIs, Web Audio engine, PeerJS client. | `@skytalk/core` |

`@skytalk/core` is the foundation. Both `server` and `web` import from it. **When you change a type or a validation rule, you change it in `core` only — both other packages will pick it up via the workspace link.**

## Monorepo navigation rules

These are the rules I (the project owner) want you to follow. Failing to follow them produces broken builds in subtle ways.

### Rule 1: There are FOUR `package.json` files. Know which one to edit.

```
skytalk-web/
├── package.json          ← ROOT: workspace config, dev scripts, shared dev-deps
├── packages/
│   ├── core/package.json     ← only deps that core USES at runtime
│   ├── server/package.json   ← only deps that server USES at runtime
│   └── web/package.json      ← only deps that web USES at runtime
```

When adding a dependency, ask:

- "Does only ONE package use this at runtime?" → add it to **that package's** `package.json`
- "Is this a dev tool (TypeScript, ESLint, Vitest, Prettier)?" → add it to **root** `package.json` as a devDependency, never to per-package
- "Does this need to be in the workspace map?" → check root `pnpm-workspace.yaml`

After adding any dependency, run `pnpm install` **at the repo root**, not inside the package. The lockfile is at root.

### Rule 2: Always check root config files for ripple effects

When you finish changing files inside `packages/*`, before declaring done, check whether the change requires updates in root files. Common cases:

| If you did this | Check this in root |
|---|---|
| Added a new package to `packages/` | `pnpm-workspace.yaml`, root `tsconfig.base.json` references, root scripts |
| Changed export structure of `@skytalk/core` | `tsconfig.base.json` paths, ESLint config import resolution |
| Added a new dev script in a package | Add a corresponding `pnpm -r` or `pnpm --filter` shortcut in root scripts if it benefits from running across packages |
| Changed Node version requirement | Root `package.json` `engines`, `.nvmrc` if present, CI config |
| Added/changed env vars | `.env.example` at root, `RUNBOOK.md`, deploy scripts in `infra/` |

This rule exists because a previous project I worked on had recurring bugs where agents edited per-package configs but missed the root, leading to broken builds that worked locally but failed at install time. **Do not repeat this.**

### Rule 3: Use root scripts for cross-package operations

Root `package.json` defines scripts that operate on all packages at once. **Prefer these** over running commands inside individual packages, because they ensure consistent ordering and dependency resolution.

```bash
# Cross-package (run from root)
pnpm install              # install all deps for all packages
pnpm -r build             # build all packages in dependency order
pnpm -r test              # test all packages
pnpm -r lint              # lint all packages
pnpm -r typecheck         # typecheck all packages

# Single package (run from root, using filter)
pnpm --filter @skytalk/core test
pnpm --filter @skytalk/server dev
pnpm --filter @skytalk/web dev
```

You should rarely `cd packages/foo && pnpm something`. Stay at the root and use filters.

### Rule 4: Build order matters

`@skytalk/core` must build before `@skytalk/server` and `@skytalk/web` can typecheck against it. `pnpm -r build` handles this automatically because of dependency graph, but if you're running anything custom, respect this order:

```
core → server
core → web
```

If you change types in `core`, `pnpm --filter @skytalk/core build` first, then run typecheck on the others.

## How to approach a task

When given a ticket:

1. **Read `PROJECT_BRIEF.md` first** if you haven't this session. It's short.
2. **Read the supporting docs the ticket lists** (usually `ARCHITECTURE.md` and/or `DOMAIN_MODEL.md` sections).
3. **Identify which packages the change touches.** Most tickets touch one package. Cross-package tickets are rare and explicit.
4. **Identify root-file ripple effects** using the table above. Note them BEFORE coding.
5. **Plan, summarize back to the user, wait for confirmation** (per the template at the end of `TASKS.md`).
6. **Code, test locally with `pnpm` commands from root**, verify acceptance criteria from the ticket.
7. **Run the full check before declaring done:**
   ```bash
   pnpm -r typecheck && pnpm -r test && pnpm -r build
   ```
   If any of these fail, fix before handing back.

## Authoritative documents

In order of priority when sources conflict:

1. **Annexes A, B, C, D** in `docs/v1-source/` — **NORMATIVE.** They define the formal contracts of v1 (schema, state machine, input types, tutor UI constraints). Annexes win against everything else for technical specification.
2. `PROJECT_BRIEF.md` — what we're building, locked decisions, non-goals. Wins against v1 sources for **web-version-specific** decisions (no Zoom, no screen share, single app, magic links, etc.).
3. `ARCHITECTURE.md` — how components communicate.
4. `DOMAIN_MODEL.md` — types, validation rules, state machine. This document **translates** Annexes into TypeScript pseudocode; if it disagrees with an Annex, the Annex wins and DOMAIN_MODEL needs to be corrected.
5. `TASKS.md` — discrete units of work.
6. `OPERATIONAL_RULES_v1_0.txt` — mixes authoring guidance and procedural rules. **Be careful**: rules like TA-01..TA-04 (trailing zeros, kHz spacing) are tutor authoring guidance, NOT runtime validation rules. Annex C governs runtime validation.
7. `Executive_Summary.txt` — descriptive design doc. When it conflicts with an Annex, Annex wins.

If a v1 source contradicts a web-architecture decision in `PROJECT_BRIEF.md`, the brief wins for the web version. But the **formal specifications in Annexes** (schema, state machine, validation regexes) are non-negotiable — the web version must implement them faithfully.

## Common mistakes to avoid

- **Don't add `react`, `fastify`, etc. to root.** They're runtime deps of specific packages.
- **Don't add `typescript`, `vitest`, `eslint`, `prettier` to per-package `package.json`.** They're shared dev tools, root only.
- **Don't run `npm install`.** This is a pnpm workspace. Use `pnpm install`.
- **Don't `cd` into packages.** Operate from root with filters.
- **Don't import types from `@skytalk/server` or `@skytalk/web` into `@skytalk/core`.** Core is a leaf and stays that way.
- **Don't put HTML, JSX, or browser APIs in `@skytalk/core`.** It must run in Node (server) and browser (web) without modification.
- **Don't bypass `validateInput` or `viewStepForRole`.** These are the security-critical functions that prevent answer leakage to students.
- **Don't add features the user didn't ask for.** Specifically: no automated speech recognition, no fuzzy input matching, no AI-driven scoring. The product principle is "app enforces, human judges."

## When something is unclear

If a ticket's acceptance criteria conflict with what you find in the codebase, **stop and ask**. Don't guess. The user prefers a clarifying question over a wrong implementation that has to be reverted.

If you find that this `CLAUDE.md` itself is outdated or wrong about the current state of the repo, **mention it in your response** so it can be updated. This file should stay accurate.
