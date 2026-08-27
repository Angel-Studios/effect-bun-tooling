---
scope: monorepo
audience: every-session
verified: 2026-08-22
verified-against:
  - package.json
  - bunfig.toml
  - .github/workflows/ci.yml
  - .github/workflows/release.yml
  - .toolplane/config.toml
  - .toolplane/gates.toml
  - .toolplane/pool.toml
  - .claude/settings.json
  - sgconfig.yml
  - .ast-grep/rules/no-run-sync-in-library.yml
  - .ast-grep/rules/effect-bun-test-no-leaked-global-it.yml
  - scripts/build-packages.ts
  - scripts/pack-workspace.ts
  - scripts/assert-tag-version.ts
  - tools/lint-claude-md/lint-claude-md.ts
review-cadence: on-architectural-change
---

# CLAUDE.md

TypeScript / Effect / Bun repository. It publishes general-purpose Effect + Bun test tooling to npm
under the MIT licence. What separates it from an ordinary monorepo is that every package here is
consumed by OTHER repositories as an installed dependency, so a change to an export map, a peer
range, or a runtime assumption is a change in someone else's tree that arrives through a version
bump rather than a merge. The invariants below are weighted toward what a CONSUMER receives.

## The published packages
Every directory under `packages/` is a separately published package with its own `exports` map and
its own README. The test-tooling core is `effect-bun-test` (the Effect-native harness over
`bun:test`: `it.effect` / `it.scoped` / `layer()`), `bun-svelte-test` (a `Bun.plugin` Svelte 5
loader plus a happy-dom preload), `effect-test-kit` (cast-free tagged-error assertions), and `uuid-effect`. The `.test-fixtures`
ownership-token convention lives in `effect-bun-test`'s `fixture-root`; the residue sweep that used
to classify and report stranded fixture directories was DELETED, not relocated. Start at `scripts/build-packages.ts` for what a publish actually emits and
`scripts/pack-workspace.ts` for the tarball path the e2e suite installs from.

The package list is deliberately not enumerated with a count here: `packages/*` is the workspace
glob, discovery is structural, and a hardcoded number goes stale the moment one is added. What every
package owes, whatever it is for, is the contract in the rest of this file.

## The harness is the boundary between Effect and foreign callback APIs
**Rule:** A file under `packages/` may call `Effect.run*` only where a foreign API demands a plain
value or a `Promise` and no caller exists above it to hand an Effect to; every such file is named
one at a time in the `no-run-sync-in-library` ignore list, never covered by a directory glob.
**Why:** these packages exist to sit at that seam. `bun:test` calls `it(name, cb)` and awaits a
Promise, `Bun.plugin` calls a loader hook, and SvelteKit's `$app/navigation` contract returns bare
Promises, so something has to run the Effect into the shape the foreign API requires. That is the
same reason the rule already exempts `**/main.ts`. A directory-wide carve-out would silently bless
the next run site added anywhere under the package, which is the one thing the rule is for.
**How to apply:** when a new run site is genuinely at a foreign seam, add the FILE to the ignore
list with the reason. Renaming a library module to `index.ts` to fall through the existing glob is
laundering and is banned. Ten files carry the exemption today; each names the API it adapts.
**Enforced by:** `.ast-grep/rules/no-run-sync-in-library.yml` at error severity, run by `bun run
lint:ast` as the `lint-ast` gate, currently at zero findings over a non-empty input set.

