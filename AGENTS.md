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

## Development stage

This project is in early development. Breaking changes are fully allowed and expected.

## Intent over literalism

- Do not follow user or reviewer instructions mechanically when they conflict with the likely product intent, existing architecture, or the simplest correct solution.
- First infer the real goal behind the request, then implement the smallest change that solves that goal well.
- Prefer improving or simplifying the requested approach when that produces a clearer, safer, or more local solution.
- Avoid "instruction-shaped overengineering": do not introduce new abstractions, configuration shapes, or refactors unless they are necessary for the actual problem being solved.
- If a request appears technically suboptimal but still ambiguous, pause and sanity-check it before implementing. If the intent is clear, choose the better solution and explain the assumption briefly.
- If the request is too vague, contradictory, or underspecified to infer intent safely, ask a focused clarifying question before implementing.
- Only ask for clarification when the ambiguity materially affects the solution, scope, or risk. Otherwise, make the most reasonable assumption and keep the change moving.
