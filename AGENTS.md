Guidance for coding agents working in this repository.

# Project

Local-first, UI-first eval tool for LLM/agent systems. Evals are authored in strict TypeScript inside `*.eval.ts` files and executed via Vitest.

Early development — breaking changes are fine.

# Monorepo

pnpm 10 workspaces (do not invoke npm or yarn):

- `apps/server` — Hono backend (`@agent-evals/server`)
- `apps/web` — React 19 + Vite 7 frontend (`@agent-evals/web`)
- `packages/cli` — CLI binary (`@agent-evals/cli`)
- `packages/runner` — Core eval runner (Vitest + chokidar)
- `packages/sdk` — Public SDK (`defineEval`, matchers, blocks, pricing); vitest is a peer dep
- `packages/shared` — Shared Zod schemas / types
- `examples/basic-agent` — Demo with `*.eval.ts` files

# Commands

- `pnpm dev` / `pnpm dev:web` / `pnpm dev:all` — server / web / everything
- `pnpm build` — build all workspaces
- `pnpm tsc` — typecheck recursively
- `pnpm lint` — ESLint + tsc recursively
- `pnpm eslint` / `pnpm format` — ESLint / Prettier

Each workspace exposes `tsc`, `eslint`, `lint`.

# Toolchain

- Typecheck/build uses **`tsgo`**, not `tsc`. Per-workspace: `tsgo --noEmit`. Do not replace `tsgo`.
- Server dev uses `node --watch src/index.ts` directly on TS sources — no transpile step.
- Web build is `tsgo && vite build`.
- Default server port is `4100` (`PORT` env var).

# Testing the app

The runner resolves the workspace from `process.cwd()` (via `agent-evals.config.ts`). Use `examples/basic-agent` as the smoke-test workspace — never invent a new fixture.

- **CLI** — from `examples/basic-agent`:
  - `pnpm eval list` — discover evals
  - `pnpm eval run` — run all (add `--eval <id>` / `--case <id>` / `--no-cache` as needed)
  - `pnpm eval app` — serve the UI against the example workspace
- **End-to-end UI check** — only when the user asks. Open `http://localhost:4100` (server) or the Vite URL (web dev) and exercise the changed flow. If you can't actually load the UI, say so instead of claiming it works. Otherwise, rely on `pnpm lint` and the CLI smoke test.
- **Server + web together** — when changing `apps/server` or `apps/web`, run the server with cwd in the example so the runner picks up its config, and start the web dev server in parallel:
  - `cd examples/basic-agent && pnpm --filter @agent-evals/server dev`
  - `pnpm dev:web` (separate terminal)

# After implementing a feature or adjustment

Once the implementation is in place, complete the following before marking the task done:

- Run `pnpm lint` at the repo root and in every affected sub-package to surface ESLint and `tsgo` issues. Fix them at the source — no `eslint-disable`, `@ts-expect-error`, or `@ts-ignore`.
- Make sure `examples/basic-agent` exercises the new feature/adjustment. If coverage is missing, extend the example. Examples must reflect real production flows — no fake, synthetic, or placeholder scenarios.
- Smoke-test the example via the CLI (`pnpm eval list`, `pnpm eval run`, and `pnpm eval app` when the UI is affected) to confirm the feature behaves as intended end-to-end.
- Update the root `README.md` whenever user-facing behavior, APIs, CLI flags, config, or commands change.
- Add or update JSDoc on every public API touched (exports from `packages/sdk`, `packages/shared`, `packages/runner`, and `packages/cli`). Document intent, parameters, return values, and notable edge cases.

# Intent over literalism

- Infer the real goal behind a request, then implement the smallest change that solves it well.
- Don't follow instructions mechanically when they conflict with product intent, existing architecture, or the simplest correct solution.
- Avoid instruction-shaped overengineering: no new abstractions, configs, or refactors unless the actual problem requires them.
- Ask a focused clarifying question only when ambiguity materially affects scope or risk; otherwise make the reasonable assumption and proceed.

# Code style

## Typesafety

- No `any`. No unsafe `as Type` casts. No non-null assertions (`!`) — use `notNullish` from `@ls-stack/utils/assertions`.
- No `@ts-expect-error` / `@ts-ignore`. No `eslint-disable` comments — fix the underlying issue.
- Prefer `| undefined` or default values over optional parameters. Omit default values when every call site passes the same value.

## Organization

- No barrel files, no re-exports, no `index.ts` files.
- Abstract redundant types/code; split large functions and components.

## Error handling

Use `t-result`. Do not use `try`/`catch`.

```ts
import { Result, resultify } from 't-result';

function doSomething(input: string): Result<string, Error> {
  const parsed = resultify(() => JSON.parse(input));
  if (parsed.error) return parsed.errResult();
  return Result.ok(parsed.value);
}
```

