This file provides guidance to coding agents when working with code in this repository.

# Project

Local-first, UI-first eval tool for LLM/agent systems. Evals are authored in strict TypeScript inside `*.eval.ts` files and executed via Vitest.

# Monorepo layout

pnpm workspaces:

- `apps/server` — Hono.js backend (`@agent-evals/server`)
- `apps/web` — React 19 + Vite 7 frontend (`@agent-evals/web`)
- `packages/cli` — CLI binary (`@agent-evals/cli`)
- `packages/runner` — Core eval runner (Vitest + chokidar)
- `packages/sdk` — Public SDK (`defineEval`, matchers, blocks, pricing); vitest is a peer dep
- `packages/shared` — Shared Zod schemas / types
- `examples/basic-agent` — Demo with `*.eval.ts` files

# Commands

Package manager is pnpm 10. Use `pnpm --filter <pkg>` or `pnpm -r`; do not invoke npm or yarn.

- `pnpm dev` / `pnpm dev:web` / `pnpm dev:all` — run server / web / everything
- `pnpm build` — build all workspaces
- `pnpm tsc` — typecheck all workspaces (recursive)
- `pnpm lint` — ESLint + tsc all workspaces (recursive)
- `pnpm eslint` — ESLint all workspaces (recursive)
- `pnpm format` — prettier write

Each workspace also exposes `tsc`, `eslint` and `lint` scripts.

Run `pnpm lint` before marking a task complete.

# Toolchain notes

- Typecheck/build uses **`tsgo`**, not `tsc`. Per-workspace typecheck is `tsgo --noEmit`. Do not replace `tsgo` with `tsc`.
- Server dev uses `node --watch src/index.ts` directly on TS sources — do not add a transpile step.
- Web build is `tsgo && vite build`.
- Default server port is `4100` (`PORT` env var).

# Development stage

This project is in early development. Breaking changes are fully allowed and expected.

# Development guidelines

- When a change affects user-facing behavior (public SDK API, CLI flags, config shape, commands, or workflow), update the root `README.md` in the same change. Keep examples runnable and consistent with the new behavior.

# Intent over literalism

- Do not follow user or reviewer instructions mechanically when they conflict with the likely product intent, existing architecture, or the simplest correct solution.
- First infer the real goal behind the request, then implement the smallest change that solves that goal well.
- Prefer improving or simplifying the requested approach when that produces a clearer, safer, or more local solution.
- Avoid "instruction-shaped overengineering": do not introduce new abstractions, configuration shapes, or refactors unless they are necessary for the actual problem being solved.
- If a request appears technically suboptimal but still ambiguous, pause and sanity-check it before implementing. If the intent is clear, choose the better solution and explain the assumption briefly.
- If the request is too vague, contradictory, or underspecified to infer intent safely, ask a focused clarifying question before implementing.
- Only ask for clarification when the ambiguity materially affects the solution, scope, or risk. Otherwise, make the most reasonable assumption and keep the change moving.

# Hono

Use Hono as the web framework for the backend.

## Hono RPC

Use Hono RPC for type-safe API communication between frontend and backend. This provides end-to-end type safety without code generation.

Backend setup:

```ts
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

const app = new Hono()
  .get('/api/tasks', async (c) => {
    // Return tasks
    return c.json({ tasks: [] });
  })
  .post(
    '/api/tasks',
    zValidator(
      'json',
      z.object({
        title: z.string(),
        description: z.string().optional(),
      }),
    ),
    async (c) => {
      const data = c.req.valid('json');
      // Create task
      return c.json({ success: true });
    },
  );

export type AppType = typeof app;
```

Frontend usage:

```ts
import { hc } from 'hono/client';
import type { AppType } from '../backend/app';

const client = hc<AppType>('http://localhost:3000');

// Type-safe API calls
const res = await client.api.tasks.$get();
const data = await res.json(); // Fully typed

// Type-safe mutations
const createRes = await client.api.tasks.$post({
  json: {
    title: 'New Task', // Type checked
    description: 'Optional description',
  },
});
```

# Typesafety and code quality

- Write typesafe code
- NEVER use `any`
- NEVER use unsafe `as Type` casts
- NEVER use non-null assertions (`!`), for cases in which you are sure the value is not null use `notNullish` from `@t-state/utils/assertions`
- Avoid using optional parameters, use default values or `| undefined` instead
- NEVER use @ts-expect-error or @ts-ignore comments
- NEVER use eslint-disable comments or it's variants

