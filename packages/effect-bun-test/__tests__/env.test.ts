import { Cause, Config, Effect, Exit, Fiber, Option } from 'effect';
import { EnvScopeConflictError, scopedEnv, testConfigLayer, withTestEnv } from '../src/env';
import { describe, expect, it } from '../src/index';

const freshKey = (suffix: string): string => `EFFECT_BUN_TEST_PROBE_${suffix}`;

const PRESENT_KEY: string = 'PATH';

type ConflictShape = {
  readonly _tag: string;
  readonly key: unknown;
  readonly heldBy: unknown;
  readonly requestedBy: unknown;
  readonly message: unknown;
};

const taggedDefect = (exit: Exit.Exit<unknown, unknown>): ConflictShape => {
  if (Exit.isSuccess(exit)) {
    throw new Error(`Expected a defect, but the Effect SUCCEEDED with: ${String(exit.value)}`);
  }
  // v4 flattened `Cause`; defects are read off the `reasons` array.
  const dies = exit.cause.reasons.filter(Cause.isDieReason);
  if (dies.length === 0) {
    throw new Error(`Expected a defect, but the Cause carried none.\n${Cause.pretty(exit.cause)}`);
  }
  const value = dies[0].defect;
  if (typeof value !== 'object' || value === null || !('_tag' in value)) {
    throw new Error(`Expected a TAGGED defect, but got: ${String(value)}`);
  }
  const tag = value._tag;
  if (typeof tag !== 'string') {
    throw new Error(`Expected a string _tag on the defect, but got: ${String(tag)}`);
  }
  return {
    _tag: tag,
    key: 'key' in value ? value.key : undefined,
    heldBy: 'heldBy' in value ? value.heldBy : undefined,
    requestedBy: 'requestedBy' in value ? value.requestedBy : undefined,
    message: 'message' in value ? value.message : undefined,
  };
};

// v4 rebuilt `Config` on `Schema`: a failed read is a `ConfigError` wrapping a
// `SchemaError` rather than a value carrying the v3 `_op: "MissingData"` tag.
// The assertion that still carries the original intent — the read FAILED, and
// the error names the key it could not resolve — is over the rendered message.
const configErrorMessage = (exit: Exit.Exit<unknown, unknown>): string => {
  if (Exit.isSuccess(exit)) {
    throw new Error(`Expected the Config read to FAIL, but it produced: ${String(exit.value)}`);
  }
  const failure = Cause.findErrorOption(exit.cause);
  if (Option.isNone(failure)) {
    throw new Error(`Expected a typed ConfigError failure.\n${Cause.pretty(exit.cause)}`);
  }
  const value = failure.value;
  if (typeof value !== 'object' || value === null || !('_tag' in value) || value._tag !== 'ConfigError') {
    throw new Error(`Expected a ConfigError, but got: ${String(value)}`);
  }
  return String(value);
};

