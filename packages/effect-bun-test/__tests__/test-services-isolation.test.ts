import * as Duration from 'effect/Duration';
import * as Effect from 'effect/Effect';
import * as TestClock from 'effect/TestClock';
import { describe, expect, it, layer } from '../src/index';

class LiveSleeper extends Effect.Service<LiveSleeper>()('TestServicesIsolation/LiveSleeper', {
  effect: Effect.gen(function* () {
    const clock = yield* Effect.clockWith(Effect.succeed);
    return { sleep: (ms: number) => clock.sleep(Duration.millis(ms)) } as const;
  }),
}) {}

layer(LiveSleeper.Default, { excludeTestServices: true })('excludeTestServices block runs first', (it) => {
  it.effect('resolves against a live clock', () =>
    Effect.gen(function* () {
      const sleeper = yield* LiveSleeper;
      yield* sleeper.sleep(1);
    }),
  );
});

describe('the shared top-level it.effect keeps its own TestClock', () => {
  it.effect('exposes a real TestClock after an excludeTestServices block registered', () =>
    Effect.gen(function* () {
      const clock = yield* Effect.clockWith(Effect.succeed);

      expect(clock.constructor.name).toBe('TestClockImpl');
    }),
  );

  it.effect('TestClock.adjust advances a forked, virtually-sleeping fiber', () =>
    Effect.gen(function* () {
      const fiber = yield* Effect.sleep(Duration.seconds(1_000)).pipe(Effect.fork);
      yield* Effect.yieldNow();

      yield* TestClock.adjust(Duration.seconds(1_000));
      yield* fiber.await;
      expect(true).toBe(true);
    }),
  );
});
