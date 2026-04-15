# agent-eval

Local-first, UI-first eval tool for LLM/agent systems. Author evals in strict TypeScript inside `*.eval.ts` files, run them manually from a minimal UI or the CLI, and inspect trajectory, cost, inputs/outputs, and cache usage. The cache is file-based and commit-friendly so eval runs stay reproducible.

## Why

- **Real TypeScript evals** — `defineEval(...)`, `expect(...)`, `vi.mock(...)` all work the way you expect because evals run on Vitest.
- **Manual runs by default** — no background re-runs on file save. You trigger runs from the UI or CLI.
- **Inspectable cache** — LLM calls cache to files you can read, diff, and commit; disable per run when you need fresh output.
- **Cost + trace visibility** — per-case cost, token usage, a tree/detail view of the agent's trajectory, and custom result columns.
- **Multimodal** — attach images, audio, video, and files to case inputs/outputs for display in the UI.

## Install

```sh
pnpm add -D @agent-evals/sdk @agent-evals/cli vitest
```

`vitest` is a peer dependency (>= 3.0.0).

## Quick start

1. **Create `agent-evals.config.ts`** at your project root:

   ```ts
   import type { AgentEvalsConfig } from '@agent-evals/sdk'

   export const config: AgentEvalsConfig = {
     include: ['evals/**/*.eval.ts'],
     defaultTrials: 1,
     concurrency: 2,
     pricing: {
       'gpt-4o': { inputPerMillionUsd: 2.5, outputPerMillionUsd: 10 },
     },
   }
   ```

2. **Write an eval** in `evals/my-agent.eval.ts`:

   ```ts
   import { defineEval, blocks } from '@agent-evals/sdk'
   import { expect } from 'vitest'
   import { myAgent } from '../src/agent'

   defineEval({
     id: 'my-agent',
     title: 'My Agent',
     data: [
       { id: 'greeting', input: { message: 'hello' } },
       { id: 'farewell', input: { message: 'bye' } },
     ],
     task: async ({ input, trace }) => {
       const output = await trace.span(
         { kind: 'agent', name: 'my-agent' },
         async (span) => {
           span.setInput(input)
           return myAgent(input)
         },
       )
       return { output }
     },
     assert: ({ output }) => {
       expect(output).toBeTruthy()
     },
   })
   ```

3. **Open the UI** — `agent-evals` (or `agent-evals dev`) serves it at `http://localhost:4100` (override with `--port`). The UI gives you run controls, per-case results, trace drawer, cost, and per-run cache toggle.

4. **Or use the CLI**:

   ```sh
   agent-evals list
   agent-evals run
   ```

A complete working example lives at [`examples/basic-agent`](./examples/basic-agent).

## Configuration

`agent-evals.config.ts` at your project root defines how evals are discovered and executed.

| Field            | Type                                           | Description                                                      |
| ---------------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| `include`        | `string[]`                                     | Glob patterns for eval files (e.g. `['evals/**/*.eval.ts']`)     |
| `workspaceRoot`  | `string?`                                      | Root directory; defaults to `process.cwd()`                      |
| `defaultTrials`  | `number?`                                      | Trials per case when not overridden (default: `1`)               |
| `concurrency`    | `number?`                                      | Max parallel case executions (default: `2`)                      |
| `pricing`        | `Record<string, { inputPerMillionUsd, outputPerMillionUsd }>?` | Per-model pricing used to compute cost |

## Writing evals

`defineEval` takes a single definition object:

| Field           | Required | Purpose                                                                          |
| --------------- | -------- | -------------------------------------------------------------------------------- |
| `id`            | yes      | Unique eval id                                                                   |
| `title`         |          | Display title                                                                    |
| `description`   |          | Free-text description                                                            |
| `data`          | yes      | `EvalCase[]` or `() => Promise<EvalCase[]>` (async loader for dynamic datasets)  |
| `task`          | yes      | `async ({ case, input, signal, trace, runtime }) => ({ output, ... })`           |
| `scorers`       |          | Array of scoring functions returning `{ id, score, ... }`                        |
| `assert`        |          | Vitest-style assertions run against `{ output, trace, cost, ... }`               |
| `columnDefs`    |          | Custom columns shown in the results table                                        |
| `passThreshold` |          | Minimum average score for a case to pass                                         |

### Cases

```ts
data: [
  {
    id: 'simple-text',
    input: { message: 'I want a refund', locale: 'en-US' },
    displayInput: [blocks.markdown('**Request:** I want a refund')],
    columns: { locale: 'en-US', priority: 'normal' },
  },
]
```

`displayInput` controls what the UI shows; `columns` populates your custom columns.

### Task and tracing

`task` receives a `trace` recorder. Wrap work in spans to get a trajectory tree in the UI:

```ts
task: async ({ input, trace }) => {
  const result = await trace.span(
    { kind: 'agent', name: 'refund-agent' },
    async (span) => {
      span.setInput(input)
      const out = await agent(input)
      span.setOutput(out)
      return out
    },
  )
  trace.checkpoint('final-state', { approved: true })
  return {
    output: result.finalText,
    displayOutput: [blocks.markdown(result.finalText)],
    columns: { toolCalls: result.toolCalls },
  }
}
```

### Scorers

```ts
scorers: [
  async ({ output }) => ({
    id: 'mentions-refund',
    score: /refund/i.test(output) ? 1 : 0,
  }),
]
```

### Custom columns

```ts
columnDefs: [
  { key: 'locale', label: 'Locale', kind: 'string', defaultVisible: true },
  { key: 'toolCalls', label: 'Tool Calls', kind: 'number', defaultVisible: true },
]
```

Populate values in the case (`columns`) and/or the task result (`columns`).

## Display blocks

`blocks` helpers build rich content for `displayInput` / `displayOutput`:

| Helper             | Use                                             |
| ------------------ | ----------------------------------------------- |
| `blocks.text(s)`   | Plain text                                      |
| `blocks.markdown`  | Rendered markdown                               |
| `blocks.json(v)`   | Formatted JSON                                  |
| `blocks.image`     | Image from repo file or runtime artifact        |
| `blocks.audio`     | Audio from repo file or runtime artifact        |
| `blocks.video`     | Video from repo file or runtime artifact        |
| `blocks.file`      | Arbitrary file download                         |

File references are either repo files (`{ source: 'repo', path, mimeType? }`) or runtime artifacts produced via `span.addArtifact(...)` during a run.

```ts
displayInput: [
  blocks.image({ source: 'repo', path: 'evals/assets/receipt-1.png' }, 'Receipt'),
]
```

## CLI

```
agent-evals <command> [flags]

Commands:
  dev                 Start dev server with the UI (http://localhost:4100)
  list                List discovered evals
  run                 Run evals (all by default)

Flags:
  --eval <id[,id]>    Run specific evals only
  --case <id[,id]>    Run specific cases only
  --no-cache          Disable cache reads/writes for this run
  --trials <n>        Override trials per case
  --json              Emit run summary as JSON (run)
  --port <n>          Server port (dev, default: 4100)
```

`run` exits non-zero if any case fails or errors, making it CI-friendly.

## Caching

LLM calls are cached to local files keyed by input. The cache is inspectable and commit-friendly — check it in so teammates and CI reproduce the same trajectory. Use `--no-cache` (CLI) or the UI cache toggle to bypass the cache for a run when you want fresh model output.

## Status

v1 — local-first, single-user. No cloud sync, dashboards, or collaboration in this version.
