# effect-bun-tooling

General-purpose Effect + Bun test tooling, published as **source TypeScript with no
build step**. Every package's `exports` map points at `./src/*.ts`; consumers resolve
and execute the TypeScript directly under Bun.

## Packages

| Package | Purpose |
|---|---|
| `@angel-studios/uuid-effect` | Effect-native UUID service: crypto-entropy UUIDs injected through Effect context, with a deterministic test layer. |

## Consuming

Requires a runtime that executes TypeScript directly (Bun) and a TypeScript
`moduleResolution` that honours `exports` (`bundler`, `node16`, or `nodenext`).

Two resolution paths, one seam. Registry:

```jsonc
{ "dependencies": { "@angel-studios/uuid-effect": "^0.1.0" } }
```

GitHub Release tarball (no registry credentials needed):

```jsonc
{
  "dependencies": {
    "@angel-studios/uuid-effect": "https://github.com/Angel-Studios/effect-bun-tooling/releases/download/v0.1.0/angel-studios-uuid-effect-0.1.0.tgz"
  }
}
```

`effect` is a **peer** dependency of every package here. It is never bundled and never
declared as a runtime dependency, because a second copy of `effect` in a consumer's tree
gives `Context.Tag` a second identity and services stop resolving.

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
