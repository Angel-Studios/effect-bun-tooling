# @angel-studios/uuid-effect

Effect-native UUID service. Crypto-entropy UUIDs are injected through Effect context, so
tests substitute a deterministic sequence without downgrading the production source to a PRNG.

```ts
import { Effect } from 'effect';
import { Uuid } from '@angel-studios/uuid-effect/tag';
import { UuidLive } from '@angel-studios/uuid-effect/layer.live';

const program = Effect.gen(function* () {
  const id = yield* Uuid.next;
  return id;
});

Effect.runSync(Effect.provide(program, UuidLive));
```

In tests, `UuidTest(seed)` emits `00000000-0000-4000-8000-<counter>` from `seed`, each layer
instance owning its own counter.

```ts
import { UuidTest } from '@angel-studios/uuid-effect/layer.test';

Effect.runSync(Effect.provide(Uuid.next, UuidTest(42)));
```

## Resolution requirements

No build step: `exports` points at `./src/*.ts`. Consumers need a runtime that executes
TypeScript directly (Bun) and a TypeScript `moduleResolution` honouring `exports`
(`bundler`, `node16`, or `nodenext`).

`effect` is a peer dependency and resolves from the consumer's tree.
