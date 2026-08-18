# effect-bun-tooling

General-purpose Effect + Bun test tooling, published as a **built `dist`**. Every package's
`exports` map points at `./dist/*.js` with a `./dist/*.d.ts` beside it; under `bun install` a
consumer names the tarball and declares nothing else.

## Packages

| Package | Purpose |
|---|---|
| `@packages/effect-bun-test` | Effect-native test harness over `bun:test`: `it.effect` / `it.scoped` / `it.live` / `layer()`, virtual time via Effect's TestClock, scripted subprocesses, in-repo fixture roots, tagged-error assertions. |
| `@packages/fixture-residue` | The fixture-residue convention: the `.test-fixtures` directory name, the `<label>--<host>--<pid>--<random>` ownership token, owner liveness, entry classification, the sweep and its rendering. Node builtins only. |
| `@packages/bun-svelte-test` | Bun loader that compiles `.svelte` under `bun test`, plus a component-mount helper. |
| `@packages/effect-test-kit` | Assertions over Effect exits and tagged errors. |
| `@packages/uuid-effect` | Effect-native UUID service: crypto-entropy UUIDs injected through Effect context, with a deterministic test layer. |

## Consuming

Requires Bun at runtime — `bun:test` is imported by the harness itself — and a TypeScript
`moduleResolution` that honours `exports` (`bundler`, `node16`, or `nodenext`).

Packages are named under `@packages/*`, which is not an ownable npm scope. Distribution is
therefore by tarball, not by registry: a GitHub Release asset URL, needing no registry
account and no `npm login`.

```jsonc
{
  "dependencies": {
    "@packages/uuid-effect": "https://github.com/Angel-Studios/effect-bun-tooling/releases/download/v0.4.1/packages-uuid-effect-0.4.1.tgz"
  }
}
```

Both forms resolve under `bun install`, and neither consults a registry for the `@packages`
scope. Publishing these names to npmjs is not possible; adopting the registry path would require
first owning a real scope.

That manifest entry is the whole integration under `bun install`, and no package asks a consumer
to write an `overrides` entry.

### Nothing to declare

`@types/bun`, `happy-dom` and `@happy-dom/global-registrator` are ordinary `dependencies`, so a
package manager installs them unprompted.

`effect` and `svelte` are **peer** dependencies, and a consumer still declares neither: **bun
auto-installs a missing peer**. Verified — a consumer naming only the harness, with no `effect` of
its own, ends up with `effect` installed at the top level.

The ranges are open — `effect` at `>=4.0.0-rc.109 <5`, `svelte` at `^5.56.8` — never an exact pin.
The exact pin `4.0.0-rc.109` is what made the earlier peer declaration painful: it admitted one
release and forced every consumer onto it. An open range lets a consumer already on a later v4 RC,
or on v4 stable once it ships, dedupe onto the copy they have.

These packages require Effect **v4**; they do not resolve against `3.x`. A consumer still on v3
stays on the `v0.2.1` tarballs, which keep working because they are pinned by URL.

`@effect/platform` is not a dependency at all. v4 folded it into core: `Command` and
`CommandExecutor` became `effect/unstable/process`, and `@effect/platform/Error` became
`effect/PlatformError`. There is no v4 release of `@effect/platform`, and none is needed.

### Why `effect` and `svelte` are peers

Both must exist exactly **once** in a consumer's tree, and a peer declaration is what refuses to
duplicate them. Measured on bun 1.3.14, with a consumer pinned to `effect@3.19.0` while these
packages require v4:

| declared as | consumer declares nothing | consumer declares a conflicting version |
|---|---|---|
| `dependencies` | installs it top-level | **silent nested second copy**, exit 0, no warning |
| `peerDependencies` | **auto-installs** it top-level | `warn: incorrect peer dependency`, **no second copy** |
| both | installs it top-level | silent nested second copy, and no warning |

bun does not fail the install in any of these cases, so the guarantee is not "refuses to install" —
it is that a version conflict never silently becomes two copies. `__e2e__` proves it.

For `svelte` the duplicate is the more dangerous one: `bun-svelte-test` compiles a consumer's
components, and compiler output binds `svelte/internal/client` at runtime. A consumer on svelte 4
would silently receive a nested svelte 5 and compile against one copy while mounting on another.

**This is why the published JavaScript never inlines either one**, though it could otherwise depend
on nothing at all. There is a second, type-level reason it could not: the exported signatures are
written in Effect's own types — `it.effect` takes an `Effect.Effect<A, E, R>`, `it.layer` takes a
`Layer.Layer<R>` — and those must be the SAME types the consumer's `effect` provides. Vendoring
would mean rolling Effect's entire declaration surface into each package and typing a consumer's
test callbacks against that copy rather than their own install.

