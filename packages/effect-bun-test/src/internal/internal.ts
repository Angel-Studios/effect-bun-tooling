import { afterAll, beforeAll, describe, test } from 'bun:test';
import * as Cause from 'effect/Cause';
import * as Data from 'effect/Data';
import * as Duration from 'effect/Duration';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as Fiber from 'effect/Fiber';
import { flow, identity } from 'effect/Function';
import * as Layer from 'effect/Layer';
import * as Logger from 'effect/Logger';
import { isObject } from 'effect/Predicate';
import * as Schedule from 'effect/Schedule';
import * as Schema from 'effect/Schema';
import * as Scope from 'effect/Scope';
import * as fc from 'effect/testing/FastCheck';
import * as TestClock from 'effect/testing/TestClock';

import type * as BunTest from '../types';

type TestServices = BunTest.TestServices;

type BunTestFn = (ctx?: never) => unknown;

type BunOptions = { timeout?: number; retry?: number; repeats?: number };

type BunRegistrar = (name: string, fn: BunTestFn, options?: number | BunOptions) => void;

type BunEachRegistrar<T> = {
  (name: string, fn: (value: T) => unknown, options?: number | BunOptions): void;
  skip: BunEachRegistrar<T>;
  only: BunEachRegistrar<T>;
  todo: BunEachRegistrar<T>;
  failing: BunEachRegistrar<T>;
};

interface BunTestApi extends BunRegistrar {
  skip: BunRegistrar;
  only: BunRegistrar;
  todo: BunRegistrar;
  failing: BunRegistrar;
  if: (condition: unknown) => BunRegistrar;
  skipIf: (condition: unknown) => BunRegistrar;
  todoIf: (condition: unknown) => BunRegistrar;
  each: <T>(cases: ReadonlyArray<T>) => BunEachRegistrar<T>;
}

const bunTest = test as unknown as BunTestApi;

type TestCallback = () => void | Promise<void>;

type TestContextInternal = BunTest.TestContext & {
  readonly __finished: Array<TestCallback>;
  readonly __failed: Array<TestCallback>;
};

const makeContext = (): TestContextInternal => {
  const onFinished: Array<TestCallback> = [];
  const onFailed: Array<TestCallback> = [];
  return {
    signal: new AbortController().signal,
    onTestFinished(fn) {
      onFinished.push(fn);
    },
    onTestFailed(fn) {
      onFailed.push(fn);
    },

    __finished: onFinished,
    __failed: onFailed,
  };
};

// A registered `onTestFinished` / `onTestFailed` callback is user code that may
// be sync or async and is allowed to blow up: its failure must never mask the
// test's own outcome. `ignoreCause` discards failures, defects and interrupts
// alike, which is what the original `try { await cb() } catch {}` did.
const runCallback = (cb: TestCallback): Effect.Effect<void> =>
  Effect.suspend(() => Effect.promise(() => Promise.resolve(cb()))).pipe(Effect.ignoreCause);

const flush = (ctx: TestContextInternal, failed: boolean): Effect.Effect<void> =>
  Effect.forEach(failed ? [...ctx.__failed, ...ctx.__finished] : ctx.__finished, runCallback, {
    discard: true,
  });

const toBunOptions = (opts?: number | BunTest.TestOptions): number | BunOptions | undefined => {
  if (opts === undefined) return undefined;
  if (typeof opts === 'number') return opts;
  const out: BunOptions = {};
  if (opts.timeout !== undefined) out.timeout = opts.timeout;
  if (opts.retry !== undefined) out.retry = opts.retry;
  if (opts.repeats !== undefined) out.repeats = opts.repeats;
  return out;
};

const splitArgs = (
  second: BunTest.TestOptions | BunTestFn,
  third?: BunTestFn | number | BunTest.TestOptions,
): readonly [number | BunTest.TestOptions | undefined, BunTestFn] =>
  typeof second === 'function'
    ? [third as number | BunTest.TestOptions | undefined, second]
    : [second, third as BunTestFn];

