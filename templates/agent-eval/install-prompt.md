# Install `@ls-stack/agent-eval`

Copy the prompt below into a coding agent to install and bootstrap
`@ls-stack/agent-eval` in a project. This is a one-time setup template, not a
skill. Once the project has `agent-evals.config.ts` plus a first eval, switch
to the bundled `agent-eval` skill for day-to-day authoring.

---

Install `@ls-stack/agent-eval` and `zod` in this project and scaffold the
minimum files needed to author evals.

1. Detect the package manager (`pnpm-lock.yaml`, `yarn.lock`, `bun.lock`,
   `package-lock.json`) and add `@ls-stack/agent-eval` plus `zod` as dev
   dependencies with it. Do not switch package managers.
   - pnpm: `pnpm add -D @ls-stack/agent-eval zod`
   - npm: `npm install -D @ls-stack/agent-eval zod`
   - yarn: `yarn add -D @ls-stack/agent-eval zod`
   - bun: `bun add -d @ls-stack/agent-eval zod`

2. Create `agent-evals.config.ts` at the repo root if it does not exist:

   ```ts
   import type { AgentEvalsConfig } from '@ls-stack/agent-eval';

   export const config: AgentEvalsConfig = { include: ['evals/**/*.eval.ts'] };
   ```

3. Create an `evals/` directory at the repo root if it does not exist. Add a
   single placeholder eval (`evals/smoke.eval.ts`) that imports
   `defineEval` and `setEvalOutput` from `@ls-stack/agent-eval` and declares
   one case. Keep it minimal — it is a wiring check, not real coverage.

4. Add convenience scripts to `package.json` if they are not already present:

   ```json
   {
     "scripts": {
       "eval": "agent-evals",
       "eval:run": "agent-evals run",
       "eval:app": "agent-evals app"
     }
   }
   ```

   `agent-evals run` requires `--eval` or `--case` by default. Keep that
   safety default unless the user explicitly wants unfiltered CLI runs; in that
   case set `allowCliRunAll: true` in `agent-evals.config.ts`.

5. Ignore persisted run output and raw cache-key debug data. Cache files under
   `.agent-evals/cache/**/*.json.br` plus `.agent-evals/cache/**/.index-*.json`
   are bounded and may be committed when a project wants to share them. Debug
   files under `.agent-evals/cache-debug/`
   may contain prompts, user inputs, full serialized cache payloads, or other
   sensitive data and should stay local. Temporary caches under
   `.agent-evals/tmp/` are local-only and should also stay ignored. Append to
   `.gitignore` if the entries are not already there:

   ```gitignore
   .agent-evals/runs/
   .agent-evals/cache/**
   !.agent-evals/cache/**/
   !.agent-evals/cache/**/*.json.br
   !.agent-evals/cache/**/.index-*.json
   .agent-evals/cache-debug/
   .agent-evals/tmp/
   ```

6. Symlink the bundled `agent-eval` skill folder into the project's local
   `skills/` directory if `skills/agent-eval` does not already exist:

   ```sh
   mkdir -p skills
   ln -s ../node_modules/@ls-stack/agent-eval/skills/agent-eval skills/agent-eval
   ```

   If `skills/agent-eval` already exists, leave it in place and report that
   the symlink step was skipped.

7. Verify the install by running `agent-evals list` and `agent-evals show-runs`
   with the detected package manager (for example
   `pnpm exec agent-evals list`). The placeholder eval should appear, and
   `agent-evals show-runs` should either list saved runs or report that there
   are no saved runs yet.

8. Do **not** add production tracing yet. Point the user at the bundled
   `agent-eval` skill for authoring real evals and wiring `evalTracer` spans
   into product source code.

Report which steps ran, which were skipped (because the file already existed),
and the output of `agent-evals list` plus `agent-evals show-runs`.