One thing a peer does cost: **pnpm and yarn do not auto-install peers**, they warn. Consumers on
those managers must declare `effect` (and `svelte`) themselves. Only `bun install` is verified here
either way.

A note on Effect v4 specifically: duplication is no longer instantly fatal the way it was under v3.
v4 identifies values by string type IDs — `"~effect/Effect"`, `"~effect/Context"` — and keys a
`Context` by the service key's string, so two v4 copies do interoperate; a `Context.Service` key, a
`Layer` and a runtime drawn from separate copies resolve correctly. What breaks is a v3 consumer
meeting a v4 harness, which is exactly the case a dependency declaration turns into a silent nested
copy.

### What IS bundled

`@packages/fixture-residue` is folded into `@packages/effect-bun-test`'s `dist` — its JavaScript by
the bundler, its declarations copied under `dist/_bundled/` with the specifiers repointed. It stays
separately publishable for tooling that wants it on its own, but a consumer of the test harness
never resolves the name. That matters because `@packages` is not an ownable scope: a dependency on
it resolves nowhere, and it was exactly this closure that used to force consumers to hand-write
`overrides` for packages they had never heard of.

### What is verified

Only `bun install` is verified. The `__e2e__` suite installs the packed tarballs into a throwaway
consumer that declares nothing but the tarballs themselves, then proves that consumer

- installs with no `overrides` and no lockfile present, declaring no `effect` or `svelte`,
- runs a consumer-built `Effect` through a service the packages define,
- resolves exactly one copy of `effect`, and
- typechecks against the shipped `.d.ts` under both `bundler` and `nodenext`, with
  `skipLibCheck` **off**.

A second consumer, pinned to `effect@3.19.0`, proves the peer guarantee: the install warns and
nests **no** second copy of `effect` under the package.

No other package manager is exercised. A `file:` path to the same tarball carries the same
CONTENTS, which is what the proof uses, so the suite covers contents and resolution but not the
Release-URL fetch itself.

Each package's `exports` is an explicit subpath map rather than a `./*` wildcard, so a module
the map does not name is not reachable from a consumer.

### The build

`bun run build` writes each package's `dist`:

- **`bun build`** emits the JavaScript, bundling workspace siblings and keeping every installed
  dependency — **peers above all** — external. It also restores the `node:` prefix the bundler
  drops, so a shipped `import` cannot bind to a consumer's userland `fs` or `path`. The build
  fails if a declared peer stops appearing among the dist's imports, because that means the
  bundler inlined a copy rather than leaving it external.
- **`tsc --emitDeclarationOnly`**, through `bun run` so the pinned TypeScript 7 is used and no
  node process starts, emits the `.d.ts`.

Entry points are derived from each manifest's `exports` map, so a subpath nobody exports is never
built and a subpath that is exported cannot be forgotten. Relative specifiers in shipped source
carry a `.ts` extension — TypeScript resolves `./x.ts` to `./x.d.ts`, and an extensionless
specifier inside a published declaration is a hard error for any consumer on `node16` or
`nodenext`. It is the same form `effect` itself ships.

## Versioning

All packages share one version and ship on one tag. `bun scripts/set-version.ts <version>`
rewrites the root and every workspace package; `git tag v<version>` triggers the release
workflow, which builds and packs each package, proves a consumer installs the packed tarballs
with nothing else declared, and attaches them to a GitHub Release. Nothing is published to a
registry.

## Development

```sh
bun install
bun run build       # every package's dist, which is what a consumer installs
bun run dod         # build + tsc + effect-tsgo + bun test + biome
bun run test:e2e    # build, pack, then install the tarballs into a throwaway consumer
```

**The build comes first, and `dod` runs it first for that reason.** In-repo code imports workspace
siblings by package name — `scripts/fixture-root.ts` reaches for `@packages/fixture-residue/sweep`,
`bun-svelte-test`'s suite for `@packages/effect-bun-test` — and those names now resolve through an
`exports` map that points at `dist`. On a fresh checkout `bun run tsc` therefore fails until a build
has run, with a plain `Cannot find module`. `bun run dod` and `bun run test:e2e` each build first so
neither can be run out of order; a bare `bun run tsc` or `bun test` cannot, so run `bun run build`
after `bun install`.

The build bootstraps itself: `buildOrder` puts a bundled sibling ahead of its dependent, so
`fixture-residue` is built before `effect-bun-test` needs it.

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
