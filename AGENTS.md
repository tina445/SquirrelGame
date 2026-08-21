# Repository Guidelines

## Current Status and Project Structure

This repository is an implemented npm-workspace monorepo for the P0-P6 MVP. The Korean project specification (`squirrel-heist-project-spec.md`) remains the source of truth for game rules, MVP scope, and authority boundaries. Read the root `diary.md` for chronological implementation decisions, verification results, and next work.

The npm-workspace monorepo is organized as follows:

- `client/`: Vite, TypeScript, and Three.js browser client; UI, input, networking, prediction, and rendering live here.
- `server/`: authoritative Node.js and WebSocket simulation, room lifecycle, security, snapshots, and observability.
- `shared/`: protocol types, domain models, math, collision, deterministic map generation, IDs, and balance configuration.
- `tools/`: load bots, map previews, and protocol inspection utilities. `docs/` holds protocol, deployment, compatibility, and playtest documentation.

Keep dependencies directional: `client` and `server` may consume `shared`; neither may depend on the other.

## Build, Test, and Development Commands

Use npm from the repository root:

```sh
npm install       # install workspace dependencies
npm run dev       # start local development services
npm run build     # produce production bundles
npm test          # run Vitest unit and integration tests
npm run lint      # run static style checks
npm run e2e       # run Playwright browser flows
npm run playtest:preflight # verify local browser/dependency readiness
```

For a one-human local match, run the development services and fill the remaining room slots with `LOAD_BOTS=7 LOAD_DURATION_MS=600000 npm run load:test`.

## Code and Architecture Rules

Use TypeScript `strict` mode, two-space indentation, `camelCase` for values and functions, `PascalCase` for classes and types, and domain-focused filenames such as `arrestSystem.ts`. Keep balance constants in `shared/config/`; do not duplicate magic numbers.

The server is authoritative for movement, collisions, ownership, interactions, and match results. Clients send inputs and action intent only. Three.js meshes are rendering state, never game-state truth.

Game coordinates use `+X` for screen-right/east and `+Y` for screen-up/north. The Three.js presentation adapter maps game `(x, y)` to scene `(x, height, -y)`. Cursor aiming is computed by projecting the pointer onto the ground plane; local facing may be predicted immediately, but firing, projectile movement, hits, and stun remain server-authoritative. Consume queued inputs in sequence order, preserve every button edge, and use the final input for continuous movement state.

Add Korean JSDoc comments at method/function boundaries in core architecture code: shared protocol/collision/map rules, server gateway/Room/tick authority, and client input/network/prediction/render adapters. Each comment should explain responsibility and, where relevant, authority ownership, invariants, ordering, fallback, or side effects. Do not narrate obvious syntax or add comments to trivial accessors unless the accessor protects an architectural boundary. Update comments whenever behavior or ownership changes.

## Testing Guidelines

Use Vitest for pure logic and server integration tests, and Playwright for multi-browser flows. Cover game invariants and boundary failures: acorn conservation, duplicate/invalid input, range loss, stun, disconnects, and simultaneous win conditions. Map changes require deterministic seed regression tests and validator coverage across many seeds.

## Commits, Pull Requests, and Agent Work

Use Conventional Commits by default: `feat(server): add authoritative movement`. Keep PRs focused; include a clear description, tests run, linked issue when applicable, and screenshots or video for visible gameplay changes.

For protocol changes, define versioning, runtime validation, and duplicate/order handling. For map-generation changes, add deterministic behavior, validation, fallback, and seed fixtures. Do not expand MVP scope without a separate proposal.

Before publishing, inspect the exact remote history and preserve it. Work on `develop` for integrated MVP work unless the user requests another branch, review the complete status and diff, stage only explicit confirmed paths (never `git add .` or `git add -A`), run the required validation, use a Conventional Commit, and verify the remote branch after push. Record the branch, commit, checks, and any authentication or CI follow-up in `diary.md`.

After every completed work item, append a dated Korean entry to the root `diary.md`. Record the goal, architectural decisions, behavior/code changes, commands and results, remaining risks, and concrete next work. Never rewrite prior entries; correct them with a newer entry when necessary.