# Backend — Hono

Use Hono as the web framework. Use Hono RPC for end-to-end type-safe API calls.

Split routes by resource into their own files, then mount them on the root app via chained `.route()` calls. Routes must be chained in a single expression for RPC inference to work — export `typeof routes_` (the chained value), not `typeof app`. Keep handler implementations in separate files and have the route file only wire validation + call the handler.

```ts
// routes/tasks.ts
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { createTaskHandler, getTasksHandler } from './tasks.handlers';
import { taskCreateSchema, taskQuerySchema } from './tasks.schemas';

export const taskRoutes = new Hono()
  .get('/tasks', zValidator('query', taskQuerySchema), async (c) => {
    return getTasksHandler(c, c.req.valid('query'));
  })
  .post('/tasks', zValidator('json', taskCreateSchema), async (c) => {
    return createTaskHandler(c, c.req.valid('json'));
  });
```

```ts
// index.ts
import { Hono } from 'hono';
import { taskRoutes } from './routes/tasks';
import { projectRoutes } from './routes/projects';

const app = new Hono();

// routes must be chained in order for hono rpc to work
const routes_ = app.route('/api', taskRoutes).route('/api', projectRoutes);

export type AppType = typeof routes_;
```

```ts
// client
import { hc } from 'hono/client';
import type { AppType } from '../backend/src';

const client = hc<AppType>('http://localhost:4100');
const res = await client.api.tasks.$post({ json: { title: 'New Task' } });
```

# Frontend

## Styling — Vindur

Vindur is a compile-time CSS-in-JS framework. Place styles at the top of component files. Reuse existing components first.

- Import theme colors from `#src/style/colors` and layout helpers from `#src/style/helpers`. Never use hardcoded colors.
- Never use `style={{}}` for static styles — use `styled` components or `css` props.
- Light mode only.

```tsx
import { styled } from 'vindur';
import { colors } from '#src/style/colors';
import {
  inline,
  stack,
  centerContent,
  fillContainer,
} from '#src/style/helpers';

const Button = styled.button`
  background: ${colors.accent.var};
  color: ${colors.white.var};
  border: 1px solid ${colors.accent.alpha(0.1)};

  &:hover {
    background: ${colors.accent.darken(0.1)};
  }
`;
```

Conditional styling — use style flags, not inline ternaries:

```tsx
const Card = styled.div<{ isActive: boolean }>`
  padding: 16px;
  &.isActive {
    border: 2px solid ${colors.accent.var};
  }
`;
```

Use the `cx` prop for additional conditional classes: `<Button cx={{ disabled, loading }} />`. Use camelCase modifiers (`isActive`, `isFocused`).

Scoped CSS variables use triple-dash (`---gap`). Use `keyframes` for animations. Use `createClassName()` for reusable class name consts. Use `createGlobalStyle` for globals.

Layout helpers replace manual flexbox:

```tsx
const Header = styled.div`
  ${inline({ justify: 'space-between', gap: 16 })}
`;
const Sidebar = styled.div`
  ${stack({ align: 'center', gap: 12 })}
`;
const Modal = styled.div`
  ${centerContent}
`;
const Overlay = styled.div`
  ${fillContainer}
`;
```

Don't use conditional style functions inside styled components — Vindur doesn't support them. Use style flags instead. Don't use `colorAlpha` with static colors — use `color.name.alpha(n)`.

## React patterns

`useEffect` is a last resort. Only use it for syncing with an external system because the component was displayed. Event-driven logic goes in event handlers.

Common anti-patterns to avoid:

- **Deriving state** — calculate during render, don't sync with `useEffect`.
- **Resetting on prop change** — use a `key` prop, not an effect.
- **Adjusting state on prop change** — derive from props or restructure state.
- **Notifying parents** — call `onChange` in the event handler, not in an effect.
- **Chains of effects** — consolidate into one event handler; derive what you can.

## Async actions

Use `useActionFn` from `@ls-stack/react-utils` instead of tracking progress with `useState`:

```tsx
const doSomething = useActionFn(async (...args) => {
  /* ... */
});

doSomething.call(...args);
doSomething.isInProgress;
```

The hook internally prevents concurrent calls — don't guard with `isInProgress` inside the callback.

## Forms

For multi-input forms with validation, use `useForm` from `t-state-form`:

```tsx
const { formTypedCtx, handleChange, forceFormValidation } = useForm({
  initialConfig: { name: { initialValue: '', required: true } },
});

const { formIsValid, formFields, fieldEntries } = useFormState(formTypedCtx);

function handleSubmit() {
  if (!formIsValid) forceFormValidation();
}
```