# Code Organization

- Abstract redundant types into a single type
- Abstract redundant code into a single function
- Split up large or complex functions into smaller functions
- Split up large components into smaller components
- Do not use barrel files
- NEVER use re-exports
- Never use `index.ts` files

# Error handling

- Use `t-result` for functions that can fail:

  ```ts
  import { Result } from 't-result';

  function doSomething(isCorrect: boolean): Result<string, Error> {
    if (isCorrect) {
      return Result.ok('success');
    }

    return Result.err(new Error('error'));
  }

  const result = doSomething(true);

  if (result.ok) {
    console.log(result.value);
  } else {
    console.log(result.error);
  }
  ```

- Use `t-result` resultify function for handling unsafe functions or code inside functions:

  ```ts
  import { Result, resultify } from 't-result';

  function doSomething(input: string): Result<string, Error> {
    const safeValueResult = resultify(() => functionOrPromiseThatMayThrow());
    // safeValueResult is a Result<T, Error>

    if (safeValueResult.error) {
      return safeValueResult.errResult();
    }

    const safeValueResultFromPromise = resultify(
      createPromise(safeValueResult.value),
    );
    // safeValueResultFromPromise is a Result<T, Error>

    if (safeValueResultFromPromise.error) {
      return safeValueResultFromPromise.errResult();
    }

    return Result.ok(safeValueResultFromPromise.value);
  }
  ```

- DO NOT use try/catch blocks

# Bad practices

- NEVER USE eslint-disable comments or it's variants
- NEVER USE @ts-expect-error or @ts-ignore comments

# Function and component params

- Avoid using optional parameters, use default values or `| undefined` instead
- Avoid using default values when all usages of the function use the same param value

## Styling

- Use dark mode
- Reuse existing components, only create new ones if necessary
- Styles must be placed at the top of component files
- **NEVER use `style={{}}` props**: Always use styled components for static styles
- **Eliminate Runtime Styles**: Convert all inline styles to compile-time styled components
- **Use Vindur Patterns**: Follow styled component patterns with proper theme integration

### Vindur CSS Framework

Vindur is a performance-focused CSS-in-JS framework with compile-time optimization.

#### Key Usage Guidelines:

- **Always import colors from `src/style/theme.ts`**:

  ```tsx
  import { colors } from '@/style/theme';
  ```

- **Import reusable functions from `src/style/functions.ts`**:

  ```tsx
  import { flexCenter, buttonBase } from '@/style/functions';
  ```

- Use `styled` for creating styled components:

  ```tsx
  import { styled } from 'vindur';
  import { colors } from '@/style/theme';

  const Button = styled.button`
    background: ${colors.primary.var};
    color: ${colors.primary.contrast.var};
    border: 1px solid ${colors.primary.alpha(0.1)};
    padding: 12px 24px;

    &:hover {
      background: ${colors.primary.darken(0.1)};
    }
  `;
  ```

- Use style flags for conditional styling:

  ```tsx
  const Card = styled.div<{ active: boolean }>`
    padding: 16px;
    background: ${colors.surface.var};

    &.active {
      border: 2px solid ${colors.primary.var};
    }
  `

  // Usage
  <Card active={isActive} />
  ```

- Use scoped CSS variables (triple-dash):

  ```tsx
  const Layout = styled.div`
    ---gap: 16px;

    display: grid;
    gap: var(---gap);
  `;
  ```

- Use `cx` prop for additional conditional classes:

  ```tsx
  <Button cx={{ disabled: isDisabled, loading: isLoading }} />
  ```

- Create animations with `keyframes`:

  ```tsx
  const fadeIn = keyframes`
    from { opacity: 0; }
    to { opacity: 1; }
  `;

  const FadeDiv = styled.div`
    animation: ${fadeIn} 0.3s ease-out;
  `;
  ```

- Global styles setup:

  ```tsx
  import { createGlobalStyle } from 'vindur';
  import { colors } from '@/style/theme';

  createGlobalStyle`
    body {
      margin: 0;
      background: ${colors.background.var};
      color: ${colors.text.var};
    }
  `;
  ```

- Referencing class of other components:

  ```tsx
  const Button = styled.button`
    // ...
  `;

  const Container = styled.div`
    display: flex;
    flex-direction: column;
    gap: 16px;

    & > ${Button} {
      // ...
    }
  `;
  ```