const baseCollector = ((
  name: string,
  second: BunTest.TestOptions | BunTestFn,
  third?: BunTestFn | number | BunTest.TestOptions,
): void => {
  const [opts, fn] = splitArgs(second, third);

  const o = isObject(opts) ? (opts as BunTest.TestOptions) : undefined;
  if (o?.todo === true) {
    bunTest.todo(name, fn, toBunOptions(opts));
    return;
  }
  if (o?.fails === true) {
    bunTest.failing(name, fn, toBunOptions(opts));
    return;
  }
  if (o?.only === true) {
    bunTest.only(name, fn, toBunOptions(opts));
    return;
  }
  if (o?.skip === true) {
    bunTest.skip(name, fn, toBunOptions(opts));
    return;
  }
  bunTest(name, fn, toBunOptions(opts));
}) as unknown as BunTest.API;

const makeRegistrar = (register: BunRegistrar): BunTest.API =>
  ((
    name: string,
    second: BunTest.TestOptions | BunTestFn,
    third?: BunTestFn | number | BunTest.TestOptions,
  ): void => {
    const [opts, fn] = splitArgs(second, third);
    register(name, fn, toBunOptions(opts));
  }) as unknown as BunTest.API;

const makeLazyRegistrar = (resolve: () => BunRegistrar): BunTest.API =>
  ((
    name: string,
    second: BunTest.TestOptions | BunTestFn,
    third?: BunTestFn | number | BunTest.TestOptions,
  ): void => {
    const [opts, fn] = splitArgs(second, third);
    resolve()(name, fn, toBunOptions(opts));
  }) as unknown as BunTest.API;

type ForFn<T> = (arg: T, ctx: BunTest.TestContext) => unknown | Promise<unknown>;

const makeForRegistrar =
  <T>(cases: ReadonlyArray<T>) =>
  (
    name: string,
    optsOrFn: number | BunTest.TestOptions | ForFn<T>,
    maybeFnOrOpts?: ForFn<T> | number | BunTest.TestOptions,
  ): void => {
    const fnFirst = typeof optsOrFn === 'function';
    const fn = fnFirst ? optsOrFn : (maybeFnOrOpts as ForFn<T> | undefined);
    const opts = fnFirst
      ? (maybeFnOrOpts as number | BunTest.TestOptions | undefined)
      : (optsOrFn as number | BunTest.TestOptions);
    if (fn === undefined) {
      throw new TypeError(`it.for(...)("${name}") was called without a test function`);
    }

    const o = isObject(opts) ? (opts as BunTest.TestOptions) : undefined;
    const cased = bunTest.each(cases);
    const register =
      o?.todo === true
        ? cased.todo
        : o?.fails === true
          ? cased.failing
          : o?.only === true
            ? cased.only
            : o?.skip === true
              ? cased.skip
              : cased;

    register(name, (value) => fn(value, makeContext()), toBunOptions(opts));
  };

export type DefaultApi = BunTest.API & {
  skip: BunTest.API;
  only: BunTest.API;
  skipIf: (condition: unknown) => BunTest.API;
  runIf: (condition: unknown) => BunTest.API;
  fails: BunTest.API;
  for: <T>(
    cases: ReadonlyArray<T>,
  ) => (
    name: string,
    optsOrFn: number | BunTest.TestOptions | ForFn<T>,
    maybeFnOrOpts?: ForFn<T> | number | BunTest.TestOptions,
  ) => void;
};

const makeDefaultApi = (): DefaultApi =>
  Object.assign(
    ((...args: ReadonlyArray<unknown>) =>
      (baseCollector as unknown as (...forwarded: ReadonlyArray<unknown>) => void)(
        ...args,
      )) as unknown as BunTest.API,
    {
      skip: makeRegistrar(bunTest.skip),

      only: makeLazyRegistrar(() => bunTest.only),
      skipIf: (condition: unknown) => makeRegistrar(bunTest.skipIf(condition)),
      runIf: (condition: unknown) => makeRegistrar(bunTest.if(condition)),
      fails: makeRegistrar(bunTest.failing),
      for: makeForRegistrar,
    },
  );

export const defaultApi: DefaultApi = makeDefaultApi();

// The value the returned promise rejects with. `Effect.die` is the vehicle
// rather than `Effect.fail` because `runPromise` squashes the cause back out
// again, so a defect reaches bun:test as the pretty `Error` itself — with its
// stack intact — instead of a wrapped failure.
const toDefect = <E>(cause: Cause.Cause<E>): Effect.Effect<unknown> =>
  Effect.gen(function* () {
    if (Cause.hasInterruptsOnly(cause)) {
      return new Error('All fibers interrupted without errors.');
    }
    const errors = Cause.prettyErrors(cause);

    for (let i = 1; i < errors.length; i++) {
      yield* Effect.logError(errors[i]);
    }
    return errors[0];
  });