describe('testConfigLayer', () => {
  it.effect('code reading Effect Config sees the mapped values', () =>
    Effect.gen(function* () {
      const host = yield* Config.string('HOST');
      const port = yield* Config.int('PORT');
      expect(host).toBe('example.test');
      expect(port).toBe(8080);
    }).pipe(Effect.provide(testConfigLayer({ HOST: 'example.test', PORT: '8080' }))),
  );

  it.effect('a key absent from the map is genuinely absent, not empty', () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(Config.string('NOT_IN_THE_MAP'));

      expect(configErrorMessage(exit)).toContain('NOT_IN_THE_MAP');
    }).pipe(Effect.provide(testConfigLayer({ SOMETHING_ELSE: 'x' }))),
  );

  it.effect('does NOT fall back to process.env for a key the map omits', () =>
    Effect.gen(function* () {
      const key = freshKey('CONFIG_NO_FALLBACK');

      using _env = scopedEnv({ [key]: 'present-in-real-env' });
      expect(process.env[key]).toBe('present-in-real-env');

      const exit = yield* Effect.exit(Config.string(key)).pipe(
        Effect.provide(testConfigLayer({ UNRELATED: 'x' })),
      );
      expect(configErrorMessage(exit)).toContain(key);
    }),
  );

  it.effect('mutates nothing: process.env is untouched by a provided config', () =>
    Effect.gen(function* () {
      const key = freshKey('CONFIG_NO_MUTATION');
      const value = yield* Config.string(key).pipe(Effect.provide(testConfigLayer({ [key]: 'in-map' })));
      expect(value).toBe('in-map');

      expect(key in process.env).toBe(false);
    }),
  );

  // Effect v4 changed this: v3's `ConfigProvider.fromMap` joined nested path
  // segments with "."; the v4 env-record provider joins them with "_", matching
  // ordinary environment-variable naming.
  it.effect('nested paths join with "_", the environment-variable convention', () =>
    Effect.gen(function* () {
      const nested = Config.nested(Config.string('HOST'), 'DB');

      const underscored = yield* nested.pipe(Effect.provide(testConfigLayer({ DB_HOST: 'db.example.test' })));
      expect(underscored).toBe('db.example.test');

      const dotted = yield* Effect.exit(nested).pipe(
        Effect.provide(testConfigLayer({ 'DB.HOST': 'db.example.test' })),
      );
      expect(configErrorMessage(dotted)).toContain('HOST');
    }),
  );
});

