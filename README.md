# agent-eval

Local-first, UI-first eval tool for LLM/agent systems. Evals are authored in strict TypeScript in `*.eval.ts` files and executed via Vitest, with a minimal UI and CLI for running them manually, inspecting traces, cost, inputs/outputs, and a file-based, commit-friendly cache.

## Stack

- **Runtime:** Vitest (`vi.mock`, `vi.spyOn`, `expect` work natively)
- **Server:** Hono (RPC + SSE)
- **Web:** React 19 + Vite 7 + Vindur + t-state
- **Toolchain:** pnpm workspaces, TypeScript (strict), `tsgo` for typecheck/build, Prettier, ESLint

## Layout

```
apps/
  server/        Hono backend
  web/           React + Vite frontend
packages/
  cli/           CLI binary
  runner/        Core eval runner (Vitest + chokidar)
  sdk/           Public SDK: defineEval, matchers, blocks, pricing
  shared/        Shared Zod schemas / types
examples/
  basic-agent/   Demo evals
```

## Getting started

```sh
pnpm install
pnpm dev:all        # server + web
```

Individual apps: `pnpm dev` (server only), `pnpm dev:web` (web only). Server defaults to port `4100` (override with `PORT`).

## Common commands

| Command         | Purpose                                    |
| --------------- | ------------------------------------------ |
| `pnpm dev:all`  | Run server + web in parallel               |
| `pnpm build`    | Build all workspaces                       |
| `pnpm tsc`      | Typecheck all workspaces (`tsgo --noEmit`) |
| `pnpm lint`     | ESLint all workspaces                      |
| `pnpm format`   | Prettier write                             |

Workspace-scoped: `pnpm --filter @agent-evals/<pkg> <script>`.

## Writing evals

Evals live in `*.eval.ts` files and are configured via `agent-evals.config.ts`. See [`examples/basic-agent`](./examples/basic-agent) for a working reference.

Runs are **manual only** — triggered from the UI or via the CLI (`pnpm --filter @agent-evals/example-basic-agent eval`).
