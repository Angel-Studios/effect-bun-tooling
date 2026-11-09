import { describe, expect, it } from '@packages/effect-bun-test';
import { Effect } from 'effect';

const startAnimation = (): Animation => {
  const element = document.createElement('div');
  document.body.append(element);
  return element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 60_000 });
};

const nextMacrotask = Effect.promise(() => Bun.sleep(0));

describe('Animation.cancel() follows the Web Animations standard', () => {
  // Without the correction, bun reports the rejection as an unhandled error of this test.
  it.live('raises no unhandled rejection when nothing reads finished', () =>
    Effect.gen(function* () {
      const animation = startAnimation();

      animation.cancel();
      yield* nextMacrotask;

      expect(animation.playState).toBe('idle');
    }),
  );

  it.live('still rejects finished for a caller that reads it', () =>
    Effect.gen(function* () {
      const animation = startAnimation();
      const finished = animation.finished;

      animation.cancel();

      const rejection = yield* Effect.flip(
        Effect.tryPromise({ try: () => finished, catch: (cause) => cause as DOMException }),
      );

      expect(rejection.name).toBe('AbortError');
    }),
  );

  it.live('does nothing when the animation is already idle', () =>
    Effect.gen(function* () {
      const animation = startAnimation();
      animation.cancel();
      yield* nextMacrotask;

      expect(() => animation.cancel()).not.toThrow();
    }),
  );
});
