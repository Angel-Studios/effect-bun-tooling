import { randomUUID } from 'node:crypto';
import { Effect, Layer } from 'effect';
import { Uuid } from './tag';
import type { UuidShape } from './types';

export const uuidLiveService: UuidShape = {
  next: Effect.sync(() => randomUUID()),
};

export const UuidLive: Layer.Layer<Uuid> = Layer.succeed(Uuid, uuidLiveService);
