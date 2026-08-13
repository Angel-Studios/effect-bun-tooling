import { describe, expect, it } from 'bun:test';
import { Cause, Data, Effect, Either, Exit, Schema } from 'effect';
import { expectCauseFailureTag, expectFailureTag, expectLeftTag, expectTag } from '../src/tagged';

class FooError extends Data.TaggedError('FooError')<{ readonly foo: string }> {}
class BarError extends Data.TaggedError('BarError')<{ readonly bar: number }> {}
class BazError extends Schema.TaggedError<BazError>()('BazError', {
  baz: Schema.Boolean,
}) {}

type MyError = FooError | BarError;

describe('expectTag', () => {
  it('returns the narrowed member on a tag match (member-specific field is typed)', () => {
    const err: MyError = new FooError({ foo: 'hello' });
    const narrowed = expectTag(err, 'FooError');

    expect(narrowed.foo).toBe('hello');
  });

  it('narrows correctly within a union (excludes the non-matching arm)', () => {
    const err: MyError = new BarError({ bar: 7 });
    expect(expectTag(err, 'BarError').bar).toBe(7);
  });

  it('works on a Schema.TaggedError (the instanceOfSchema target class)', () => {
    const err = new BazError({ baz: true });
    expect(expectTag(err, 'BazError').baz).toBe(true);
  });

  it('throws loudly on a tag mismatch, naming both the expected and actual tag', () => {
    const widen = (e: MyError): MyError => e;
    const err = widen(new BarError({ bar: 5 }));
    expect(() => expectTag(err, 'FooError')).toThrow(/expected a value tagged "FooError"/);

    expect(() => expectTag(err, 'FooError')).toThrow(/BarError/);
  });
});

describe('expectFailureTag', () => {
  it('narrows the typed failure of a failing Exit', () => {
    const exit = Effect.runSyncExit(Effect.fail(new FooError({ foo: 'boom' })));
    const err = expectFailureTag(exit, 'FooError');
    expect(err.foo).toBe('boom');
  });

  it('throws when the Exit SUCCEEDED', () => {
    const okExit: Exit.Exit<number, FooError> = Exit.succeed(42);
    expect(() => expectFailureTag(okExit, 'FooError')).toThrow(/it SUCCEEDED/);
  });

  it('throws when the Cause carried a defect rather than a typed failure', () => {
    const dieExit: Exit.Exit<number, FooError> = Effect.runSyncExit(Effect.die('kaboom'));
    expect(() => expectFailureTag(dieExit, 'FooError')).toThrow(/no.*typed failure/);
  });

  it('throws on a tag mismatch inside the failing Exit', () => {
    const exit: Exit.Exit<number, MyError> = Effect.runSyncExit(Effect.fail(new BarError({ bar: 1 })));
    expect(() => expectFailureTag(exit, 'FooError')).toThrow(/expected a value tagged "FooError"/);
  });
});

describe('expectCauseFailureTag', () => {
  it('narrows the typed failure of a Cause', () => {
    const cause: Cause.Cause<FooError> = Cause.fail(new FooError({ foo: 'cz' }));
    expect(expectCauseFailureTag(cause, 'FooError').foo).toBe('cz');
  });

  it('throws when the Cause is a defect', () => {
    const cause: Cause.Cause<FooError> = Cause.die('nope');
    expect(() => expectCauseFailureTag(cause, 'FooError')).toThrow(/no.*typed failure/);
  });
});

describe('expectLeftTag', () => {
  it('narrows the Left of an Either', () => {
    const left: Either.Either<number, FooError> = Either.left(new FooError({ foo: 'lz' }));
    expect(expectLeftTag(left, 'FooError').foo).toBe('lz');
  });

  it('throws when the Either is a Right', () => {
    const right: Either.Either<number, FooError> = Either.right(9);
    expect(() => expectLeftTag(right, 'FooError')).toThrow(/received a Right/);
  });
});
