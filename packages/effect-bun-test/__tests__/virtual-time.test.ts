import { Context, Effect, Fiber, Layer } from 'effect';
import * as TestClock from 'effect/testing/TestClock';
import { afterAll, describe, expect, it, layer } from '../src/index';

describe('virtual time', () => {
  it.effect('ten virtual seconds of Effect.sleep advance the virtual clock by ten seconds', () =>
    Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(Effect.sleep('10 seconds'));
      yield* TestClock.adjust('10 seconds');
      yield* Fiber.join(fiber);

      const virtualElapsed = yield* Effect.clockWith((clock) => clock.currentTimeMillis);
      expect(virtualElapsed).toBeGreaterThanOrEqual(10_000);
    }),
  );

  it.effect('a sleep that is never adjusted past does NOT resolve', () =>
    Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(Effect.sleep('10 seconds'));

      yield* TestClock.adjust('9 seconds');
      // v4 dropped `Fiber.poll`; `pollUnsafe` reads the exit synchronously,
      // returning `undefined` while the fiber is still suspended.
      expect(fiber.pollUnsafe()).toBeUndefined();

      yield* TestClock.adjust('1 second');
      yield* Fiber.join(fiber);
      expect(fiber.pollUnsafe()).toBeDefined();
    }),
  );

  it.live('it.live runs on the REAL clock', () => {
    const startedAt = performance.now();
    return Effect.gen(function* () {
      yield* Effect.sleep('5 millis');
      const realElapsed = performance.now() - startedAt;

      expect(realElapsed).toBeGreaterThan(1);
    });
  });
});

let buildCount = 0;

class Expensive extends Context.Service<Expensive, { readonly serial: number }>()('Expensive') {}

const ExpensiveLive = Layer.effect(
  Expensive,
  Effect.sync(() => {
    buildCount += 1;
    return { serial: buildCount };
  }),
);

describe('layer memoization', () => {
  layer(ExpensiveLive)('shares one build across every test in the block', (it) => {
    it.effect('first test sees the first build', () =>
      Effect.gen(function* () {
        const expensive = yield* Expensive;
        expect(expensive.serial).toBe(1);
      }),
    );

    it.effect('second test sees the SAME build, not a rebuild', () =>
      Effect.gen(function* () {
        const expensive = yield* Expensive;
        expect(expensive.serial).toBe(1);
      }),
    );

    it.effect('third test still sees the same build', () =>
      Effect.gen(function* () {
        const expensive = yield* Expensive;
        expect(expensive.serial).toBe(1);
      }),
    );
  });

  afterAll(() => {
    expect(buildCount).toBe(1);
  });
});
