import type * as Duration from 'effect/Duration';
import type * as Effect from 'effect/Effect';
import type * as Layer from 'effect/Layer';
import type * as Schema from 'effect/Schema';
import type * as Scope from 'effect/Scope';
import type * as FC from 'effect/testing/FastCheck';
import type * as TestClock from 'effect/testing/TestClock';

/**
 * The services an `it.effect` / `it.scoped` test runs on top of.
 *
 * Effect v4 removed `TestServices` and `TestContext`; the virtual-time services
 * a test needs are now exactly the `TestClock`. This alias keeps the harness's
 * public type surface stable across that change.
 */
export type TestServices = TestClock.TestClock;

export interface TestContext {
  readonly signal: AbortSignal;
  onTestFinished(fn: () => void | Promise<void>): void;
  onTestFailed(fn: () => void | Promise<void>): void;
}

export interface TestOptions {
  readonly timeout?: number;
  readonly retry?: number;
  readonly repeats?: number;
  readonly skip?: boolean;
  readonly only?: boolean;
  readonly todo?: boolean;
  readonly fails?: boolean;
}

export type API = TestCollectorCallable;

interface TestCollectorCallable {
  (name: string, fn: (ctx: TestContext) => unknown | Promise<unknown>, options?: number | TestOptions): void;
  (name: string, options: TestOptions, fn: (ctx: TestContext) => unknown | Promise<unknown>): void;
}

export type TestFunction<A, E, R, TestArgs extends Array<unknown>> = (
  ...args: TestArgs
) => Effect.Effect<A, E, R>;

export type Test<R> = <A, E>(
  name: string,
  self: TestFunction<A, E, R, [TestContext]>,
  timeout?: number | TestOptions,
) => void;

export type Arbitraries =
  | Array<Schema.Constraint | FC.Arbitrary<unknown>>
  | { [K in string]: Schema.Constraint | FC.Arbitrary<unknown> };

export type PropValues<Arbs extends Arbitraries> = {
  [K in keyof Arbs]: Arbs[K] extends FC.Arbitrary<infer T> ? T : Schema.Schema.Type<Arbs[K]>;
};

export type PropOptions<Arbs extends Arbitraries> =
  | number
  | (TestOptions & { fastCheck?: FC.Parameters<PropValues<Arbs>> });

export interface Tester<R> extends Test<R> {
  skip: Test<R>;
  skipIf: (condition: unknown) => Test<R>;
  runIf: (condition: unknown) => Test<R>;
  only: Test<R>;
  each: <T>(
    cases: ReadonlyArray<T>,
  ) => <A, E>(name: string, self: TestFunction<A, E, R, Array<T>>, timeout?: number | TestOptions) => void;
  fails: Test<R>;

  prop: <const Arbs extends Arbitraries, A, E>(
    name: string,
    arbitraries: Arbs,
    self: TestFunction<A, E, R, [PropValues<Arbs>, TestContext]>,
    timeout?: PropOptions<Arbs>,
  ) => void;
}

export interface MethodsNonLive<R = never, ExcludeTestServices extends boolean = false> extends API {
  readonly effect: Tester<(ExcludeTestServices extends true ? never : TestServices) | R>;
  readonly flakyTest: <A, E, R2>(
    self: Effect.Effect<A, E, R2>,
    timeout?: Duration.Input,
  ) => Effect.Effect<A, never, R2>;
  readonly scoped: Tester<(ExcludeTestServices extends true ? never : TestServices) | Scope.Scope | R>;
  readonly layer: <R2, E>(
    layer: Layer.Layer<R2, E, R>,
    options?: { readonly timeout?: Duration.Input },
  ) => {
    (f: (it: MethodsNonLive<R | R2, ExcludeTestServices>) => void): void;
    (name: string, f: (it: MethodsNonLive<R | R2, ExcludeTestServices>) => void): void;
  };

  readonly prop: <const Arbs extends Arbitraries>(
    name: string,
    arbitraries: Arbs,
    self: (properties: PropValues<Arbs>, ctx: TestContext) => void,
    timeout?: PropOptions<Arbs>,
  ) => void;
}

export interface Methods<R = never> extends MethodsNonLive<R> {
  readonly live: Tester<R>;
  readonly scopedLive: Tester<Scope.Scope | R>;
}