- Creating reusable class names consts:

  ```tsx
  import { createClassName } from 'vindur';

  export const globalClass = createClassName();
  ```

#### Bad practices

- Never use conditional style functions inside styled components, vindur does not support them, example:

  ```tsx
  // DO NOT DO THIS:
  const Button = styled.button<{ disabled: boolean }>`
    background: ${({ disabled }) =>
      disabled ?
        colors.disabled.var
      : colors.primary.var}; // WRONG!! It's ugly and not supported by vindur
  `;

  // Use style flags instead:
  const Button = styled.button<{ disabled: boolean }>`
    background: ${colors.primary.var};
    color: ${colors.primary.contrast.var};

    &.disabled {
      background: ${colors.disabled.var};
    }
  `;
  ```

- DO NOT use style={} props for static styles, use styled components or css props instead, example:

  ```tsx
  // The style here is constant, so it should be a styled component or css prop
  <div style={{ background: colors.primary.var, height: '100px' }} />;

  // Use styled components or css props instead:
  const Button = styled.button`
    background: ${colors.primary.var};
    height: 100px;
  `;

  <Button />;
  ```

- Don't use `colorAlpha` with static colors, use `color.name.alpha(alpha)` instead.

#### Best Practices:

- Always use compile-time CSS generation
- Leverage the built-in dark mode support
- Use type-safe theme color systems created with `vindurTheme`, if there's no color in the theme, create it. Prefer using color modifiers instead of creating new colors when possible. DONT use hardcoded colors, always use the theme colors.
- Create reusable style mixins with `vindurFn`
- Take advantage of native CSS nesting
- Use camelCase for css modifiers, example: `isActive`, `isFocused`, `isSuperFocused`, etc.
- Use `transition()` helper for transitions when style is dynamic, example:

  ```tsx
  import { transition } from '#src/style/helpers/transition';

  const Button = styled.button`
    background: ${colors.primary.var};
    color: ${colors.primary.contrast.var};
    padding: 12px 24px;
    ${transition()};

    &:hover {
      background: ${colors.primary.darken(0.1)};
    }
  `;
  ```

  - Dont use ternary in classNames for conditional styles `className={isActive ? 'active' : ''}`, use cx prop instead `className={cx({ active: isActive })}`

#### Style Helpers

Flexbox Layout helpers from @frontend/src/style/helpers/layoutHelpers.ts (use it instead of using flexbox directly):

```tsx
import {
  inline,
  stack,
  centerContent,
  fillContainer,
} from '#src/style/helpers/layoutHelpers';

// ❌ Bad - Manual flexbox for horizontal layouts
const Header = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
`;

// ✅ Good - inline helper for horizontal layouts
const Header = styled.div`
  ${inline()} // default: justify-content: flex-start, align-items: center
  ${inline({
    justify: 'space-between',
    gap: 16,
  })} // custom: spread items with gap
`;

// ❌ Bad - Manual flexbox for vertical layouts
const Sidebar = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
`;

// ✅ Good - stack helper for vertical layouts
const Sidebar = styled.div`
  ${stack()} // default: justify-content: flex-start, align-items: stretch
  ${stack({ align: 'center', gap: 12 })} // custom: center items with gap
`;

// ❌ Bad - Manual flexbox for centering
const Modal = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
`;

// ✅ Good - centerContent helper for perfect centering
const Modal = styled.div`
  ${centerContent}// centers content both horizontally and vertically
`;

// ❌ Bad - Manual absolute positioning for full coverage
const Overlay = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
`;

// ✅ Good - fillContainer helper for full coverage
const Overlay = styled.div`
  ${fillContainer}// fills parent container with absolute positioning
`;
```

## React bad practices

`useEffect` should be a last resort. Most of the time there is a better alternative. Only use `useEffect` for code that needs to run **because the component was displayed** (e.g. syncing with an external system). If the code is triggered by a user event, it belongs in an event handler.

### Deriving state — calculate during render instead of syncing with useEffect

```tsx
// ❌ Bad - Redundant state + unnecessary effect
const [firstName, setFirstName] = useState('Taylor');
const [lastName, setLastName] = useState('Swift');
const [fullName, setFullName] = useState('');
useEffect(() => {
  setFullName(firstName + ' ' + lastName);
}, [firstName, lastName]);

// ✅ Good - Derive during render
const [firstName, setFirstName] = useState('Taylor');
const [lastName, setLastName] = useState('Swift');
const fullName = firstName + ' ' + lastName;
```

