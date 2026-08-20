# Repository Guidelines

## Current Status and Project Structure

This repository currently contains the Korean project specification (`squirrel-heist-project-spec.md`); the application workspace has not yet been scaffolded. Treat that specification as the source of truth for game rules, MVP scope, and authority boundaries.

The planned npm-workspace monorepo is organized as follows:

- `client/`: Vite, TypeScript, and Three.js browser client; UI, input, networking, prediction, and rendering live here.
- `server/`: authoritative Node.js and WebSocket simulation, room lifecycle, security, snapshots, and observability.
- `shared/`: protocol types, domain models, math, collision, deterministic map generation, IDs, and balance configuration.
- `tools/`: load bots, map previews, and protocol inspection utilities. `docs/` holds evolving technical documentation.

Keep dependencies directional: `client` and `server` may consume `shared`; neither may depend on the other.

## Build, Test, and Development Commands

After the workspace is introduced, use npm from the repository root:

```sh
npm install       # install workspace dependencies
npm run dev       # start local development services
npm run build     # produce production bundles
npm test          # run Vitest unit and integration tests
npm run lint      # run static style checks
npm run e2e       # run Playwright browser flows
```

These commands are scaffold targets, not currently runnable. The initial workspace change must add the matching root scripts rather than assume they exist.

## Code and Architecture Rules

Use TypeScript `strict` mode, two-space indentation, `camelCase` for values and functions, `PascalCase` for classes and types, and domain-focused filenames such as `arrestSystem.ts`. Keep balance constants in `shared/config/`; do not duplicate magic numbers.

The server is authoritative for movement, collisions, ownership, interactions, and match results. Clients send inputs and action intent only. Three.js meshes are rendering state, never game-state truth.

## Testing Guidelines

Use Vitest for pure logic and server integration tests, and Playwright for multi-browser flows. Cover game invariants and boundary failures: acorn conservation, duplicate/invalid input, range loss, stun, disconnects, and simultaneous win conditions. Map changes require deterministic seed regression tests and validator coverage across many seeds.

## Commits, Pull Requests, and Agent Work

No Git history exists yet, so use Conventional Commits by default: `feat(server): add authoritative movement`. Keep PRs focused; include a clear description, tests run, linked issue when applicable, and screenshots or video for visible gameplay changes.

For protocol changes, define versioning, runtime validation, and duplicate/order handling. For map-generation changes, add deterministic behavior, validation, fallback, and seed fixtures. Do not expand MVP scope without a separate proposal.
