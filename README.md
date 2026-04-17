# agent-eval

Local-first, UI-first eval tool for LLM/agent systems. Author evals in strict TypeScript inside `*.eval.ts` files, run them manually from a minimal UI or the CLI, and inspect trajectory, cost, inputs/outputs, and cache usage. The cache is file-based and commit-friendly so eval runs stay reproducible.

## Why

- **Real TypeScript evals** — author evals with `defineEval(...)`, normal TypeScript, scorers, and thrown-error assertions.
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
   import { defineEval, setOutput, span, tracer } from '@agent-evals/sdk'
   import { myAgent } from '../src/agent'

   defineEval({
     id: 'my-agent',
     title: 'My Agent',
     cases: [
       { id: 'greeting', input: { message: 'hello' } },
       { id: 'farewell', input: { message: 'bye' } },
     ],
     execute: async ({ input }) => {
       await tracer.span(
         { kind: 'agent', name: 'my-agent' },
         async () => {
           span.setAttribute('input', input)
           const output = await myAgent(input)
           span.setAttribute('output', output)
           setOutput('output', output)
         },
       )
     },
     scores: {
       hasOutput: ({ outputs }) => {
         return outputs.output !== undefined ? 1 : 0
       },
     },
   })
   ```

3. **Open the UI** — `agent-evals app` serves it at `http://localhost:4100` (override with `--port`). The UI gives you run controls, per-case results, trace drawer, cost, and per-run cache toggle.

4. **Or use the CLI**:

   ```sh
   agent-evals list
   agent-evals run
   agent-evals run --eval my-agent --case greeting --json
   ```

   Run artifacts are persisted under `.agent-evals/runs/<run-id>/` with `run.json`, `summary.json`, per-case `cases.jsonl`, and trace JSON files for the executed cases.

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
| `traceDisplay`   | `TraceDisplayConfig?`                          | Global trace attribute display config for the UI                 |

## Writing evals

`defineEval` takes a single definition object:

| Field           | Required | Purpose                                                                          |
| --------------- | -------- | -------------------------------------------------------------------------------- |
| `id`            | yes      | Unique eval id                                                                   |
| `title`         |          | Display title                                                                    |
| `description`   |          | Free-text description                                                            |
| `cases`         | yes      | `EvalCase[]` or `() => Promise<EvalCase[]>` (async loader for dynamic datasets)  |
| `execute`       | yes      | `async ({ input, signal }) => { ... }`                                           |
| `traceDisplay`  |          | Per-eval trace attribute display overrides for the UI                             |
| `deriveFromTracing` |      | Derive output columns from the finished trace tree                               |
| `scores`        |          | Record of scoring functions returning `0..1`                                     |
| `columns`       |          | Custom columns shown in the results table                                        |
| `passThreshold` |          | Minimum average score for a case to pass                                         |

### Cases

```ts
cases: [
  {
    id: 'simple-text',
    input: { message: 'I want a refund', locale: 'en-US' },
  },
]
```

`columns` populates your custom columns.

### Execute and tracing

Wrap work in `tracer.span(...)` to get a trajectory tree in the UI. Span mutation is ambient, so helpers deeper in your call stack can write to the current span without threading a callback-local handle through your code:

```ts
execute: async ({ input }) => {
  await tracer.span(
    { kind: 'agent', name: 'refund-agent' },
    async () => {
      span.setAttribute('input', input)
      const result = await agent(input)
      span.setAttributes({
        model: 'gpt-4.1',
        output: result,
      })
      setOutput('output', result)
    },
  )
  tracer.checkpoint('final-state', { approved: true })
}
```

Use `traceDisplay` to tell the UI which attributes to promote in the trace tree and detail pane:

```ts
traceDisplay: {
  attributes: [
    { path: 'input', label: 'Input', format: 'json', placements: ['section'] },
    { path: 'output', label: 'Output', format: 'json', placements: ['section'] },
    { path: 'model', label: 'Model', placements: ['detail'] },
    {
      path: 'costUsd',
      label: 'Cost',
      format: 'usd',
      placements: ['tree', 'detail'],
      scope: 'subtree',
      mode: 'sum',
    },
    {
      key: 'costBrl',
      path: 'costUsd',
      label: 'Cost (BRL)',
      placements: ['detail'],
      scope: 'subtree',
      mode: 'sum',
      transform: ({ value }) =>
        typeof value === 'number'
          ? new Intl.NumberFormat('pt-BR', {
              style: 'currency',
              currency: 'BRL',
            }).format(value * 5.7)
          : value,
    },
  ],
}
```

Use `key` when you want to display the same source attribute more than once, such as USD and BRL views of the same `costUsd` value. `transform` runs in the runner and the UI receives the transformed result as plain data.

`scope` controls whether a value is read from the current span only (`'self'`) or from the whole span subtree (`'subtree'`). `mode` controls how multiple matching values are resolved: `'all'`, `'last'`, or `'sum'`.

### Scorers

```ts
scores: {
  mentionsRefund: ({ outputs }) => {
    return typeof outputs.output === 'string' && /refund/i.test(outputs.output) ?
      1
    : 0
  },
}
```

### Custom columns

```ts
columns: {
  locale: { label: 'Locale', kind: 'string', defaultVisible: true },
  toolCalls: { label: 'Tool Calls', kind: 'number', defaultVisible: true },
}
```

Populate values in `deriveFromTracing(...)` and/or from runtime outputs.

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