### Resetting state when a prop changes — use `key` instead of useEffect

```tsx
// ❌ Bad - Resetting state in an effect causes an extra re-render
function ProfilePage({ userId }: { userId: string }) {
  const [comment, setComment] = useState('');
  useEffect(() => {
    setComment('');
  }, [userId]);
}

// ✅ Good - Use key to reset the component instance
function ProfilePage({ userId }: { userId: string }) {
  return (
    <Profile
      userId={userId}
      key={userId}
    />
  );
}
```

### Adjusting state when a prop changes — derive or restructure instead

```tsx
// ❌ Bad - Effect chain with cascading re-renders
function List({ items }: { items: Item[] }) {
  const [selection, setSelection] = useState<Item | null>(null);
  useEffect(() => {
    setSelection(null);
  }, [items]);
}

// ✅ Good - Derive selection from items
function List({ items }: { items: Item[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selection = items.find((item) => item.id === selectedId) ?? null;
}
```

### Event-driven logic — use event handlers, not useEffect

```tsx
// ❌ Bad - Effect runs on every product change, not on user action
function ProductPage({ product }: { product: Product }) {
  useEffect(() => {
    if (product.isInCart) {
      showNotification(`Added ${product.name} to cart!`);
    }
  }, [product]);
}

// ✅ Good - Notification tied to user action
function ProductPage({ product }: { product: Product }) {
  function handleBuyClick() {
    addToCart(product);
    showNotification(`Added ${product.name} to cart!`);
  }
}
```

### Notifying parent components — call in event handler, not in useEffect

```tsx
// ❌ Bad - onChange called after render via effect
function Toggle({ onChange }: { onChange: (isOn: boolean) => void }) {
  const [isOn, setIsOn] = useState(false);
  useEffect(() => {
    onChange(isOn);
  }, [isOn, onChange]);
}

// ✅ Good - Both updates happen together in the handler
function Toggle({ onChange }: { onChange: (isOn: boolean) => void }) {
  const [isOn, setIsOn] = useState(false);
  function handleClick() {
    const nextIsOn = !isOn;
    setIsOn(nextIsOn);
    onChange(nextIsOn);
  }
}
```

### Chains of effects — consolidate into a single event handler

```tsx
// ❌ Bad - Multiple effects triggering each other
useEffect(() => {
  if (card?.gold) setGoldCardCount((c) => c + 1);
}, [card]);
useEffect(() => {
  if (goldCardCount > 3) {
    setRound((r) => r + 1);
    setGoldCardCount(0);
  }
}, [goldCardCount]);
useEffect(() => {
  if (round > 5) setIsGameOver(true);
}, [round]);

// ✅ Good - All state updates in one handler, derive what you can
const isGameOver = round > 5;
function handlePlaceCard(nextCard: Card) {
  setCard(nextCard);
  if (nextCard.gold) {
    if (goldCardCount < 3) {
      setGoldCardCount(goldCardCount + 1);
    } else {
      setGoldCardCount(0);
      setRound(round + 1);
    }
  }
}
```

## Async actions

Use `useActionFn` for async actions. It will handle the progress state for you and prevent calling the action multiple times.

Instead of using `useState` to track progress of async actions, use `useActionFn`. Example:

❌ Bad:

```tsx
const [isDoingSomething, setIsDoingSomething] = useState(false);
function doSomething() {
  setIsDoingSomething(true);
  // ...
  setIsDoingSomething(false);
}
```

✅ Good:

```tsx
const doSomething = useActionFn((...args) => {
  // ...
});

doSomething.call(...args); // call the action
doSomething.isInProgress; // check if the action is in progress
```

There is also no need to check `doSomething.isInProgress` inside the useActionFn callback, it will be already checked internally to prevent calling the action multiple times.

## Form and input handling

For more complex forms, using multiple inputs or validations, use `useForm` from `t-state-form` to handle the form state and validation instead of using multiple `useState` hooks. Example:

```tsx
const { formTypedCtx, handleChange, forceFormValidation } = useForm({
  initialConfig: {
    name: { initialValue: '', required: true },
  },
});

const { formIsValid, formFields, fieldEntries } = useFormState(formTypedCtx);

function handleSubmit() {
  if (!formIsValid) forceFormValidation();
}
```
