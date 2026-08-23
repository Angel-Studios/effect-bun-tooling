import { Effect } from 'effect';
import { describe, expect, it } from '../src/index.ts';

describe('the bare it callable rejects an Effect at compile time', () => {
  it('accepts a synchronous body', () => {
    expect(1).toBe(1);
  });

  it('accepts a promise-returning body', () =>
    Promise.resolve().then(() => {
      expect(1).toBe(1);
    }));

  // An Effect returned from the bare `it` is never run by bun, so the case would pass with every
  // assertion skipped. If this stops erroring, the guard has regressed.
  it('refuses an Effect body', () =>
    // @ts-expect-error the bare callable accepts only void | Promise<unknown>
    Effect.gen(function* () {
      yield* Effect.void;
      expect(1).toBe(2);
    }));
});
