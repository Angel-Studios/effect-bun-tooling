import * as Context from 'effect/Context';
import * as Duration from 'effect/Duration';
import * as Effect from 'effect/Effect';
import * as Fiber from 'effect/Fiber';
import * as Layer from 'effect/Layer';
import * as TestClock from 'effect/testing/TestClock';
import { describe, expect, it, layer } from '../src/index';

// v4 replaced `Effect.Service` with `Context.Service`, whose `make` option no
// longer auto-generates a `.Default` layer — the layer is declared explicitly.
class LiveSleeper extends Context.Service<LiveSleeper>()('TestServicesIsolation/LiveSleeper', {
  make: Effect.gen(function* () {
    const clock = yield* Effect.clockWith(Effect.succeed);
    return { sleep: (ms: number) => clock.sleep(Duration.millis(ms)) } as const;
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}

layer(LiveSleeper.layer, { excludeTestServices: true })('excludeTestServices block runs first', (it) => {
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

      // v4 builds the TestClock as a plain object rather than a named class
      // instance, so it is identified by the virtual-time API that the live
      // clock does not carry.
      expect(typeof (clock as Partial<TestClock.TestClock>).adjust).toBe('function');
    }),
  );

  it.effect('TestClock.adjust advances a forked, virtually-sleeping fiber', () =>
    Effect.gen(function* () {
      const fiber = yield* Effect.sleep(Duration.seconds(1_000)).pipe(Effect.forkChild);
      yield* Effect.yieldNow;

      yield* TestClock.adjust(Duration.seconds(1_000));
      yield* Fiber.join(fiber);
      expect(true).toBe(true);
    }),
  );
});
