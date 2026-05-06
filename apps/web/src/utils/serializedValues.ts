const serializedValueMarker = '__aecs';
const jsonSafeVersion = 'v1';

type SerializedValueWrapper = {
  [serializedValueMarker]?: unknown;
  value?: unknown;
  length?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSerializedValueWrapper(
  value: unknown,
): value is SerializedValueWrapper {
  if (!isRecord(value)) return false;
  return serializedValueType(value) !== undefined;
}

function serializedValueType(
  value: SerializedValueWrapper,
): string | undefined {
  const marker = value[serializedValueMarker];
  if (typeof marker !== 'string') return undefined;
  if (!marker.startsWith(`${jsonSafeVersion}:`)) return undefined;
  return marker.slice(jsonSafeVersion.length + 1);
}

/** Revive values persisted by the SDK tagged serializer for display. */
export function deserializeSerializedValue(value: unknown): unknown {
  if (isSerializedValueWrapper(value)) return deserializeWrapper(value);
  if (Array.isArray(value)) return value.map(deserializeSerializedValue);
  if (!isRecord(value)) return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, entryValue]) => [
      key,
      deserializeSerializedValue(entryValue),
    ]),
  );
}

function deserializeWrapper(value: SerializedValueWrapper): unknown {
  switch (serializedValueType(value)) {
    case 'ArrayBuffer':
      return deserializeArrayBuffer(value.value);
    case 'BigInt':
      return deserializeBigInt(value.value);
    case 'Blob':
      return deserializeBlob(value.value);
    case 'Date':
      return typeof value.value === 'string'
        ? new Date(value.value)
        : value.value;
    case 'Error':
      return deserializeError(value.value);
    case 'File':
      return deserializeFile(value.value);
    case 'Float64Array':
      return deserializeFloat64Array(value.value, value.length);
    case 'Headers':
      return new Headers(deserializeStringPairArray(value.value));
    case 'Map':
      return new Map(deserializePairArray(value.value));
    case 'Number':
      return deserializeNumber(value.value);
    case 'Object':
      return Object.fromEntries(deserializeStringValuePairArray(value.value));
    case 'RegExp':
      return deserializeRegExp(value.value);
    case 'Set':
      return new Set(deserializeArray(value.value));
    case 'URL':
      return typeof value.value === 'string'
        ? new URL(value.value)
        : value.value;
    case 'URLSearchParams':
      return typeof value.value === 'string'
        ? new URLSearchParams(value.value)
        : value.value;
    case 'Undefined':
      return undefined;
    default:
      return value;
  }
}

function deserializeBigInt(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return BigInt(value);
  } catch {
    return value;
  }
}

function deserializeNumber(value: unknown): unknown {
  if (value === 'NaN') return NaN;
  if (value === 'Infinity') return Infinity;
  if (value === '-Infinity') return -Infinity;
  if (value === '-0') return -0;
  return value;
}

function deserializePairArray(value: unknown): [unknown, unknown][] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!Array.isArray(entry) || entry.length !== 2) return [];
    return [
      [
        deserializeSerializedValue(entry[0]),
        deserializeSerializedValue(entry[1]),
      ],
    ];
  });
}

function deserializeStringPairArray(value: unknown): [string, string][] {
  return deserializePairArray(value).flatMap(([key, entryValue]) => {
    if (typeof key !== 'string' || typeof entryValue !== 'string') return [];
    return [[key, entryValue]];
  });
}

function deserializeStringValuePairArray(value: unknown): [string, unknown][] {
  return deserializePairArray(value).flatMap(([key, entryValue]) => {
    if (typeof key !== 'string') return [];
    return [[key, entryValue]];
  });
}

function deserializeArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  return value.map(deserializeSerializedValue);
}

function deserializeRegExp(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const { flags, source } = value;
  if (typeof flags !== 'string' || typeof source !== 'string') return value;
  return new RegExp(source, flags);
}

function base64ToArrayBuffer(value: string): ArrayBuffer | undefined {
  try {
    const binary = globalThis.atob(value);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    );
  } catch {
    return undefined;
  }
}

function deserializeArrayBuffer(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  return base64ToArrayBuffer(value) ?? value;
}

function deserializeFloat64Array(value: unknown, length: unknown): unknown {
  const buffer = deserializeArrayBuffer(value);
  if (!(buffer instanceof ArrayBuffer) || typeof length !== 'number') {
    return value;
  }
  const view = new DataView(buffer);
  return Array.from({ length }, (_, index) => view.getFloat64(index * 8, true));
}

function deserializeBlob(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const { bytes, type } = value;
  if (typeof bytes !== 'string' || typeof type !== 'string') return value;
  const data = base64ToArrayBuffer(bytes);
  return data === undefined ? value : new Blob([data], { type });
}

function deserializeFile(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const { bytes, lastModified, name, type } = value;
  if (
    typeof bytes !== 'string' ||
    typeof lastModified !== 'number' ||
    typeof name !== 'string' ||
    typeof type !== 'string'
  ) {
    return value;
  }
  const data = base64ToArrayBuffer(bytes);
  if (data === undefined) return value;
  return new File([data], name, { lastModified, type });
}

function deserializeError(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const message = typeof value.message === 'string' ? value.message : '';
  const error = new Error(message);
  if (typeof value.name === 'string') error.name = value.name;
  if (typeof value.stack === 'string') error.stack = value.stack;
  return error;
}
