# effect-bun-tooling

General-purpose Effect + Bun test tooling, published as **source TypeScript with no
build step**. Every package's `exports` map points at `./src/*.ts`; consumers resolve
and execute the TypeScript directly under Bun.

## Packages

| Package | Purpose |
|---|---|
| `@packages/effect-bun-test` | Effect-native test harness over `bun:test`: `it.effect` / `it.scoped` / `it.live` / `layer()`, virtual time via Effect's TestClock, scripted subprocesses, in-repo fixture roots, tagged-error assertions. |
| `@packages/fixture-residue` | The fixture-residue convention: the `.test-fixtures` directory name, the `<label>--<host>--<pid>--<random>` ownership token, owner liveness, entry classification, the sweep and its rendering. Node builtins only. |
| `@packages/bun-svelte-test` | Bun loader that compiles `.svelte` under `bun test`, plus a component-mount helper. |
| `@packages/effect-test-kit` | Assertions over Effect exits and tagged errors. |
| `@packages/uuid-effect` | Effect-native UUID service: crypto-entropy UUIDs injected through Effect context, with a deterministic test layer. |

## Consuming

Requires a runtime that executes TypeScript directly (Bun) and a TypeScript
`moduleResolution` that honours `exports` (`bundler`, `node16`, or `nodenext`).

Packages are named under `@packages/*`, which is not an ownable npm scope. Distribution is
therefore by tarball, not by registry: a GitHub Release asset URL, needing no registry
account and no `npm login`.

```jsonc
{
  "dependencies": {
    "@packages/uuid-effect": "https://github.com/Angel-Studios/effect-bun-tooling/releases/download/v0.2.1/packages-uuid-effect-0.2.1.tgz"
  }
}
```

Both forms resolve under `bun install` and `pnpm install`, and neither consults a registry for
the `@packages` scope. Publishing these names to npmjs is not possible; adopting the registry
path would require first owning a real scope.

A `file:` path to the same tarball carries the same CONTENTS, which is what the `__e2e__` proof
uses, but it is not equivalent to pnpm in one dimension that matters: pnpm classifies a `file:`
tarball as `local-filesystem` and a Release URL as `url`, and only the latter counts as *exotic*.
So a pnpm consumer that resolves these from Release URLs, where one of these packages depends on
another, needs `blockExoticSubdeps: false` — and the `__e2e__` suite, being `file:`-based, cannot
exercise that dimension.

`effect` is a **peer** dependency of every package here. It is never bundled and never
declared as a runtime dependency, because a second copy of `effect` in a consumer's tree
gives `Context.Service` a second identity and services stop resolving.

That peer is declared as the exact pin `4.0.0-rc.109`, not a range. Effect v4 is still a release
candidate — `latest` on npm remains `3.x` — and npm range semantics do not admit prereleases the
way they admit stable versions (`^4.0.0` matches no `4.0.0-rc.*`), so a range here would be either
inert or a standing invitation for the next RC to break the harness. When v4 ships stable the pin
widens to `^4.0.0`.

These packages therefore require Effect **v4** and no longer resolve against `3.x`. A consumer
still on v3 stays on the `v0.2.1` tarballs, which keep working because they are pinned by URL.

`@effect/platform` is **no longer a peer dependency at all**. v4 folded it into core: `Command` and
`CommandExecutor` became `effect/unstable/process`, and `@effect/platform/Error` became
`effect/PlatformError`. There is no v4 release of `@effect/platform`, and none is needed.

Each package's `exports` is an explicit subpath map rather than a `./*` wildcard, so a module
the map does not name is not reachable from a consumer.

## Versioning

All packages share one version and ship on one tag. `bun scripts/set-version.ts <version>`
rewrites the root and every workspace package; `git tag v<version>` triggers the release
workflow, which packs each package, proves a consumer resolves the packed tarballs, and
attaches them to a GitHub Release. Nothing is published to a registry.

## Development

```sh
pnpm install
pnpm dod        # tsc + bun test + biome
```
