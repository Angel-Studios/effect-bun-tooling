import { Effect, Layer, Logger, LogLevel } from 'effect';

export type CapturedLog = {
  readonly level: string;
  readonly message: string;
  readonly raw: unknown;
};

const MAX_DEPTH = 6;

const unrenderableMarker = (error: unknown): string =>
  `[unrenderable: ${error instanceof Error ? error.message : String(error)}]`;

export const renderLogMessage = (value: unknown, depth = 0, ancestorPath?: WeakSet<object>): string => {
  if (typeof value === 'string') return value;
  if (typeof value === 'bigint') return `${value}n`;
  if (value === null || value === undefined || typeof value !== 'object') return String(value);

  if (depth >= MAX_DEPTH) return '[depth-limit]';
  const path = ancestorPath ?? new WeakSet<object>();
  if (path.has(value)) return '[circular]';
  path.add(value);
  try {
    return renderObject(value, depth, path);
  } catch (e) {
    return unrenderableMarker(e);
  } finally {
    path.delete(value);
  }
};

const renderBuiltinWithNoOwnEnumerableProperties = (
  value: object,
  next: (v: unknown) => string,
): string | undefined => {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString();
  if (value instanceof RegExp) return String(value);
  if (value instanceof Map) {
    return `Map{${[...value.entries()].map(([k, v]) => `${next(k)}: ${next(v)}`).join(', ')}}`;
  }
  if (value instanceof Set) return `Set{${[...value].map(next).join(', ')}}`;
  if (ArrayBuffer.isView(value)) {
    const view = value as unknown as ArrayLike<number>;
    return `${value.constructor.name}[${Array.from(view).join(', ')}]`;
  }
  return undefined;
};

const renderObject = (value: object, depth: number, ancestorPath: WeakSet<object>): string => {
  const next = (v: unknown): string => renderLogMessage(v, depth + 1, ancestorPath);

  if (value instanceof Error) {
    const base = `${value.name}: ${value.message}`;
    return value.cause === undefined ? base : `${base} (cause: ${next(value.cause)})`;
  }
  if (Array.isArray(value)) return value.map(next).join(' ');

  const builtin = renderBuiltinWithNoOwnEnumerableProperties(value, next);
  if (builtin !== undefined) return builtin;

  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return '{}';
  return `{${entries.map(([k, v]) => `${k}: ${next(v)}`).join(', ')}}`;
};

export type LogCapture = {
  readonly layer: Layer.Layer<never>;
  readonly entries: ReadonlyArray<CapturedLog>;
  readonly messages: () => ReadonlyArray<string>;
  readonly text: () => string;
  readonly logs: Effect.Effect<ReadonlyArray<string>>;
};

const LEAVE_AMBIENT_LOG_LEVEL = null;
const DEFAULT_MINIMUM_LOG_LEVEL = LogLevel.Debug;

type MinimumLogLevel = LogLevel.LogLevel | typeof LEAVE_AMBIENT_LOG_LEVEL;

export type LogCaptureOptions = {
  readonly mode?: 'replace' | 'add';
  readonly minimumLogLevel?: MinimumLogLevel;
};

const withMinimumLogLevel = (base: Layer.Layer<never>, level: MinimumLogLevel): Layer.Layer<never> =>
  level === LEAVE_AMBIENT_LOG_LEVEL ? base : Layer.merge(base, Logger.minimumLogLevel(level));

export const makeLogCapture = (options: LogCaptureOptions = {}): LogCapture => {
  const entries: CapturedLog[] = [];
  const logger = Logger.make(({ logLevel, message }) => {
    entries.push({ level: logLevel.label, message: renderLogMessage(message), raw: message });
  });
  const base = options.mode === 'add' ? Logger.add(logger) : Logger.replace(Logger.defaultLogger, logger);
  const level = options.minimumLogLevel === undefined ? DEFAULT_MINIMUM_LOG_LEVEL : options.minimumLogLevel;
  const layer = withMinimumLogLevel(base, level);
  const messages = () => entries.map((e) => e.message);
  return {
    layer,
    entries,
    messages,
    text: () => messages().join('\n'),
    logs: Effect.sync(messages),
  };
};
