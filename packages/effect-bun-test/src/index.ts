import * as bt from 'bun:test';
import type * as Duration from 'effect/Duration';
import type * as Effect from 'effect/Effect';
import type * as Layer from 'effect/Layer';
import type * as Scope from 'effect/Scope';
import * as internal from './internal/internal';
import type { API, Methods, MethodsNonLive, Tester, TestServices } from './types';

export type {
  API,
  Arbitraries,
  Methods,
  MethodsNonLive,
  PropOptions,
  PropValues,
  Test,
  TestContext,
  Tester,
  TestFunction,
  TestOptions,
  TestServices,
} from './types';

export const afterAll = bt.afterAll;

export const afterEach = bt.afterEach;

export const beforeAll = bt.beforeAll;

export const beforeEach = bt.beforeEach;

export const describe = bt.describe;

export const expect = bt.expect;

export const jest = bt.jest;

export const mock = bt.mock;

export const setSystemTime = bt.setSystemTime;

export const spyOn = bt.spyOn;

export const test = bt.test;

export const addEqualityTesters: () => void = internal.addEqualityTesters;

export const effect: Tester<TestServices> = internal.effect;

export const scoped: Tester<TestServices | Scope.Scope> = internal.scoped;

export const live: Tester<never> = internal.live;

export const scopedLive: Tester<Scope.Scope> = internal.scopedLive;

export const layer: <R, E, const ExcludeTestServices extends boolean = false>(
  layer_: Layer.Layer<R, E>,
  options?: {
    readonly memoMap?: Layer.MemoMap;
    readonly timeout?: Duration.Input;
    readonly excludeTestServices?: ExcludeTestServices;
  },
) => {
  (f: (it: MethodsNonLive<R, ExcludeTestServices>) => void): void;
  (name: string, f: (it: MethodsNonLive<R, ExcludeTestServices>) => void): void;
} = internal.layer;

export const flakyTest: <A, E, R>(
  self: Effect.Effect<A, E, R>,
  timeout?: Duration.Input,
) => Effect.Effect<A, never, R> = internal.flakyTest;

export const prop: Methods['prop'] = internal.prop;

const methods = { effect, live, flakyTest, scoped, scopedLive, layer, prop } as const;

export const it: Methods = Object.assign(internal.defaultApi, methods);

export const makeMethods: (it: API) => Methods = internal.makeMethods;

export const describeWrapped: (name: string, f: (it: Methods) => void) => void = internal.describeWrapped;
