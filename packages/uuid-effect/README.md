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

Ships built JavaScript with declarations beside it: `exports` points at `./dist/*.js`, typed by
`./dist/*.d.ts`. Consumers need a TypeScript `moduleResolution` honouring `exports` (`bundler`,
`node16`, or `nodenext`). Pair `moduleResolution: "bundler"` with `module: "preserve"`;
`module: "bundler"` is not a valid `tsc` value.

**Nothing to declare.** `effect` is a **peer** dependency at the open range `>=4.0.0-rc.109 <5`,
and bun auto-installs a missing peer, so a consumer names it nowhere. The peer declaration is what
keeps `Uuid` a single service key: were `effect` an ordinary dependency, a consumer whose own copy
fell outside that range would silently receive a second one nested under this package.

Shipping `.d.ts` rather than `.ts` is what retires this package's old `@types/node` contract.
`src/layer.live.ts` still imports `node:crypto`, but that import now lives in the emitted
JavaScript, which no consumer typechecks — the declaration beside it names only the `Layer` type.
A consumer no longer needs `@types/node` reachable to compile against this package, and no file of
this package's becomes part of their TypeScript program.