const runPromise =
  (ctx?: TestContextInternal) =>
  <A, E>(effect: Effect.Effect<A, E>): Promise<A> =>
    Effect.runPromise(
      Effect.gen(function* () {
        const exitFiber = yield* effect.pipe(Effect.exit, Effect.forkChild);

        const exit = yield* Fiber.join(exitFiber);
        if (Exit.isSuccess(exit)) {
          if (ctx !== undefined) yield* flush(ctx, false);
          return exit.value;
        }

        const defect = yield* toDefect(exit.cause);
        if (ctx !== undefined) yield* flush(ctx, true);
        return yield* Effect.die(defect);
      }),
      { signal: ctx?.signal },
    );

const runTest =
  (ctx?: TestContextInternal) =>
  <A, E>(effect: Effect.Effect<A, E>): Promise<A> =>
    runPromise(ctx)(effect);

/**
 * The services an `it.effect` test runs on.
 *
 * v3 shipped this as `TestContext.TestContext`; v4 removed both `TestContext`
 * and `TestServices`, so the harness composes it: the virtual-time `TestClock`,
 * with the default logger silenced so a passing test prints nothing. `Logger`
 * is now a set-valued `Context.Reference`, so an empty logger list replaces
 * v3's `Logger.remove(Logger.defaultLogger)`.
 */
const TestEnv: Layer.Layer<TestServices> = Layer.provideMerge(TestClock.layer(), Logger.layer([]));

export const addEqualityTesters = () => {};

type AnyArbitrary = fc.Arbitrary<unknown>;

type VariadicAsyncProperty = (...args: Array<unknown>) => fc.IAsyncPropertyWithHooks<Array<unknown>>;
type VariadicProperty = (...args: Array<unknown>) => fc.IPropertyWithHooks<Array<unknown>>;

const asyncPropertyVariadic = fc.asyncProperty as unknown as VariadicAsyncProperty;
const propertyVariadic = fc.property as unknown as VariadicProperty;

// v4 removed the standalone `Arbitrary` module; schema-derived arbitraries now
// come from `Schema.toArbitrary`, which returns a factory taking the FastCheck
// namespace rather than a ready-made arbitrary.
const toArbitrary = (arbitrary: Schema.Constraint | AnyArbitrary): AnyArbitrary =>
  Schema.isSchema(arbitrary)
    ? (Schema.toArbitrary(arbitrary)(fc) as AnyArbitrary)
    : (arbitrary as AnyArbitrary);

const toArbitraryList = (arbitraries: ReadonlyArray<Schema.Constraint | AnyArbitrary>): Array<AnyArbitrary> =>
  arbitraries.map(toArbitrary);

const toArbitraryRecord = (
  arbitraries: Readonly<Record<string, Schema.Constraint | AnyArbitrary>>,
): Record<string, AnyArbitrary> => {
  const result: Record<string, AnyArbitrary> = {};
  for (const key of Object.keys(arbitraries)) {
    result[key] = toArbitrary(arbitraries[key]);
  }
  return result;
};

const fastCheckParams = <Ts>(timeout: unknown): fc.Parameters<Ts> =>
  isObject(timeout) && 'fastCheck' in timeout ? (timeout['fastCheck'] as fc.Parameters<Ts>) : {};

const toTestOptions = (
  timeout: number | (BunTest.TestOptions & { fastCheck?: unknown }) | undefined,
): number | BunTest.TestOptions | undefined => timeout;

type ArbitraryList = ReadonlyArray<Schema.Constraint | AnyArbitrary>;
type ArbitraryRecord = Readonly<Record<string, Schema.Constraint | AnyArbitrary>>;