describe('withTestEnv', () => {
  it.effect('applies the override inside the effect', () =>
    Effect.gen(function* () {
      const key = freshKey('APPLIED');
      const seen = yield* Effect.sync(() => process.env[key]).pipe(withTestEnv({ [key]: 'inside' }));
      expect(seen).toBe('inside');
    }),
  );

  it.effect('a key that was ABSENT is restored as ABSENT, not as an empty string', () =>
    Effect.gen(function* () {
      const key = freshKey('ABSENT_STAYS_ABSENT');
      expect(key in process.env).toBe(false);

      yield* Effect.sync(() => {
        expect(process.env[key]).toBe('temporarily-set');
      }).pipe(withTestEnv({ [key]: 'temporarily-set' }));

      expect(key in process.env).toBe(false);
      expect(Object.hasOwn(process.env, key)).toBe(false);
    }),
  );

  it.effect('a key that WAS present is restored to its exact previous value', () =>
    Effect.gen(function* () {
      const original = process.env[PRESENT_KEY];
      expect(typeof original).toBe('string');

      const inside = yield* Effect.sync(() => process.env[PRESENT_KEY]).pipe(
        withTestEnv({ [PRESENT_KEY]: '/nonexistent/fake/path' }),
      );
      expect(inside).toBe('/nonexistent/fake/path');
      expect(process.env[PRESENT_KEY]).toBe(original);
    }),
  );

  it.effect('an `undefined` override DELETES the key for the duration', () =>
    Effect.gen(function* () {
      const original = process.env[PRESENT_KEY];

      const inside = yield* Effect.sync(() => ({
        present: PRESENT_KEY in process.env,
        value: process.env[PRESENT_KEY],
      })).pipe(withTestEnv({ [PRESENT_KEY]: undefined }));

      expect(inside.present).toBe(false);
      expect(inside.value).toBeUndefined();
      expect(process.env[PRESENT_KEY]).toBe(original);
    }),
  );

  it.effect('restores when the effect FAILS, not only when it succeeds', () =>
    Effect.gen(function* () {
      const key = freshKey('RESTORE_ON_FAILURE');
      const exit = yield* Effect.exit(
        Effect.gen(function* () {
          expect(process.env[key]).toBe('during');
          return yield* Effect.fail('deliberate' as const);
        }).pipe(withTestEnv({ [key]: 'during' })),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      expect(
        Option.getOrUndefined(Exit.isFailure(exit) ? Cause.findErrorOption(exit.cause) : Option.none()),
      ).toBe('deliberate');
      expect(key in process.env).toBe(false);
    }),
  );

  it.effect('restores when the fiber is INTERRUPTED', () =>
    Effect.gen(function* () {
      const key = freshKey('RESTORE_ON_INTERRUPT');
      const fiber = yield* Effect.forkChild(Effect.never.pipe(withTestEnv({ [key]: 'held' })));
      yield* Effect.yieldNow;
      expect(process.env[key]).toBe('held');

      yield* Fiber.interrupt(fiber);
      expect(key in process.env).toBe(false);
    }),
  );

  it.effect('snapshots and restores every key in a multi-key override', () =>
    Effect.gen(function* () {
      const absent = freshKey('MULTI_ABSENT');
      const originalPath = process.env[PRESENT_KEY];

      const inside = yield* Effect.sync(() => ({
        absent: process.env[absent],
        path: process.env[PRESENT_KEY],
      })).pipe(withTestEnv({ [absent]: 'a', [PRESENT_KEY]: '/fake' }));

      expect(inside).toEqual({ absent: 'a', path: '/fake' });
      expect(absent in process.env).toBe(false);
      expect(process.env[PRESENT_KEY]).toBe(originalPath);
    }),
  );
});

describe('scopedEnv', () => {
  it('applies on acquire and restores an ABSENT key as absent on dispose', () => {
    const key = freshKey('SCOPED_ABSENT');
    expect(key in process.env).toBe(false);
    {
      using _env = scopedEnv({ [key]: 'inside' });
      expect(process.env[key]).toBe('inside');
    }
    expect(key in process.env).toBe(false);
  });

  it('restores a PRESENT key to its exact previous value on dispose', () => {
    const original = process.env[PRESENT_KEY];
    {
      using _env = scopedEnv({ [PRESENT_KEY]: '/scoped/fake' });
      expect(process.env[PRESENT_KEY]).toBe('/scoped/fake');
    }
    expect(process.env[PRESENT_KEY]).toBe(original);
  });

  it('an `undefined` override deletes for the duration of the scope', () => {
    const original = process.env[PRESENT_KEY];
    {
      using _env = scopedEnv({ [PRESENT_KEY]: undefined });
      expect(PRESENT_KEY in process.env).toBe(false);
    }
    expect(process.env[PRESENT_KEY]).toBe(original);
  });

  it('disposal is idempotent', () => {
    const key = freshKey('SCOPED_IDEMPOTENT');
    const handle = scopedEnv({ [key]: 'v' });
    handle[Symbol.dispose]();
    expect(key in process.env).toBe(false);

    handle[Symbol.dispose]();
    expect(key in process.env).toBe(false);

    using _reacquired = scopedEnv({ [key]: 'again' });
    expect(process.env[key]).toBe('again');
  });
});

describe('EnvScopeConflictError', () => {
  it.effect('overlapping withTestEnv scopes on the SAME key die loudly', () =>
    Effect.gen(function* () {
      const key = freshKey('CONFLICT_SAME');
      const exit = yield* Effect.exit(
        Effect.void.pipe(withTestEnv({ [key]: 'inner' }), withTestEnv({ [key]: 'outer' })),
      );

      const defect = taggedDefect(exit);
      expect(defect._tag).toBe('EnvScopeConflictError');

      expect(defect.key).toBe(key);
      expect(String(defect.heldBy)).toContain('withTestEnv');
      expect(String(defect.requestedBy)).toContain('withTestEnv');
      expect(String(defect.message)).toContain(key);
    }),
  );

  it.effect('the honest negative: overlapping scopes on DIFFERENT keys are allowed', () =>
    Effect.gen(function* () {
      const first = freshKey('CONFLICT_DIFF_A');
      const second = freshKey('CONFLICT_DIFF_B');

      const seen = yield* Effect.sync(() => [process.env[first], process.env[second]]).pipe(
        withTestEnv({ [first]: 'a' }),
        withTestEnv({ [second]: 'b' }),
      );

      expect(seen).toEqual(['a', 'b']);
      expect(first in process.env).toBe(false);
      expect(second in process.env).toBe(false);
    }),
  );

  it.effect('a conflicting acquire applies NO overrides (all-or-nothing)', () =>
    Effect.gen(function* () {
      const contended = freshKey('CONFLICT_ATOMIC_HELD');
      const innocent = freshKey('CONFLICT_ATOMIC_FREE');

      const exit = yield* Effect.exit(
        Effect.void.pipe(
          withTestEnv({ [contended]: 'inner', [innocent]: 'should-never-be-applied' }),
          withTestEnv({ [contended]: 'outer' }),
        ),
      );

      expect(taggedDefect(exit)._tag).toBe('EnvScopeConflictError');

      expect(innocent in process.env).toBe(false);
    }),
  );

  it.effect('the registry does not leak the key after a conflict', () =>
    Effect.gen(function* () {
      const key = freshKey('CONFLICT_NO_LEAK');
      const exit = yield* Effect.exit(
        Effect.void.pipe(withTestEnv({ [key]: 'inner' }), withTestEnv({ [key]: 'outer' })),
      );
      expect(taggedDefect(exit)._tag).toBe('EnvScopeConflictError');

      const reacquired = yield* Effect.sync(() => process.env[key]).pipe(withTestEnv({ [key]: 'again' }));
      expect(reacquired).toBe('again');
      expect(key in process.env).toBe(false);
    }),
  );

  it.effect('scopedEnv and withTestEnv share one registry and conflict with each other', () =>
    Effect.gen(function* () {
      const key = freshKey('CONFLICT_CROSS_HELPER');
      using _held = scopedEnv({ [key]: 'held-by-scopedEnv' });

      const exit = yield* Effect.exit(Effect.void.pipe(withTestEnv({ [key]: 'requested' })));
      const defect = taggedDefect(exit);
      expect(defect._tag).toBe('EnvScopeConflictError');
      expect(defect.key).toBe(key);

      expect(String(defect.heldBy)).toContain('scopedEnv');
      expect(String(defect.requestedBy)).toContain('withTestEnv');

      expect(process.env[key]).toBe('held-by-scopedEnv');
    }),
  );

  it('scopedEnv THROWS the conflict rather than dying', () => {
    const key = freshKey('CONFLICT_SCOPED_THROWS');
    using _held = scopedEnv({ [key]: 'first' });

    let caught: unknown;
    try {
      scopedEnv({ [key]: 'second' });
    } catch (error) {
      caught = error;
    }

    if (typeof caught !== 'object' || caught === null || !('_tag' in caught)) {
      throw new Error(`Expected a tagged EnvScopeConflictError, got: ${String(caught)}`);
    }
    expect(caught._tag).toBe('EnvScopeConflictError');
    expect('key' in caught ? caught.key : undefined).toBe(key);

    expect(process.env[key]).toBe('first');
  });

  it('the error class is exported and carries the contended key on a named field', () => {
    const error = new EnvScopeConflictError({
      key: 'K',
      heldBy: 'holder',
      requestedBy: 'requester',
      message: 'msg',
    });
    expect(error._tag).toBe('EnvScopeConflictError');
    expect(error.key).toBe('K');
    expect(error.heldBy).toBe('holder');
    expect(error.requestedBy).toBe('requester');
    expect(error.message).toBe('msg');
  });

  it('its `message` is NON-ENUMERABLE, so an object spread drops the diagnostic', () => {
    const diagnostic = 'the entire human-readable diagnostic';
    const error = new EnvScopeConflictError({
      key: 'K',
      heldBy: 'holder',
      requestedBy: 'requester',
      message: diagnostic,
    });

    expect(error.message).toBe(diagnostic);
    expect(JSON.stringify(error)).toContain(diagnostic);

    expect(Object.getOwnPropertyDescriptor(error, 'message')?.enumerable).toBe(false);
    expect(Object.keys(error)).not.toContain('message');
    expect({ ...error }).not.toHaveProperty('message');

    expect(Object.getOwnPropertyNames(error)).toContain('message');
  });
});
