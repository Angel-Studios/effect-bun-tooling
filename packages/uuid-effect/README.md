# @packages/uuid-effect

Effect-native UUID service. Crypto-entropy UUIDs are injected through Effect context, so
tests substitute a deterministic sequence without downgrading the production source to a PRNG.

```ts
import { Effect } from 'effect';
import { Uuid } from '@packages/uuid-effect/tag';
import { UuidLive } from '@packages/uuid-effect/layer.live';

const program = Effect.gen(function* () {
  const id = yield* Uuid.next;
  return id;
});

Effect.runSync(Effect.provide(program, UuidLive));
```

In tests, `UuidTest(seed)` emits `00000000-0000-4000-8000-<counter>` from `seed`, each layer
instance owning its own counter.

```ts
import { UuidTest } from '@packages/uuid-effect/layer.test';

Effect.runSync(Effect.provide(Uuid.next, UuidTest(42)));
```

## Resolution requirements

No build step: `exports` points at `./src/*.ts`. Consumers need a runtime that executes
TypeScript directly (Bun) and a TypeScript `moduleResolution` honouring `exports`
(`bundler`, `node16`, or `nodenext`). Pair `moduleResolution: "bundler"` with
`module: "preserve"`; `module: "bundler"` is not a valid `tsc` value.

`effect` is a peer dependency and resolves from the consumer's tree.

Because this package ships `.ts` source rather than `.d.ts`, its files become part of the
consumer's TypeScript program, and `src/layer.live.ts` imports `node:crypto`. A consumer
must therefore supply ambient Node types: install `@types/node` (or `@types/bun`) **and**
name it in `compilerOptions.types`. Measured on TypeScript 6.0.3: installing `@types/node`
alone leaves `error TS2591` reported against
`node_modules/@packages/uuid-effect/src/layer.live.ts`; adding `"types": ["node"]` clears it.

There is no way to exclude that file from the check instead. `skipLibCheck` covers `.d.ts`
only, and `exclude`, `types: []` and `typeRoots: []` do not remove a file the program
reached through an `import`.