const makeTester = <R>(
  mapEffect: <A, E>(self: Effect.Effect<A, E, R>) => Effect.Effect<A, E, never>,
  it: BunTest.API = defaultApi,
): BunTest.Tester<R> => {
  const run = <A, E, TestArgs extends Array<unknown>>(
    ctx: TestContextInternal,
    args: TestArgs,
    self: BunTest.TestFunction<A, E, R, TestArgs>,
  ): Promise<A> => Effect.suspend(() => self(...args)).pipe(mapEffect, runTest(ctx));

  const register =
    (api: BunTest.API): BunTest.Test<R> =>
    (name, self, timeout) =>
      api(
        name,
        () => {
          const c = makeContext();
          return run(c, [c], self);
        },
        timeout,
      );

  const f = register(it);
  const skip = register(defaultApi.skip);

  const only = register(defaultApi.only);
  const fails = register(defaultApi.fails);

  const skipIf: BunTest.Tester<R>['skipIf'] = (condition) => register(defaultApi.skipIf(condition));
  const runIf: BunTest.Tester<R>['runIf'] = (condition) => register(defaultApi.runIf(condition));

  const each: BunTest.Tester<R>['each'] = (cases) => (name, self, timeout) =>
    defaultApi.for(cases)(
      name,
      (arg) => {
        const c = makeContext();
        return run(c, [arg], self);
      },
      timeout,
    );

  const prop: BunTest.Tester<R>['prop'] = (name, arbitraries, self, timeout) => {
    const runProp = self as unknown as BunTest.TestFunction<boolean | undefined, unknown, R, Array<unknown>>;

    if (Array.isArray(arbitraries)) {
      const arbs = toArbitraryList(arbitraries as ArbitraryList);
      return it(
        name,
        () => {
          const c = makeContext();
          return fc.assert(
            asyncPropertyVariadic(...arbs, (...values: Array<unknown>) => run(c, [values, c], runProp)),
            fastCheckParams<Array<unknown>>(timeout),
          );
        },
        toTestOptions(timeout),
      );
    }

    const arbs = fc.record(toArbitraryRecord(arbitraries as ArbitraryRecord));
    return it(
      name,
      () => {
        const c = makeContext();
        return fc.assert(
          fc.asyncProperty(arbs, (values) => run(c, [values, c], runProp)),
          fastCheckParams<[Record<string, unknown>]>(timeout),
        );
      },
      toTestOptions(timeout),
    );
  };

  return Object.assign(f, { skip, skipIf, runIf, only, each, fails, prop });
};

export const prop: BunTest.Methods['prop'] = (name, arbitraries, self, timeout) => {
  const runProp = self as unknown as (properties: unknown, ctx: BunTest.TestContext) => void;

  if (Array.isArray(arbitraries)) {
    const arbs = toArbitraryList(arbitraries as ArbitraryList);
    return defaultApi(
      name,
      () => {
        const c = makeContext();
        return fc.assert(
          propertyVariadic(...arbs, (...values: Array<unknown>) => runProp(values, c)),
          fastCheckParams<Array<unknown>>(timeout),
        );
      },
      toTestOptions(timeout),
    );
  }

  const arbs = fc.record(toArbitraryRecord(arbitraries as ArbitraryRecord));
  return defaultApi(
    name,
    () => {
      const c = makeContext();
      return fc.assert(
        fc.property(arbs, (values) => runProp(values, c)),
        fastCheckParams<[Record<string, unknown>]>(timeout),
      );
    },
    toTestOptions(timeout),
  );
};

