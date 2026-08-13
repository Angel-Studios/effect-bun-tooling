# effect-bun-tooling

General-purpose Effect + Bun test tooling, published as **source TypeScript with no
build step**. Every package's `exports` map points at `./src/*.ts`; consumers resolve
and execute the TypeScript directly under Bun.

## Packages

| Package | Purpose |
|---|---|
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
    "@packages/uuid-effect": "https://github.com/Angel-Studios/effect-bun-tooling/releases/download/v0.1.1/packages-uuid-effect-0.1.1.tgz"
  }
}
```

A `file:` path to the same tarball resolves identically, which is what the local proof uses.
Both forms resolve under `bun install` and `pnpm install`, and neither consults a registry
for the `@packages` scope. Publishing these names to npmjs is not possible; adopting the
registry path would require first owning a real scope.

`effect` is a **peer** dependency of every package here. It is never bundled and never
declared as a runtime dependency, because a second copy of `effect` in a consumer's tree
gives `Context.Tag` a second identity and services stop resolving.

Each package's `exports` is an explicit subpath map rather than a `./*` wildcard, so a module
the map does not name is not reachable from a consumer.

## Versioning

All packages share one version and ship on one tag. `bun scripts/set-version.ts <version>`
rewrites the root and every workspace package; `git tag v<version>` triggers the release
workflow, which packs each package, attaches the tarballs to a GitHub Release, and
publishes to npm.

## Development

```sh
pnpm install
pnpm dod        # tsc + bun test + biome
```
