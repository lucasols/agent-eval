import type {
  CacheRecording,
  CacheRecordingOp,
  SerializedCacheSpan,
} from '@agent-evals/shared';
import { fromJSON, toJSONAsync, type SerovalJSON } from 'seroval';
import {
  AbortSignalPlugin,
  BlobPlugin,
  CustomEventPlugin,
  DOMExceptionPlugin,
  EventPlugin,
  FilePlugin,
  FormDataPlugin,
  HeadersPlugin,
  ImageDataPlugin,
  ReadableStreamPlugin,
  RequestPlugin,
  ResponsePlugin,
  URLPlugin,
  URLSearchParamsPlugin,
} from 'seroval-plugins/web';

const serializedCacheValueMarker = '__agentEvalsCacheSerialization';
const serializedCacheValueVersion = 'seroval-web-v1';
const serovalWebPlugins = [
  AbortSignalPlugin,
  BlobPlugin,
  CustomEventPlugin,
  DOMExceptionPlugin,
  EventPlugin,
  FilePlugin,
  FormDataPlugin,
  HeadersPlugin,
  ImageDataPlugin,
  ReadableStreamPlugin,
  RequestPlugin,
  ResponsePlugin,
  URLPlugin,
  URLSearchParamsPlugin,
];

type SerializedCacheValue = {
  [serializedCacheValueMarker]: typeof serializedCacheValueVersion;
  value: SerovalJSON;
};

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSerializedCacheValue(value: unknown): value is SerializedCacheValue {
  return (
    isRecordLike(value) &&
    value[serializedCacheValueMarker] === serializedCacheValueVersion
  );
}

/** Serialize one cached value with Seroval plus the Web API plugin set. */
export async function serializeCacheValue(value: unknown): Promise<unknown> {
  return {
    [serializedCacheValueMarker]: serializedCacheValueVersion,
    value: await toJSONAsync(value, { plugins: serovalWebPlugins }),
  };
}

/** Revive one cached value, while preserving legacy JSON-round-tripped data. */
export function deserializeCacheValue(value: unknown): unknown {
  if (!isSerializedCacheValue(value)) return value;
  return fromJSON<unknown>(value.value, { plugins: serovalWebPlugins });
}

/** Clone one value through the same Seroval path used for persisted cache data. */
export async function cloneCacheValue(value: unknown): Promise<unknown> {
  return deserializeCacheValue(await serializeCacheValue(value));
}

async function serializeRecordValues(
  record: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const entries: [string, unknown][] = [];
  for (const [key, value] of Object.entries(record)) {
    entries.push([key, await serializeCacheValue(value)]);
  }
  return Object.fromEntries(entries);
}

function deserializeRecordValues(
  record: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [
      key,
      deserializeCacheValue(value),
    ]),
  );
}

async function serializeCacheRecordingOp(
  op: CacheRecordingOp,
): Promise<CacheRecordingOp> {
  switch (op.kind) {
    case 'setOutput':
    case 'appendOutput':
      return { ...op, value: await serializeCacheValue(op.value) };
    case 'mergeOutput':
      return { ...op, patch: await serializeRecordValues(op.patch) };
    case 'incrementOutput':
      return op;
    case 'checkpoint':
      return { ...op, data: await serializeCacheValue(op.data) };
    case 'subSpan':
      return { ...op, span: await serializeCacheSpan(op.span) };
  }
}

function deserializeCacheRecordingOp(op: CacheRecordingOp): CacheRecordingOp {
  switch (op.kind) {
    case 'setOutput':
    case 'appendOutput':
      return { ...op, value: deserializeCacheValue(op.value) };
    case 'mergeOutput':
      return { ...op, patch: deserializeRecordValues(op.patch) };
    case 'incrementOutput':
      return op;
    case 'checkpoint':
      return { ...op, data: deserializeCacheValue(op.data) };
    case 'subSpan':
      return { ...op, span: deserializeCacheSpan(op.span) };
  }
}

async function serializeCacheSpan(
  span: SerializedCacheSpan,
): Promise<SerializedCacheSpan> {
  return {
    ...span,
    attributes:
      span.attributes === undefined
        ? undefined
        : await serializeRecordValues(span.attributes),
    children: await Promise.all(span.children.map(serializeCacheSpan)),
  };
}

function deserializeCacheSpan(span: SerializedCacheSpan): SerializedCacheSpan {
  return {
    ...span,
    attributes:
      span.attributes === undefined
        ? undefined
        : deserializeRecordValues(span.attributes),
    children: span.children.map(deserializeCacheSpan),
  };
}

/** Serialize all rich values captured in a cache recording before persistence. */
export async function serializeCacheRecording(
  recording: CacheRecording,
): Promise<CacheRecording> {
  return {
    ...recording,
    returnValue: await serializeCacheValue(recording.returnValue),
    finalAttributes: await serializeRecordValues(recording.finalAttributes),
    ops: await Promise.all(recording.ops.map(serializeCacheRecordingOp)),
  };
}

/** Revive all rich values captured in a cache recording after lookup. */
export function deserializeCacheRecording(
  recording: CacheRecording,
): CacheRecording {
  return {
    ...recording,
    returnValue: deserializeCacheValue(recording.returnValue),
    finalAttributes: deserializeRecordValues(recording.finalAttributes),
    ops: recording.ops.map(deserializeCacheRecordingOp),
  };
}
