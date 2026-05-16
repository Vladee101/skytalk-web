# SkyTalk Web

Aviation radio communication training simulator. One web application, three packages.

- **Agent context:** read [`CLAUDE.md`](CLAUDE.md) for monorepo navigation rules.
- **Product context:** read [`PROJECT_BRIEF.md`](PROJECT_BRIEF.md) for goals and constraints.
- **Architecture:** read [`ARCHITECTURE.md`](ARCHITECTURE.md) for component communication.

## Packages

| Package           | Path              | Role                                    |
| ----------------- | ----------------- | --------------------------------------- |
| `@skytalk/core`   | `packages/core`   | Domain logic, validation, state machine |
| `@skytalk/server` | `packages/server` | Fastify backend, WebSocket, SQLite      |
| `@skytalk/web`    | `packages/web`    | React SPA, Web Audio, PeerJS client     |

## Common commands (run from repo root)

```bash
pnpm install          # install all deps
pnpm -r build         # build all packages
pnpm -r typecheck     # type-check all packages
pnpm -r test          # test all packages
pnpm -r lint          # lint all packages
pnpm format:check     # check formatting
pnpm dev:server       # start backend in watch mode
pnpm dev:web          # start Vite dev server
```
