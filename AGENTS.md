# AGENTS.md

This file provides guidance to coding agents (Claude Code, etc.) when working with code in this repository.

## Project

Local-first, UI-first eval tool for LLM/agent systems. Evals are authored in strict TypeScript inside `*.eval.ts` files and executed via Vitest.

## Monorepo layout

pnpm workspaces:

- `apps/server` — Hono.js backend (`@agent-evals/server`)
- `apps/web` — React 19 + Vite 7 frontend (`@agent-evals/web`)
- `packages/cli` — CLI binary (`@agent-evals/cli`)
- `packages/runner` — Core eval runner (Vitest + chokidar)
- `packages/sdk` — Public SDK (`defineEval`, matchers, blocks, pricing); vitest is a peer dep
- `packages/shared` — Shared Zod schemas / types
- `examples/basic-agent` — Demo with `*.eval.ts` files

## Commands

Package manager is pnpm 10. Use `pnpm --filter <pkg>` or `pnpm -r`; do not invoke npm or yarn.

- `pnpm dev` / `pnpm dev:web` / `pnpm dev:all` — run server / web / everything
- `pnpm build` — build all workspaces
- `pnpm tsc` — typecheck all workspaces (recursive)
- `pnpm lint` — ESLint + tsc all workspaces (recursive)
- `pnpm eslint` — ESLint all workspaces (recursive)
- `pnpm format` — prettier write

Each workspace also exposes `tsc`, `eslint` and `lint` scripts.

Run `pnpm lint` before marking a task complete.

## Toolchain notes

- Typecheck/build uses **`tsgo`**, not `tsc`. Per-workspace typecheck is `tsgo --noEmit`. Do not replace `tsgo` with `tsc`.
- Server dev uses `node --watch src/index.ts` directly on TS sources — do not add a transpile step.
- Web build is `tsgo && vite build`.
- Default server port is `4100` (`PORT` env var).
