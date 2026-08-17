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

Both forms resolve under `bun install`, and neither consults a registry for the `@packages`
scope. Publishing these names to npmjs is not possible; adopting the registry path would require
first owning a real scope.

Only `bun install` is verified. The `__e2e__` suite proves a bun consumer resolves the packed
tarballs and runs code through them; no other package manager is exercised. Other managers may
work, but where one of these packages depends on another the consumer must override the whole
transitive closure, not just the package it names directly — `__e2e__` proves the partial case
fails.

A `file:` path to the same tarball carries the same CONTENTS, which is what the `__e2e__` proof
uses, so the suite covers contents and closure resolution but not the Release-URL fetch itself.

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
bun install
bun run dod     # tsc + bun test + biome
```

**bun is the only runtime executed here — node is never spawned**, and CI installs no node
toolchain. Two settings in `bunfig.toml` hold that, both closing paths that shell out silently
rather than expressing a preference:

- `[run] bun = true` — package bins carry a `#!/usr/bin/env node` shebang, `tsc` among them, and
  `bun run` honours it by spawning node unless told otherwise.
- `[install] ignoreScripts = true` — bun runs the postinstall of packages on its default-trusted
  list, and `msgpackr-extract` (transitive through `effect`) is one; its postinstall spawns node
  via `node-gyp-build-optional-packages`. It is an optional accelerator with a pure-JS fallback,
  so nothing here needs it built. Note an empty `trustedDependencies` array does **not** achieve
  this — bun reads `[]` as unset and keeps its defaults.

Source code still imports `node:` builtins and still typechecks against `@types/node`; both are
satisfied by bun and neither runs the node binary.

One carve-out to know about: `bunx <bin>` does **not** honour `[run] bun = true` and will spawn
node. Use `bun run <bin>` (or `bunx --bun <bin>`) for any package binary.

### TypeScript and the Effect language service

Typechecking runs on **TypeScript 7** (`tsc` is the native compiler, no node in the loop). The
Effect language service ships as **`@effect/tsgo`**, which is the TypeScript 7 compatible
successor to `@effect/language-service` — it embeds a pinned, patched `tsgo` with the Effect
language service built in, so `@effect/language-service` is no longer a dependency. The
`tsconfig.base.json` plugin entry still carries the **name** `@effect/language-service`; that is
the plugin identifier the embedded service answers to, not a package reference.

```sh
bun run effect-tsgo diagnostics --project tsconfig.json   # Effect type-aware lint
bun run effect-tsgo get-exe-path                          # LSP binary, for editor config
```

Editors must be pointed at the executable `get-exe-path` prints; a stock tsserver cannot load the
plugin by name now that it is embedded rather than installed.

Effect diagnostics are **not** wired into `bun run tsc`. Doing so requires `effect-tsgo patch`,
which rewrites the installed compiler and so must be re-run after every install. It is also not a
drop-in here: the current rule severities produce 28 message-level diagnostics, and because
`tsconfig.base.json` sets no `ignoreEffectSuggestionsInTscExitCode`, a patched `tsc` exits 1 on
them. Closing that gap means either resolving those diagnostics or opting suggestions out of the
exit code — a deliberate change, not a side effect of the upgrade. Until then the neighbouring
`ignoreEffectWarningsInTscExitCode` / `ignoreEffectErrorsInTscExitCode` options only take effect
under `diagnostics` and in the editor.
