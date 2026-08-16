import * as Cause from 'effect/Cause';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as Ref from 'effect/Ref';
import { describe, expect, flakyTest, it } from '../src/index';

const ATTEMPTS_FOR_RECURS_10 = 11;

type FlakyGuardTypedFailure = {
  readonly _tag: 'FlakyGuardTypedFailure';
  readonly sentinel: string;
};

const ORIGINAL_DEFECT: { readonly sentinel: string } = { sentinel: 'flaky-guard-original-defect' };

const ORIGINAL_TYPED_FAILURE: FlakyGuardTypedFailure = {
  _tag: 'FlakyGuardTypedFailure',
  sentinel: 'flaky-guard-original-typed-failure',
};

type FlakyOutcome<A> = {
  readonly attempts: number;
  readonly exit: Exit.Exit<A, never>;
};

const runFlakyCountingAttempts = <A, E>(
  body: (attempt: number) => Effect.Effect<A, E>,
): Effect.Effect<FlakyOutcome<A>> =>
  Effect.gen(function* () {
    const counter = yield* Ref.make(0);
    const countedBody = Effect.flatMap(
      Ref.updateAndGet(counter, (previous) => previous + 1),
      body,
    );

    const exit = yield* countedBody.pipe(flakyTest, Effect.exit);
    const attempts = yield* Ref.get(counter);
    return { attempts, exit };
  });

// v4 flattened `Cause` into a `reasons` array, replacing `Cause.defects`.
const defectsOf = (cause: Cause.Cause<never>): ReadonlyArray<unknown> =>
  cause.reasons.filter(Cause.isDieReason).map((reason) => reason.defect);

const soleDefectOf = <A>(exit: Exit.Exit<A, never>): unknown =>
  Exit.match(exit, {
    onFailure: (cause) => defectsOf(cause)[0],
    onSuccess: () => 'NO_DEFECT_THE_EFFECT_SUCCEEDED',
  });

const terminalCauseShapeOf = <A>(exit: Exit.Exit<A, never>): string =>
  Exit.match(exit, {
    onFailure: (cause) =>
      `die=${Cause.hasDies(cause)} typedFailure=${Cause.hasFails(cause)} interruptedOnly=${Cause.hasInterruptsOnly(cause)}`,
    onSuccess: () => 'THE_EFFECT_SUCCEEDED',
  });

const successValueOf = <A>(exit: Exit.Exit<A, never>, whenDied: A): A =>
  Exit.match(exit, { onFailure: () => whenDied, onSuccess: (value) => value });

describe('flakyTest retries a DEFECT on Schedule.recurs(10)', () => {
  it.effect('attempts a permanently dying effect 11 times, not once', () =>
    Effect.gen(function* () {
      const { attempts, exit } = yield* runFlakyCountingAttempts(
        (): Effect.Effect<never> => Effect.die(ORIGINAL_DEFECT),
      );

      expect(attempts).toBe(ATTEMPTS_FOR_RECURS_10);
      expect(Exit.isFailure(exit)).toBe(true);
    }),
  );

  it.effect(
    'rethrows the ORIGINAL defect object by reference identity, never a FlakyTestDefect wrapper',
    () =>
      Effect.gen(function* () {
        const { exit } = yield* runFlakyCountingAttempts(
          (): Effect.Effect<never> => Effect.die(ORIGINAL_DEFECT),
        );

        expect(soleDefectOf(exit)).toBe(ORIGINAL_DEFECT);
      }),
  );

  it.effect('ends as a DIE carrying exactly one defect, not as a typed failure', () =>
    Effect.gen(function* () {
      const { exit } = yield* runFlakyCountingAttempts(
        (): Effect.Effect<never> => Effect.die(ORIGINAL_DEFECT),
      );

      expect(terminalCauseShapeOf(exit)).toBe('die=true typedFailure=false interruptedOnly=false');
      expect(
        Exit.match(exit, {
          onFailure: (cause) => defectsOf(cause).length,
          onSuccess: () => 0,
        }),
      ).toBe(1);
    }),
  );
});

describe('flakyTest retries a TYPED FAILURE on the same schedule and still ends as a die', () => {
  it.effect('attempts a permanently failing effect 11 times, not once', () =>
    Effect.gen(function* () {
      const { attempts } = yield* runFlakyCountingAttempts(
        (): Effect.Effect<never, FlakyGuardTypedFailure> => Effect.fail(ORIGINAL_TYPED_FAILURE),
      );

      expect(attempts).toBe(ATTEMPTS_FOR_RECURS_10);
    }),
  );

  it.effect('surfaces the exhausted typed failure as a DIE holding the original error by identity', () =>
    Effect.gen(function* () {
      const { exit } = yield* runFlakyCountingAttempts(
        (): Effect.Effect<never, FlakyGuardTypedFailure> => Effect.fail(ORIGINAL_TYPED_FAILURE),
      );

      expect(terminalCauseShapeOf(exit)).toBe('die=true typedFailure=false interruptedOnly=false');
      expect(soleDefectOf(exit)).toBe(ORIGINAL_TYPED_FAILURE);
    }),
  );
});

describe('flakyTest recovers instead of dying when a later attempt succeeds', () => {
  it.effect('returns the success value after two DEFECTS, and does not die', () =>
    Effect.gen(function* () {
      const { attempts, exit } = yield* runFlakyCountingAttempts(
        (attempt): Effect.Effect<string> =>
          attempt <= 2 ? Effect.die(ORIGINAL_DEFECT) : Effect.succeed('recovered-from-defects'),
      );

      expect(attempts).toBe(3);
      expect(Exit.isFailure(exit)).toBe(false);
      expect(successValueOf(exit, 'DIED_INSTEAD_OF_RECOVERING')).toBe('recovered-from-defects');
    }),
  );

  it.effect('returns the success value after two TYPED FAILURES, and does not die', () =>
    Effect.gen(function* () {
      const { attempts, exit } = yield* runFlakyCountingAttempts(
        (attempt): Effect.Effect<string, FlakyGuardTypedFailure> =>
          attempt <= 2 ? Effect.fail(ORIGINAL_TYPED_FAILURE) : Effect.succeed('recovered-from-failures'),
      );

      expect(attempts).toBe(3);
      expect(Exit.isFailure(exit)).toBe(false);
      expect(successValueOf(exit, 'DIED_INSTEAD_OF_RECOVERING')).toBe('recovered-from-failures');
    }),
  );
});

describe('flakyTest never retries an INTERRUPT', () => {
  it.effect(
    'positive control — the same attempt-counting harness DOES reach 11 attempts for a dying effect',
    () =>
      Effect.gen(function* () {
        const { attempts } = yield* runFlakyCountingAttempts(
          (): Effect.Effect<never> => Effect.die(ORIGINAL_DEFECT),
        );

        expect(attempts).toBe(ATTEMPTS_FOR_RECURS_10);
      }),
  );

  it.effect('an interrupted effect is attempted exactly once and stays interrupted', () =>
    Effect.gen(function* () {
      const { attempts, exit } = yield* runFlakyCountingAttempts(
        (): Effect.Effect<never> => Effect.interrupt,
      );

      expect(attempts).toBe(1);
      expect(Exit.isFailure(exit)).toBe(true);
      expect(terminalCauseShapeOf(exit)).toBe('die=false typedFailure=false interruptedOnly=true');
    }),
  );
});