export const layer =
  <R, E, const ExcludeTestServices extends boolean = false>(
    layer_: Layer.Layer<R, E>,
    options?: {
      readonly memoMap?: Layer.MemoMap;
      readonly timeout?: Duration.Input;
      readonly excludeTestServices?: ExcludeTestServices;
    },
  ): {
    (f: (it: BunTest.MethodsNonLive<R, ExcludeTestServices>) => void): void;
    (name: string, f: (it: BunTest.MethodsNonLive<R, ExcludeTestServices>) => void): void;
  } =>
  (
    ...args:
      | [name: string, f: (it: BunTest.MethodsNonLive<R, ExcludeTestServices>) => void]
      | [f: (it: BunTest.MethodsNonLive<R, ExcludeTestServices>) => void]
  ) => {
    const excludeTestServices = options?.excludeTestServices ?? false;
    const withTestEnv = excludeTestServices
      ? (layer_ as Layer.Layer<R | TestServices, E>)
      : Layer.provideMerge(layer_, TestEnv);
    // Both are pure constructors, so the `*Unsafe` variants build them directly
    // instead of spinning up a fiber per `layer()` call just to run a `sync`.
    const memoMap = options?.memoMap ?? Layer.makeMemoMapUnsafe();
    const scope = Scope.makeUnsafe();
    // v4 removed `Runtime<R>` and `Layer.toRuntimeWithMemoMap`. The equivalent is
    // to build the layer into a `Context<R>` against the same memo map and scope,
    // then provide that context per test. `buildWithMemoMap` takes the scope
    // directly, so v3's `Scope.extend` step is no longer needed.
    const contextEffect = Layer.buildWithMemoMap(withTestEnv, memoMap, scope).pipe(
      Effect.orDie,
      Effect.cached,
      Effect.runSync,
    );

    const makeIt = (it: BunTest.API): BunTest.MethodsNonLive<R, ExcludeTestServices> =>
      Object.assign(it, {
        effect: makeTester<TestServices | R>(
          (effect) => Effect.flatMap(contextEffect, (context) => Effect.provideContext(effect, context)),
          it,
        ),
        prop,
        scoped: makeTester<TestServices | Scope.Scope | R>(
          (effect) =>
            Effect.flatMap(contextEffect, (context) => Effect.provideContext(Effect.scoped(effect), context)),
          it,
        ),
        flakyTest,
        layer<R2, E2>(
          nestedLayer: Layer.Layer<R2, E2, R>,
          nestedOptions?: { readonly timeout?: Duration.Input },
        ) {
          const merged = Layer.provideMerge(nestedLayer, withTestEnv) as unknown as Layer.Layer<
            TestServices | R | R2,
            E | E2
          >;
          return layer<TestServices | R | R2, E | E2, ExcludeTestServices | false>(merged, {
            ...nestedOptions,
            memoMap,
            excludeTestServices,
          });
        },
      }) as unknown as BunTest.MethodsNonLive<R, ExcludeTestServices>;

    const timeoutMs = options?.timeout !== undefined ? Duration.toMillis(options.timeout) : undefined;
    const before = beforeAll as unknown as (fn: () => Promise<void>, timeout?: number) => void;
    const after = afterAll as unknown as (fn: () => Promise<void>, timeout?: number) => void;

    const buildRuntime = contextEffect.pipe(Effect.exit, Effect.asVoid);
    const closeScope = Scope.close(scope, Exit.void);

    if (args.length === 1) {
      before(() => runPromise()(buildRuntime), timeoutMs);
      after(() => runPromise()(closeScope), timeoutMs);
      return args[0](makeIt(makeDefaultApi()));
    }

    return describe(args[0], () => {
      before(() => runPromise()(buildRuntime), timeoutMs);
      after(() => runPromise()(closeScope), timeoutMs);
      return args[1](makeIt(makeDefaultApi()));
    });
  };

class FlakyTestDefect extends Data.TaggedError('FlakyTestDefect')<{
  readonly defect: unknown;
}> {}

export const flakyTest = <A, E, R>(
  self: Effect.Effect<A, E, R>,
  timeout: Duration.Input = Duration.seconds(30),
): Effect.Effect<A, never, R> =>
  Effect.catchDefect(self, (defect) => Effect.fail(new FlakyTestDefect({ defect }))).pipe(
    // v4 dropped `Schedule.compose` / `elapsed` / `whileOutput`; `upTo` expresses
    // the same bound — retry up to 10 times, but stop once `timeout` has elapsed.
    Effect.retry(Schedule.recurs(10).pipe(Schedule.upTo({ duration: timeout }))),
    Effect.catch((error) =>
      error instanceof FlakyTestDefect ? Effect.die(error.defect) : Effect.die(error),
    ),
  );

export const makeMethods = (it: BunTest.API): BunTest.Methods =>
  Object.assign(it, {
    effect: makeTester<TestServices>(Effect.provide(TestEnv), it),
    scoped: makeTester<TestServices | Scope.Scope>(flow(Effect.scoped, Effect.provide(TestEnv)), it),
    live: makeTester<never>(identity, it),
    scopedLive: makeTester<Scope.Scope>(Effect.scoped, it),
    flakyTest,
    layer,
    prop,
  }) as unknown as BunTest.Methods;

export const {
  effect,

  live,

  scoped,

  scopedLive,
} = makeMethods(defaultApi);

export const describeWrapped = (name: string, f: (it: BunTest.Methods) => void): void => {
  describe(name, () => {
    f(makeMethods(makeDefaultApi()));
  });
};
