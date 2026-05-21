import { z } from 'zod';
import { cacheModeSchema } from './cache.ts';

/** Lifecycle state for an app config reload triggered by `agent-evals.config.ts`. */
export const configReloadStatusSchema = z.enum([
  'idle',
  'pending',
  'reloading',
]);
/** Status for config reloads in the long-running app server. */
export type ConfigReloadStatus = z.infer<typeof configReloadStatusSchema>;

/** UI/API-visible state for config reloads in `agent-evals app`. */
export const configReloadStateSchema = z.object({
  status: configReloadStatusSchema,
  activeRunCount: z.number().int().min(0),
  lastChangedAt: z.string().nullable(),
  lastReloadedAt: z.string().nullable(),
});
/** UI/API-visible state for config reloads in `agent-evals app`. */
export type ConfigReloadState = z.infer<typeof configReloadStateSchema>;

/** Schema for the API request that starts a new eval run. */
export const createRunRequestSchema = z.object({
  target: z.object({
    mode: z.enum(['all', 'evalIds', 'caseIds']),
    /** Exact stable eval identities (`filePath + evalId`) selected by UI/API callers. */
    evalKeys: z.array(z.string()).optional(),
    /** Workspace-relative file paths or glob patterns used to filter selected evals. */
    files: z.array(z.string()).optional(),
    evalIds: z.array(z.string()).optional(),
    caseIds: z.array(z.string()).optional(),
    /** Vitest-style tag filter expressions; multiple entries combine with AND. */
    tagsFilter: z.array(z.string()).optional(),
  }),
  trials: z.number().min(1),
  /**
   * Persist this run as temporary history. Temporary runs are visible while
   * present, then deleted before the next run of any kind starts.
   */
  temporary: z.boolean().optional(),
  /**
   * Optional cache controls for the run. When omitted, the cache is used in
   * its default read-through / write-on-miss mode.
   */
  cache: z.object({ mode: cacheModeSchema.default('use') }).optional(),
  /**
   * Manual-input values keyed by eval `key` (workspace-relative file path
   * plus authored eval id). Required for any targeted eval that declares
   * `manualInput` in its definition; the server validates each entry against
   * the eval's authored Zod schema before starting the run.
   */
  manualInputs: z.record(z.string(), z.unknown()).optional(),
});
/** Request payload accepted by the run creation endpoint. */
export type CreateRunRequest = z.infer<typeof createRunRequestSchema>;

/** Schema for updating a UI-authored manual score on one persisted case. */
export const updateManualScoreRequestSchema = z.object({
  value: z.number().min(0).max(1).nullable(),
});
/** Request payload accepted by the manual score update endpoint. */
export type UpdateManualScoreRequest = z.infer<
  typeof updateManualScoreRequestSchema
>;
