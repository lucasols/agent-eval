# agent-eval

Local-first, UI-first eval tool for LLM/agent systems. Author evals in strict TypeScript inside `*.eval.ts` files, run them manually from a minimal UI or the CLI, and inspect trajectory, cost, and inputs/outputs.

## Why

- **Real TypeScript evals** — author evals with `defineEval(...)`, normal TypeScript, scorers, and thrown-error assertions.
- **Manual runs by default** — no background re-runs on file save. You trigger runs from the UI or CLI.
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

3. **Open the UI** — `agent-evals app` serves it at `http://localhost:4100` (override with `--port`). The command prepares the UI automatically, so you do not need to start a separate web dev server. The UI gives you run controls, per-case results, trace drawer, and cost. The eval explorer updates automatically when matching `*.eval.ts` files are added, removed, or edited.

4. **Or use the CLI**:

   ```sh
   agent-evals list
   agent-evals run
   agent-evals run --eval my-agent --case greeting --json
   ```

   Run artifacts are persisted under `.agent-evals/runs/<run-id>/` with `run.json`, `summary.json`, per-case `cases.jsonl`, and trace JSON files for the executed cases.

A complete working example lives at [`examples/basic-agent`](./examples/basic-agent).

## Local development

From `examples/basic-agent`, run `pnpm eval app` for the same single-command flow a library user gets.

From the repo root, `pnpm dev` now starts the example-backed Hono server on `http://localhost:4100` together with the Vite web dev server on `http://localhost:4200`, so frontend changes get full HMR while `/api` stays pointed at the example workspace.

Use `pnpm dev:app` when you want to smoke-test the built app flow that `pnpm eval app` uses, and `pnpm dev:server` when you only need the backend. These repo-local dev scripts always use fixed ports so the server is consistently on `4100` and the Vite app is consistently on `4200`.

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

## Caching costly operations

Wrap a costly span (LLM call, remote tool, etc.) with `cache: { key }` to skip
execution on subsequent runs. The cache records every observable effect inside
the span — sub-spans, checkpoints, `setOutput` / `incrementOutput` calls,
final attributes — and replays them verbatim on hits, so traces, outputs, and
cost totals look identical to a fresh run.

```ts
await tracer.span(
  {
    kind: 'llm',
    name: 'plan-refund',
    cache: { key: { prompt: input.message, model: 'gpt-4o-mini' } },
  },
  async () => {
    const result = await llm.complete(input.message)
    span.setAttributes({ model: 'gpt-4o-mini', output: result })
    incrementOutput('costUsd', computeCost(result))
    return result
  },
)
```

Cached spans get `cache.status` in their attributes (`hit`, `miss`, `refresh`,
or `bypass`) plus `cache.key`, `cache.storedAt`, and `cache.age` (on hit).
These show as coloured badges in the trace tree.

### Cache controls

CLI:

- `--cache <use|bypass|refresh>` — mode for this run (default `use`).
- `--no-cache` — shortcut for `--cache bypass`.
- `--refresh-cache` — shortcut for `--cache refresh`.
- `--clear-cache` — wipe cache entries before the run starts.
- `pnpm eval cache list` — dump persisted entries (add `--json` for JSON).
- `pnpm eval cache clear --eval <id>` — drop entries for one eval.
- `pnpm eval cache clear --all` — drop every entry.

UI: every `EvalCard` has a split button next to **Run** with a chevron menu
containing the same four run modes plus a danger-toned "Clear cache for this
eval".

Server API (`/api/cache`):

- `GET /api/cache` — list entries.
- `DELETE /api/cache` — clear everything.
- `DELETE /api/cache/:namespace` — clear one namespace.
- `DELETE /api/cache/:namespace/:key` — drop a single entry.

### How it works

- Default namespace is `${evalId}__${spanName}`; override per-call with
  `cache.namespace` for sharing across evals.
- Entries live under `<workspaceRoot>/.agent-evals/cache/<namespace>/<sha256>.json`.
- The cache key folds in a `codeFingerprint` — the sha256 of the eval file's
  source — so editing the eval produces a miss instead of a stale hit.
- Modes: `bypass` never reads or writes; `refresh` skips the read and always
  writes; `use` reads on hit and writes on miss.
- Only SDK-mediated side effects replay (`tracer.span`, `tracer.checkpoint`,
  `setOutput`, `incrementOutput`, span attributes). External side effects
  (network, DB writes) do *not* replay on cache hits — use caching only for
  pure functions of their key.
- Return values are JSON round-tripped before storage; return JSON-safe values
  or carry richer data through `setOutput`.

Disable caching globally from `agent-evals.config.ts`:

```ts
export const config: AgentEvalsConfig = {
  include: ['evals/**/*.eval.ts'],
  cache: { enabled: false },
}
```

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
  app                        Start server with the UI (http://localhost:4100)
  list                       List discovered evals
  run                        Run evals (all by default)
  cache list                 List cached operation entries
  cache clear --eval <id>    Clear cache entries for one eval
  cache clear --all          Clear every cached entry

Flags:
  --eval <id[,id]>           Run specific evals only
  --case <id[,id]>           Run specific cases only
  --trials <n>               Override trials per case
  --json                     Emit run summary or cache listing as JSON
  --port <n>                 Server port (app, default: 4100)
  --cache <use|bypass|refresh>  Cache mode for this run (default: use)
  --no-cache                 Shortcut for --cache bypass
  --refresh-cache            Shortcut for --cache refresh
  --clear-cache              Clear the cache before starting the run
```

`run` exits non-zero if any case fails or errors, making it CI-friendly.

## Status

v1 — local-first, single-user. No cloud sync, dashboards, or collaboration in this version.
