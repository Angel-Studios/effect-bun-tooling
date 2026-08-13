import { Effect, Layer, Ref } from 'effect';
import { Uuid } from './tag';

const format = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

export const UuidTest = (seed = 0): Layer.Layer<Uuid> =>
  Layer.effect(
    Uuid,
    Effect.gen(function* () {
      const counter = yield* Ref.make(seed);
      return {
        next: Ref.getAndUpdate(counter, (n) => n + 1).pipe(Effect.map(format)),
      };
    }),
  );
