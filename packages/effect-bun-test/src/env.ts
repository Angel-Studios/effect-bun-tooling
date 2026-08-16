import * as ConfigProvider from 'effect/ConfigProvider';
import * as Data from 'effect/Data';
import * as Effect from 'effect/Effect';
import type * as Layer from 'effect/Layer';

export const testConfigLayer = (map: Record<string, string>): Layer.Layer<never> =>
  ConfigProvider.layer(ConfigProvider.fromEnvRecord(map));

export class EnvScopeConflictError extends Data.TaggedError('EnvScopeConflictError')<{
  readonly key: string;
  readonly heldBy: string;
  readonly requestedBy: string;
  readonly message: string;
}> {}

type EnvSnapshot = ReadonlyArray<readonly [key: string, previous: string | undefined]>;

const heldKeys = new Map<string, string>();

let scopeSequence = 0;

const describeScope = (helper: string, keys: ReadonlyArray<string>): string =>
  `${helper}#${++scopeSequence} (keys: ${keys.join(', ')})`;

const conflictFor = (keys: ReadonlyArray<string>, requestedBy: string): EnvScopeConflictError | undefined => {
  for (const key of keys) {
    const heldBy = heldKeys.get(key);
    if (heldBy !== undefined) {
      return new EnvScopeConflictError({
        key,
        heldBy,
        requestedBy,
        message:
          `Overlapping env scope on "${key}": ${requestedBy} tried to override a key already held by ` +
          `${heldBy}. process.env is process-global and bun runs a file's tests in one process, so the ` +
          "two scopes would corrupt each other's restore and leak the value past both tests. Either " +
          'stop nesting/interleaving these scopes over the same key, or — preferably — move the ' +
          'subject onto Effect Config and use testConfigLayer({ ... }), which is concurrency-safe ' +
          'because it never mutates process.env.',
      });
    }
  }
  return undefined;
};

const acquireEnv = (overrides: Record<string, string | undefined>, label: string): EnvSnapshot => {
  const snapshot: Array<readonly [string, string | undefined]> = [];
  for (const [key, value] of Object.entries(overrides)) {
    snapshot.push([key, Object.hasOwn(process.env, key) ? process.env[key] : undefined]);
    heldKeys.set(key, label);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  return snapshot;
};

const releaseEnv = (snapshot: EnvSnapshot): void => {
  for (const [key, previous] of snapshot) {
    heldKeys.delete(key);
    if (previous === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = previous;
    }
  }
};

export const withTestEnv =
  (overrides: Record<string, string | undefined>) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.acquireUseRelease(
      Effect.suspend(() => {
        const keys = Object.keys(overrides);
        const label = describeScope('withTestEnv', keys);
        const conflict = conflictFor(keys, label);
        if (conflict !== undefined) {
          return Effect.die(conflict);
        }
        return Effect.succeed(acquireEnv(overrides, label));
      }),
      () => effect,
      (snapshot) => Effect.sync(() => releaseEnv(snapshot)),
    );

export const scopedEnv = (overrides: Record<string, string | undefined>): Disposable => {
  const keys = Object.keys(overrides);
  const label = describeScope('scopedEnv', keys);
  const conflict = conflictFor(keys, label);
  if (conflict !== undefined) {
    throw conflict;
  }
  let snapshot: EnvSnapshot | undefined = acquireEnv(overrides, label);
  return {
    [Symbol.dispose]: () => {
      if (snapshot !== undefined) {
        releaseEnv(snapshot);
        snapshot = undefined;
      }
    },
  };
};
