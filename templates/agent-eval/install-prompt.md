# Install `@ls-stack/agent-eval`

Copy the prompt below into a coding agent to install and bootstrap
`@ls-stack/agent-eval` in a project. This is a one-time setup template, not a
skill. Once the project has `agent-evals.config.ts` plus a first eval, switch
to the `agent-eval` skill (sibling `SKILL.md`) for day-to-day authoring.

---

Install `@ls-stack/agent-eval` in this project and scaffold the minimum files
needed to author evals.

1. Detect the package manager (`pnpm-lock.yaml`, `yarn.lock`, `bun.lock`,
   `package-lock.json`) and add `@ls-stack/agent-eval` as a dev dependency
   with it. Do not switch package managers.
   - pnpm: `pnpm add -D @ls-stack/agent-eval`
   - npm: `npm install -D @ls-stack/agent-eval`
   - yarn: `yarn add -D @ls-stack/agent-eval`
   - bun: `bun add -d @ls-stack/agent-eval`

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

5. Ignore persisted run output. Cache files under `.agent-evals/cache/*.json`
   are bounded and may be committed when a project wants to share them. Append
   to `.gitignore` if the entries are not already there:

   ```gitignore
   .agent-evals/runs/
   .agent-evals/cache/*/
   .agent-evals/cache/*.tmp
   .agent-evals/cache/*.lock/
   ```

6. Install the `agent-eval` skill so future authoring work uses the authored
   SKILL instead of re-reading this install prompt. Detect the project's
   agent-skills directory in this order and use the first one that exists (do
   not create a new convention if none are present — ask the user which to
   use):
   - `.claude/skills/` (Claude Code)
   - `.cursor/skills/`
   - `.agents/skills/`
   - `skills/`

   Create `<skills-dir>/agent-eval/SKILL.md` by downloading the latest version
   from the project repo:

   ```sh
   mkdir -p <skills-dir>/agent-eval
   curl -fsSL \
     https://raw.githubusercontent.com/lucasols/agent-eval/main/templates/agent-eval/SKILL.md \
     -o <skills-dir>/agent-eval/SKILL.md
   ```

   Skip this step if `<skills-dir>/agent-eval/SKILL.md` already exists; tell
   the user to re-run the `curl` command themselves if they want to refresh
   it.

7. Verify the install by running `agent-evals list` with the detected package
   manager (for example `pnpm exec agent-evals list`). The placeholder eval
   should appear.

8. Do **not** add production tracing yet. Point the user at the `agent-eval`
   skill (`<skills-dir>/agent-eval/SKILL.md`) for authoring real evals and
   wiring `evalTracer` spans into product source code.

Report which steps ran, which were skipped (because the file already existed),
and the output of `agent-evals list`.
