# agent-eval

Local-first, UI-first eval tool for LLM/agent systems. Author evals in strict TypeScript inside `*.eval.ts` files, run them manually from a minimal UI or the CLI, and inspect trajectory, cost, inputs/outputs, and cache usage. The cache is file-based and commit-friendly so eval runs stay reproducible and diffable.

## Why

- **Real TypeScript evals** — `defineEval(...)`, `expect(...)`, `vi.mock(...)` all work the way you expect because evals run on Vitest.
- **Manual runs by default** — no background re-runs on file save. You trigger runs from the UI or CLI.
- **Inspectable cache** — LLM calls cache to files you can read, diff, and commit. Flip cache mode per run from the UI.
- **Cost + trace visibility** — per-case cost, token usage, and a tree/detail view of the agent's trajectory.

## Install

```sh
pnpm add -D @agent-evals/sdk @agent-evals/cli vitest
```

## Quick start

1. Add an `agent-evals.config.ts` at your project root.
2. Write evals in `*.eval.ts` files:

   ```ts
   import { defineEval } from '@agent-evals/sdk'

   defineEval('summarizes correctly', async ({ expect }) => {
     const out = await myAgent({ input: 'hello' })
     expect(out).toContain('hi')
   })
   ```

3. List and run them:

   ```sh
   agent-evals list
   agent-evals run
   ```

4. Or open the UI for the full experience — run controls, per-case results, trace drawer, cost, and cache controls.

See [`examples/basic-agent`](./examples/basic-agent) for a working setup.

## Status

v1 — local-first, single-user. No cloud sync, no dashboards, no collaboration in this version.
