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
consumer's TypeScript program, and `src/layer.live.ts` imports `node:crypto`. The contract is
therefore: **`@types/node` must be resolvable in the consumer's tree, and the consumer must load a
type package that reaches it.** `@types/bun` satisfies both on its own — it depends on `bun-types`,
which depends on `@types/node`, and whose own declarations import `node:*` modules by specifier —
so `"types": ["bun"]` is sufficient and naming `node` is not required.

Measured on TypeScript 7.0.2 against the packed tarball:

| consumer configuration | `tsc --noEmit` |
|---|---|
| `@types/bun`, `"types": ["bun"]` | exit 0 |
| `@types/bun` + `@types/node`, `"types": ["bun", "node"]` | exit 0 |
| `@types/node`, `"types": ["node"]` | exit 0 |
| `@types/bun`, `"types": ["bun"]`, `@types/node` deleted from disk | **exit 1** |
| no node or bun typings at all | **exit 1** |

Both failing rows report the same thing, and it is reported against this package's file inside the
consumer's `node_modules`:

```
node_modules/@packages/uuid-effect/src/layer.live.ts(1,28): error TS2591: Cannot find name 'node:crypto'. Do you need to install type definitions for node? Try `npm i --save-dev @types/node` and then add 'node' to the types field in your tsconfig.
```

There is no way to exclude that file from the check instead: `skipLibCheck` covers `.d.ts` only, and
`exclude`, `types: []` and `typeRoots: []` do not remove a file the program reached through an
`import`. This is a property of source-shipping, so it applies to every package here, not just this
one — a package importing `node:fs`, `node:os` or `node:path` carries exactly the same contract.
