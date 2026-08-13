import type { Effect } from 'effect';

export type UuidShape = {
  readonly next: Effect.Effect<string>;
};