## A rule that fires on this repo's own counter-example is still a true positive
**Rule:** When a lint rule matches a file whose PURPOSE is to exercise the defect that rule
describes, silence it by naming that one file with the reason, and never by weakening the rule body.
**Why:** `packages/effect-bun-test/__tests__/test-services-isolation.test.ts` reaches for the
module-global `it` after a `layer()` block on purpose, to assert that the global still resolves
against its own TestClock. Loosening `effect-bun-test-no-leaked-global-it` until that file passed
would disarm the rule for every consumer of this harness, which is the population it exists to
protect. The same reasoning covers the one `Promise.resolve` bridge in the harness internals.
**How to apply:** prefer a file-scoped `ignores` entry with the reason, or an inline
`// ast-grep-ignore: <rule-id>` directly above the line, and state what would make the exemption
expire. An exemption that outlives its reason is deleted, never widened.
**Enforced by:** advisory; the evidence is the reasoned `ignores` block in
`.ast-grep/rules/effect-bun-test-no-leaked-global-it.yml` and the inline directive in
`packages/effect-bun-test/src/internal/internal.ts`.

## Hard Constraints (DO NOT)

- **NO package manager other than bun.** `packageManager` pins `bun@1.4.0` and `engines` requires
  it; there is no `pnpm-workspace.yaml`, no `package-lock.json`, and no npm or yarn lockfile. The
  workspace catalog lives inside `package.json` and is resolved by bun's `catalog:` protocol, which
  pnpm does not read. Enforced by: `bun.lock` being the only committed lockfile, and every CI job in
  `.github/workflows/ci.yml` installing with `bun install --frozen-lockfile`.
- **NO test runner other than `bun test`.** The whole point of `effect-bun-test` is that it retired
  the vitest carve-out that existed only because bun had no native `.svelte` loader. Adding vitest
  or jest back as a dependency would reintroduce the runner this repo exists to remove. Enforced by:
  advisory; the packages declare no test-runner dependency and `test:unit:once` is `bun test`.
- **NO dependency lifecycle script at install.** `bunfig.toml` sets `[install] ignoreScripts = true`
  because `msgpackr-extract`, pulled in transitively by effect, is on bun's default trusted list and
  its postinstall spawns node through `node-gyp-build-optional-packages`. Nothing here needs a native
  build. An empty `trustedDependencies` array in `package.json` does NOT do this: bun reads `[]` as
  unset. Enforced by: `bunfig.toml`, which every `bun install` in this repo reads.
- **NO version bumped in one place only.** `scripts/set-version.ts` writes the root and every
  package together, and the release workflow refuses a tag that disagrees with the manifests.
  Enforced by: `scripts/assert-tag-version.ts`, run by `.github/workflows/release.yml` before the
  publish step.

## Definition of Done

`bun run dod` runs build, `tsc`, `lint:effect`, `test:unit:once`, `lint:ast`, `lint:claude-md` and
`check:ci` in that order. Unlike the ultravisor plane repo, **this repo has a real CI gate**:
`.github/workflows/ci.yml` triggers on `pull_request` and on a push to `main`, and its `dod` job
re-runs the same commands, so a branch under review is gated whether or not the local hook ran. The
`pack` job additionally proves a consumer can install the packed tarballs with nothing else
declared, which is the only check that exercises what npm actually receives.

Two scoping facts change how a green run should be read. `bun run build` runs FIRST because the
packages publish `dist` and the e2e suite installs tarballs, so a type error reachable only from a
built entry point is invisible until the build has run. And `lint:claude-md` refuses an empty scan
set with exit 3 rather than reporting a pass, so a walker that silently stopped finding files is
never green.

## One-way doors

- **A published version cannot be unpublished.** `scripts/pack-workspace.ts` builds the tarballs and
  the release workflow pushes them; a wrong export map or peer range reaches consumers immediately
  and is fixed only by a new version.
- **`bun install` writes no lockfile for pnpm, and pnpm writes none for bun.** Only `bun.lock` is
  committed, so a contributor who reaches for pnpm resolves a DIFFERENT dependency tree than CI
  installs, with no file recording the divergence.
- **The `lint-claude-md` repo-root walk was widened here and is not upstream.** The ultravisor copy
  accepts only `pnpm-workspace.yaml` as a workspace-root marker, which walks past this repo's root
  and exits as a script error. The ported copy in `tools/lint-claude-md/` also accepts `bun.lock`,
  `bun.lockb` and `.git`. Re-copying the upstream file over it silently restores the refusal.
