import { Context, Effect } from 'effect';
import type { UuidShape } from './types';

export class Uuid extends Context.Tag('@packages/uuid-effect/tag/Uuid')<Uuid, UuidShape>() {
  static readonly next: Effect.Effect<string, never, Uuid> = Effect.flatMap(Uuid, (service) => service.next);
}
