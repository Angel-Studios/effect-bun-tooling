import * as assert from 'node:assert';
import * as Cause from 'effect/Cause';
import * as Effect from 'effect/Effect';
import * as Equal from 'effect/Equal';
import * as Exit from 'effect/Exit';
import * as Option from 'effect/Option';
import * as Predicate from 'effect/Predicate';
import * as Result from 'effect/Result';

export function fail(message: string): never {
  assert.fail(message);
}

export function deepStrictEqual<A>(actual: A, expected: A, message?: string, ..._: Array<never>) {
  assert.deepStrictEqual(actual, expected, message);
}

export function notDeepStrictEqual<A>(actual: A, expected: A, message?: string, ..._: Array<never>) {
  assert.notDeepStrictEqual(actual, expected, message);
}

export function strictEqual<A>(actual: A, expected: A, message?: string, ..._: Array<never>) {
  assert.strictEqual(actual, expected, message);
}

export function assertEquals<A>(actual: A, expected: A, message?: string, ..._: Array<never>) {
  if (!Equal.equals(actual, expected)) {
    deepStrictEqual(actual, expected, message);
    fail(message ?? 'Expected values to be Equal.equals');
  }
}

export function doesNotThrow(thunk: () => void, message?: string, ..._: Array<never>) {
  assert.doesNotThrow(thunk, message);
}

export function assertInstanceOf<C extends abstract new (...args: never) => unknown>(
  value: unknown,
  ctor: C,
  message?: string,
  ..._: Array<never>
): asserts value is InstanceType<C> {
  assert.ok(value instanceof ctor, message ?? `Expected value to be an instance of ${ctor.name}`);
}

export function assertTrue(self: unknown, message?: string, ..._: Array<never>): asserts self {
  strictEqual(self, true, message);
}

export function assertFalse(self: boolean, message?: string, ..._: Array<never>) {
  strictEqual(self, false, message);
}

export function assertInclude(actual: string | undefined, expected: string, ..._: Array<never>) {
  if (Predicate.isString(expected)) {
    if (!actual?.includes(expected)) {
      fail(`Expected\n\n${actual}\n\nto include\n\n${expected}`);
    }
  }
}

export function assertMatch(actual: string, regexp: RegExp, ..._: Array<never>) {
  if (!regexp.test(actual)) {
    fail(`Expected\n\n${actual}\n\nto match\n\n${regexp}`);
  }
}

export function throws(thunk: () => void, error?: Error | ((u: unknown) => undefined), ..._: Array<never>) {
  try {
    thunk();
    fail('Expected to throw an error');
  } catch (e) {
    if (error !== undefined) {
      if (Predicate.isFunction(error)) {
        error(e);
      } else {
        deepStrictEqual(e, error);
      }
    }
  }
}

export function throwsAsync(
  thunk: () => Promise<void>,
  error?: Error | ((u: unknown) => undefined),
  ..._: Array<never>
): Promise<void> {
  // `Effect.promise` turns a rejection into a defect, so `catchCause` sees every
  // way the thunk can blow up and `Cause.squash` hands back the thrown value.
  // As in `throws` above, the `fail` for a thunk that did NOT throw lands in the
  // same handler, so it only surfaces when an `error` matcher was supplied.
  return Effect.runPromise(
    Effect.gen(function* () {
      yield* Effect.promise(thunk);
      fail('Expected to throw an error');
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.sync(() => {
          if (error === undefined) return;
          const thrown = Cause.squash(cause);
          if (Predicate.isFunction(error)) {
            error(thrown);
          } else {
            deepStrictEqual(thrown, error);
          }
        }),
      ),
    ),
  );
}

export function assertNone<A>(
  option: Option.Option<A>,
  ..._: Array<never>
): asserts option is Option.None<never> {
  deepStrictEqual(option, Option.none());
}

export function assertSome<A>(
  option: Option.Option<A>,
  expected: A,
  ..._: Array<never>
): asserts option is Option.Some<A> {
  deepStrictEqual(option, Option.some(expected));
}

export function assertLeft<R, L>(
  result: Result.Result<R, L>,
  expected: L,
  ..._: Array<never>
): asserts result is Result.Failure<never, L> {
  deepStrictEqual(result, Result.fail(expected));
}

export function assertRight<R, L>(
  result: Result.Result<R, L>,
  expected: R,
  ..._: Array<never>
): asserts result is Result.Success<R, never> {
  deepStrictEqual(result, Result.succeed(expected));
}

export function assertFailure<A, E>(
  exit: Exit.Exit<A, E>,
  expected: Cause.Cause<E>,
  ..._: Array<never>
): asserts exit is Exit.Failure<never, E> {
  deepStrictEqual(exit, Exit.failCause(expected));
}

export function assertSuccess<A, E>(
  exit: Exit.Exit<A, E>,
  expected: A,
  ..._: Array<never>
): asserts exit is Exit.Success<A, never> {
  deepStrictEqual(exit, Exit.succeed(expected));
}
