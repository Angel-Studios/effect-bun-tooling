import { randomUUID } from 'node:crypto';
import { Effect, Layer } from 'effect';
import { Uuid } from './tag.ts';
import type { UuidShape } from './types.ts';

export const uuidLiveService: UuidShape = {
  next: Effect.sync(() => randomUUID()),
};

export const UuidLive: Layer.Layer<Uuid> = Layer.succeed(Uuid, uuidLiveService);
