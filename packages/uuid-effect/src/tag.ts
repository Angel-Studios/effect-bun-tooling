import { Context, Effect } from 'effect';
import type { UuidShape } from './types.ts';

export class Uuid extends Context.Service<Uuid, UuidShape>()('@packages/uuid-effect/tag/Uuid') {
  static readonly next: Effect.Effect<string, never, Uuid> = Effect.flatMap(Uuid, (service) => service.next);
}
