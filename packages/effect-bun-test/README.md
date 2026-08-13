# `@packages/effect-bun-test`

An Effect-native test harness on top of `bun:test`. It replaces the commonest Effect test shape —
an inline `Effect.runPromise(...)` per test — with `it.effect`, and replaces per-test layer
construction with a `layer()` block that builds once.

Two things it buys you:

- **Virtual time.** `it.effect` runs on Effect's `TestContext`, so a test that models ten seconds
  of elapsed time costs ~43ms of wall clock instead of ten seconds. See
  [Virtual time](#virtual-time-the-one-idiom) — there is exactly one correct idiom and it is not
  the obvious one.
- **Shared layers.** `layer(L)((it) => ...)` builds `L` **once** for the whole block rather than
  once per test.

## Status: vendored baseline, not a dependency

This package is **vendored**, not depended on. It is adapted from
[Effect-TS/effect PR #6236](https://github.com/Effect-TS/effect/pull/6236) (`@effect/bun-test`,
head `3f8d6e8af20aff446b1b24c153b9ddaa165b89a6`), and pinned against `effect@3.22.1` and bun
`1.3.14`.

`fast-check` is **not** a declared dependency here: the property-based registrars reach it through
`effect/FastCheck`, and `effect@3.22.x` depends on `fast-check@^3.23.1` itself — **v3, not v4**,
because Effect's `Arbitrary.make` uses fast-check's v3 random-generator API (`mrng.nextArrayInt`),
which v4 removed. Declaring a second copy here would risk two fast-checks in one tree.

The upstream-partnership posture applies: divergences and fixes are reported upstream on the PR,
and if upstream merges we re-evaluate switching to the published package. Everything we changed is
listed under [Divergence from upstream](#divergence-from-upstream) — keep that section current, it
is the input to the upstream report.

The package name is `@packages/effect-bun-test`. It is deliberately **not** `@effect/bun-test`: we
never shadow the upstream npm scope.

## Virtual time: the one idiom

**`TestClock` does not auto-advance.** A bare `Effect.sleep('10 seconds')` inside `it.effect` does
not resolve — measured, it was still suspended after two real seconds, and it will hang to the bun
test timeout.

So a test that waits on time must **fork the thing that sleeps**, advance the clock, then join:

```ts
it.effect('retries three times over a minute', () =>
  Effect.gen(function* () {
    const fiber = yield* Effect.fork(subjectUnderTest);   // fork the SLEEPER
    yield* TestClock.adjust('1 minute');                  // then advance
    const result = yield* Fiber.join(fiber);              // join supplies the sync
    expect(result).toEqual(...);
  }));
```

**Do not fork the adjuster.** Forking `TestClock.adjust` while the sleep runs on the test fiber is
a scheduling race, not an idiom: there is no happens-before edge between a forked adjuster and a
not-yet-registered sleep. If the adjust lands first, the later sleep registers at `now + duration`
against an already-advanced clock and never wakes. It happens to pass when nothing async precedes
the sleep and hangs deterministically as soon as anything does.

An explicit `Effect.yieldNow()` before the adjust is **not** required (a forked one-hour sleep
released in 17.4ms without one). Upstream's conformance suite includes one; we kept it there for
diff fidelity only.

### Symptom → cause

| Symptom | Cause |
|---|---|
| `test timed out after Nms`, no other diagnostic, and the test uses `Effect.sleep` / `Effect.timeout` / a retry schedule under `it.effect` | You never drove the `TestClock`. Use the fork/adjust/join idiom above. |
| Every test in a `layer()` block fails with the same error | The block's **layer build** failed. Each test re-reports the real cause; fix the layer, not the tests. |
| A test that models time passes but takes real seconds | You are on `it.live` / `it.scopedLive`, which use the real clock by design. |

This is the highest-traffic diagnostic in the package: TestClock's own "test is using time but is
not advancing the test clock" warning **never reaches you** — the harness removes the default
logger. A bare timeout with no explanation is what you actually get.

## API

Import the harness from the package root; the paved-path extensions are separate entry points, so
nothing pulls in a subsystem you are not using.

### Test registrars — `@packages/effect-bun-test`

| Export | What it does |
|---|---|
| `it.effect(name, fn, opts?)` | Runs an Effect on `TestContext` — **virtual clock**, annotations, sizing, test config. The default. Note `TestContext` installs no seeded `Random`, so random draws are still live and non-reproducible. |
| `it.scoped(name, fn, opts?)` | `it.effect` + a `Scope`, closed after the test. |
| `it.live(name, fn, opts?)` | Runs on the **real** clock and real services. Use only when real time is the point. |
| `it.scopedLive(name, fn, opts?)` | `it.live` + a `Scope`. |
| `it.effect.each(cases)(name, fn, opts?)` | Table-driven. Also `.skip`, `.only`, `.skipIf(c)`, `.runIf(c)`, `.fails`. |
| `it.effect.prop(name, arbs, fn, opts?)` | Property-based via fast-check; accepts Effect `Schema`s or raw `Arbitrary`s. |
| `it.prop(name, arbs, fn, opts?)` | Property-based, non-Effect. |
| `it.layer(L, opts?)(name?, f)` | Nested shared layer inside a `layer()` block. |
| `layer(L, opts?)(name?, f)` | Top-level shared layer — **builds once per block**. |
| `flakyTest(effect, timeout?)` | Retries an effect until it succeeds or the timeout elapses. |
| `describeWrapped(name, f)` | `describe` with harness methods bound. |
| `makeMethods(it)` | Bind the harness onto a custom registrar. |
| `addEqualityTesters()` | **No-op.** Kept for `@effect/vitest` API parity — see caveats. |
| `describe` `test` `expect` `beforeAll` `beforeEach` `afterAll` `afterEach` `mock` `spyOn` `jest` `setSystemTime` | Re-exported `bun:test` primitives, so one import serves the whole file. |

`TestContext` (the object passed to your test fn) carries `signal`, `onTestFinished`,
`onTestFailed`. **`ctx.signal` is inert** — see [Known limitations](#known-limitations).

### Assertions

For tagged errors, **`@packages/effect-test-kit/tagged` is canonical** — import it directly:

```ts
import { expectFailureTag } from '@packages/effect-test-kit/tagged';

const err = expectFailureTag(exit, 'TimeoutError');  // narrowed, no cast, fails loudly on mismatch
```

`expectTag`, `expectFailureTag`, `expectCauseFailureTag` and `expectLeftTag` each narrow a failure
to one member of a tagged union by its `_tag`, without an `as` cast and without `instanceof`, so a
converted call site trips neither `unsafeEffectTypeAssertion` nor `instanceOfSchema`. They throw
loudly on any deviation, rendering the actual value or `Cause` — a guard converted to one of these
can never silently pass.

> **This package deliberately does not re-export them.** A module whose only job is re-exposing
> another module's API is a barrel, and it makes dependency manifests lie: a package reaching
> `expect*Tag` through the harness never declares `@packages/effect-test-kit`, so its manifest no
> longer describes what it depends on. Two imports is not a real cost. If you want one import, the
> module has to earn it by adding behavior.

**One case the family cannot narrow: Effect `Config` failures.** Every `ConfigError` carries the
`_tag` `'ConfigError'`, with the real discriminant on `_op` — so `expectFailureTag(exit,
'MissingData')` will not match. Match on `_op`, or assert the rendered message.

`@packages/effect-bun-test/utils` also ships upstream's `node:assert`-based vocabulary
(`assertLeft`, `assertRight`, `assertSuccess`, `assertFailure`, `assertSome`, `assertNone`,
`assertTrue`, `deepStrictEqual`, `strictEqual`, `throws`, `throwsAsync`, …). **It is retained for
upstream parity only.** Prefer `bun:test`'s `expect` for values and the `expect*Tag` family for
tagged errors. One caveat if you do reach for it: `assertInstanceOf` trips the `instanceOfSchema`
lint (error severity) at any call site that passes an Effect `Schema` class.

### Config and environment — `@packages/effect-bun-test/env`

**`testConfigLayer` is the default paved path.** If the code under test reads configuration through
Effect `Config`, use it — it is the only concurrency-safe option here:

```ts
import { testConfigLayer } from '@packages/effect-bun-test/env';

layer(testConfigLayer({ DB_HOST: '127.0.0.1' }))((it) => { ... });
```

`withTestEnv(overrides)` and `scopedEnv(overrides)` are a **last resort**, for code that reads
`process.env` directly and cannot be moved to `Config`. They snapshot only the keys they touch and
restore exactly the prior state (including restoring an absent key as *absent*, not `''`). Their
constraints are real and are enforced where they can be — overlapping scopes on the same key fail
loudly with `EnvScopeConflictError` rather than silently corrupting each other's restore:

- Never under `bun test --concurrent` / `--max-concurrency` (in-process, so the global races).
- Never inside a concurrent `Effect.all`.
- Non-overlapping scopes only.

`bun test --parallel=N` is **fine** — it runs test *files* in worker processes and implies
`--isolate`, so cross-file interference does not arise.

All `process.env` writes in this package are confined to `src/env.ts` so they stay countable, and
so a consumer auditing `processEnvInEffect` has one file to read rather than a package to sweep.

### Fixture roots — `@packages/effect-bun-test/fixture-root`

Scratch directories for a suite belong **inside the repo under test**, not in `os.tmpdir()`. A
fixture that outlives its suite is a defect, and one stranded in a shared OS temp directory is
invisible until that directory has hundreds of thousands of entries.

```ts
import { suiteFixtureRoot } from '@packages/effect-bun-test/fixture-root-suite';

const fixtures = suiteFixtureRoot('manifest-parser');

it('reads a manifest', () => {
  const dir = fixtures.mkdir();
});
```

`suiteFixtureRoot(label)` mints under `<repoRoot>/.test-fixtures/` and registers its own `afterAll`
disposal. `makeFixtureRoot(label)` is the same thing without the hook, for callers that own their
lifecycle; `fixtureDirAtBase(prefix)` returns a single directory.

- **The repo root is found by walking up from this module** looking for a `pnpm-workspace.yaml` or
  `.git` marker, and it **throws** rather than falling back out-of-repo. Installed under
  `node_modules/`, that walk therefore lands on the *consumer's* root — which is why this package
  ships `src/` only and no workspace file. A stray `pnpm-workspace.yaml` inside the published
  tarball would stop the walk inside `node_modules` and mint every fixture in the wrong place.
- Each directory carries a `<label>--<host>--<pid>--<random>` ownership token, so
  `@packages/fixture-residue/sweep` can tell a live suite's fixture from one a crashed run
  stranded. The first mint in a process reports pre-existing residue on stderr and does **not**
  reap it, so a tooling plane can see it.
- **`afterAll` does not run on a bail-out, a `SIGKILL`, or a runner crash**, so treat the residue
  report as a real signal rather than untidiness, and never let a reaper excuse a missing
  `dispose()`.
- If a suite runs `git` inside a fixture, strip `GIT_LOCATION_VARS` from the child environment with
  `withoutGitLocationVars(process.env)`. An in-repo fixture plus an inherited absolute `GIT_DIR`
  makes the child operate **silently** on the real repository.

### Scripted subprocesses — `@packages/effect-bun-test/command`

Three surfaces over one matching engine. **Pick by what the subject already speaks** —
`@effect/platform` is an optional peer dependency, so the executor surfaces install only for
consumers that actually use them.

| Surface | Use when | Verifies? |
|---|---|---|
| **`ScriptedCommandExecutor(expectations, opts?)`** | Production code yields `CommandExecutor`. **This is the paved path.** | **Yes** — an unexpected spawn fails through the executor's own error channel, and unconsumed expectations fail the test from the layer's scope finalizer. |
| **`commandExecutorLayer(builder)`** | Same, but you need the builder in reach to assert against it. | **Yes** — same finalizer. |
| **`TestCommandExecutor(script)`** | Stateless stubbing: answer each `Command` from a plain function. | **No.** |

`TestCommandExecutor` has no expectation list, so there is nothing to exhaust and **nothing is
verified on scope close** — it cannot tell you that an expected spawn never happened. That is the
false-green this package exists to remove, so reach for `ScriptedCommandExecutor` unless you
specifically want a stateless stub.

For seams that are **not** `CommandExecutor`:

- **`ScriptedProcess(expectations, opts?)`** — a runner-agnostic fixture builder keyed by argv
  matcher, handing back minimal `Subprocess`-shaped fakes. It scripts processes; it does **not**
  define whose service consumes them. Repo-local spawn seams compose their own test layer on top of
  it, behind their own existing `Context.Tag`.
- **`scopedScriptedProcess(expectations, opts?)`** — the same builder with verification wired to the
  enclosing scope. Prefer it.

Matching is **argv-matcher-keyed by default**; pass `ordered: true` only when spawn order is
genuinely part of the contract under test (production code that spawns concurrently has no
deterministic order).

**Silence is opt-in, never the default.** Every scoped surface —
`ScriptedCommandExecutor`, `commandExecutorLayer`, `scopedScriptedProcess` — fails the test on scope
close if any expectation went unconsumed or any spawn was rejected, *including* a rejection whose
`throw` was swallowed because production code spawned from a forked fiber. There is nothing to
remember to call; to script a deliberately-partial run, opt out explicitly with
`allowUnconsumed: true` or `ignoreRemaining()`. Use them under `it.scoped` / `it.scopedLive`.

The bare `ScriptedProcess(...)` builder has no scope to hang a finalizer on, so there you must call
`assertExhausted()` yourself. That is the weaker path — reach for a scoped form unless you have a
reason not to.

#### Scripted delay means different things on the two surfaces — read this before using it

| Field | Surface | Clock |
|---|---|---|
| `ScriptedExpectation.delayMs` | `ScriptedProcess` / `scopedScriptedProcess` | **Real** — a `setTimeout`, elapses on its own |
| `TestProcessResult.delay` | the three `CommandExecutor` surfaces | **Virtual** — an `Effect.sleep`, so under `it.effect` it does **not** elapse unless the test advances `TestClock` |

A subject that waits on a scripted delay through a `CommandExecutor` surface will therefore appear
to hang under `it.effect` until you drive the clock (see [Virtual time](#virtual-time-the-one-idiom)).
This is a genuine footgun and it is asymmetric, so check which surface you are on.

Relatedly, the executor surfaces memoize that delay with `Effect.cached`. That is a **correctness**
property, not an optimization: without it a subject that reads stdout *and then* `exitCode` would
need `2 x delay` of `TestClock.adjust` and would look like a hang.

#### Why the fakes behave like the real executor

The `CommandExecutor` surfaces implement **only `start`** and let `CommandExecutor.makeExecutor`
derive `exitCode`, `string`, `lines`, `stream` and `streamLines`. So the fake behaves identically to
the real executor by construction, instead of being five hand-written fakes that can drift from it
independently. Copy that shape if you build a fixture for another `@effect/platform` service.

## Upstream caveats (preserved deliberately, not shimmed)

These are real gaps in the `bun:test` port relative to `@effect/vitest`. We kept them visible
rather than papering over them:

- **`addEqualityTesters` is a no-op.** `bun:test`'s `expect` does not expose `addEqualityTesters`.
  Compare `Equal`-implementing values with `Equal.equals` directly.
- **No `scopedFixtures`.** No equivalent exists.
- **`TestContext` is wrapper-synthesized, not runner-passed.** Bun does not hand a context object
  to the test fn, so the harness synthesizes one. `onTestFinished` / `onTestFailed` run
  best-effort *after* the Effect resolves, and their callbacks' failures are swallowed.
- **`export * from 'bun:test'` does not work on Bun.** The re-exports in `src/index.ts` are
  explicit `const` bindings for that reason — do not "simplify" them back into a star export.
- **The `memoMap` option does not share across sibling blocks.** Sharing works only while the
  owning `Scope` is open, i.e. for *nested* `it.layer`. Two sequential sibling `layer()` blocks each
  own their scope and tear down at their own `afterAll`, so the memo entry is released and the next
  block **rebuilds** (measured: `builds=2` with a teardown in between). Passing a shared `memoMap`
  between siblings measures no gain — it is not a cross-describe sharing mechanism. It is the only
  advertised way to share an expensive fixture across sibling describe blocks, so this caveat is
  here rather than left to be rediscovered per-chunk.

## Known limitations

- **`ctx.signal` is inert.** It is a fresh `AbortController().signal` that nothing ever aborts.
  Threading it into `HttpClient` or `fetch` gives you a signal that never fires. It is not a
  cancellation mechanism.
- **A timed-out test does not interrupt its fiber.** The fiber stays suspended for the life of the
  process, which is why a leaked fiber can still run finalizers later.

## Lint diagnostics this package carries on purpose

A consumer sweep will surface these. **They are inherent to the contracts and must not be
"fixed"** — each one is the module doing its job, and silencing it would launder the contract away.

| Diagnostic | Where | Why it is correct here |
|---|---|---|
| `processEnvInEffect` | `src/env.ts` | The module exists to mutate `process.env`. Every such write in the package is confined to this one file precisely so the count stays honest and countable. |
| `newPromise`, `globalTimers` | `src/command.ts` | `ScriptedHandle.exited: Promise<number>` and the real `setTimeout` behind `delayMs` are mandated by the runner-agnostic `Subprocess` shape the fake has to satisfy. An Effect-native substitute would stop it being a drop-in fake. |
| Effect-running at a synchronous boundary | `src/internal/**` | Running Effects at the boundary between bun's synchronous registrar and the Effect runtime *is* this package. `env` / `command` / `utils` stay ordinary library code. |

If a future sweep proposes removing any of these, the burden is on the sweep to show the contract
survives, not on this package to comply.

## Migration cookbook

**Before** — a layer rebuilt per test, real clock, inline runner:

```ts
import { describe, expect, it } from 'bun:test';

describe('StreamService', () => {
  it('resolves a manifest', async () => {
    await Effect.runPromise(
      program.pipe(Effect.provide(StreamServiceLive), Effect.provide(HttpClientLive)),
    );
  });
});
```

**After** — layer built once for the block, virtual clock, no inline runner:

```ts
import { expect, layer } from '@packages/effect-bun-test';

layer(Layer.mergeAll(StreamServiceLive, HttpClientLive))('StreamService', (it) => {
  it.effect('resolves a manifest', () =>
    Effect.gen(function* () {
      const result = yield* program;
      expect(result).toEqual(...);
    }));
});
```

**Anything that waits on time** additionally needs the fork/adjust/join idiom — that is the single
most common conversion mistake, and its only symptom is a bare timeout.

## Divergence from upstream

Every intentional delta from PR #6236, kept current so the upstream report stays accurate.

### Additions (no upstream counterpart)

Roughly 1,200 lines of new code that PR #6236 has no equivalent for. Listed here because the
upstream report has to be complete in *both* directions, and additions are the easiest divergence to
forget — they conflict with nothing.

| Module | Exists for |
|---|---|
| `src/env.ts` | `testConfigLayer` (the concurrency-safe default for `Config`-reading code), plus `withTestEnv` / `scopedEnv` escape hatches with a shared overlap registry that fails loudly instead of corrupting a restore. |
| `src/command.ts` | Scripted subprocess fixtures: three `CommandExecutor` surfaces and the runner-agnostic `ScriptedProcess` builder, with default-on end-of-scope verification and typed violations. |

### Repo-conformance changes

| Divergence | Why |
|---|---|
| Package renamed `@packages/effect-bun-test`; imports rewritten off `@effect/bun-test` | Never shadow the upstream npm scope. |
| `export namespace BunTest { ... }` flattened to top-level exported types (`BunTest.Methods` → `Methods`, `BunTest.Tester` → `Tester`, …) | This repo contains **zero** `namespace` declarations. Names otherwise unchanged so upstream diffs stay readable. |
| Upstream's `interface` declarations are **kept as `interface`** | An earlier pass converted them to `type` on the strength of `CLAUDE.md`'s style preference. That was reverted: `useConsistentTypeDefinitions` is **not** configured, so the preference is not a mechanical gate here — while every converted declaration is a permanent spurious diff hunk against upstream on every re-sync. Recurring cost, zero benefit, so upstream fidelity wins. Six ship as `interface` in `src/types.ts` (`TestContext`, `TestOptions`, `TestCollectorCallable`, `Tester`, `MethodsNonLive`, `Methods`) plus `BunTestApi` in `internal.ts`. |
| `TestFunction`, `Test`, `BunRegistrar` are `type`, not `interface` — **a real gate, not a preference** | `useShorthandFunctionType` **is** active (biome recommended defaults) and fires on any interface whose only member is a call signature, demanding `type X = (a) => b`. Verified empirically: an `interface` with a lone call signature is flagged `lint/style/useShorthandFunctionType`, and `pnpm check` runs `--error-on-warnings`. This gate genuinely overrides upstream fidelity, so these three diverge by necessity rather than by choice. |
| `Arbitraries`, `PropValues`, `PropOptions` are `type` | Union, mapped and conditional types **cannot** be interfaces. Not a divergence by choice either. |
| All 35 explicit `any` removed (index 3 / internal 30 / utils 2); 2 `@ts-ignore` and 1 dead `eslint-disable` removed | `noExplicitAny` is a biome **error** here and suppression directives are banned. The public type inference is preserved; see the per-site notes below. |
| Docgen `@since` tags and `docgen.json` / `tsconfig.{build,src,test}.json` dropped | We do not run upstream's docgen pipeline. |
| `fast-check` is not a declared dependency | Reached through `effect/FastCheck`; `effect` already depends on it, and a second declaration risks two copies in one tree. |
| Test layout `test/` → `__tests__/` | Repo convention. |
| `bunfig.toml` preloads `../../scripts/test-timezone.ts` | Pins `TZ=UTC` so a date-rendering assertion cannot pass or fail on the host's zone. |

### Fixes to genuine upstream defects (report these on PR #6236)

| Defect | Fix |
|---|---|
| `it.effect.each(...)` accepted a `timeout` and silently discarded it — every table-driven call site that set one got bun's default instead. | Timeout forwarded through `each` → `defaultApi.for` → bun's `test.each`, with a conformance case proving a per-case timeout is honored. |
| Nested `it.layer` did not typecheck (`TS2345`: `Exclude<R, TestServices \| R>` is not provably `never` for generic `R`, while the outer `layer` signature required `RIn = never`). It ran correctly, so the runtime evidence masked a type-level break. | The recursive call restates the already-proven closed layer shape through a documented `as unknown as` cast at `src/internal/internal.ts`. This is a genuine TypeScript expressiveness limit — `Exclude<R, TestServices \| R>` is structurally `never` but TS cannot reduce it while `R` is still a type parameter — not a suppressed error. |
| A `layer()` build failure made its tests **vanish**: bun attributed the failure to a phantom `(unnamed)` test and silently dropped every test registered in the block, so the reported test count shrank instead of going red. `Effect.orDie` additionally erased the typed layer error. | The build outcome is absorbed and re-observed per test (`runtimeEffect` is `Effect.cached`), so each test fails individually with the real cause. Verified: a block of two tests behind a failing layer now reports `Ran 2 tests ... 2 fail`, naming both tests and surfacing the underlying `BoomError` with its `_tag` — where upstream reported one phantom `(unnamed)` failure and zero named tests. Resource release on build failure was already correct and was left alone. |

### Behavioral questions upstream left open, resolved here

| Question | Resolution |
|---|---|
| Does the runner auto-advance `TestClock` on sleep suspension? | **No.** Measured: a bare 10-second sleep was still suspended after 2s real. The fork/adjust/join idiom is mandatory and is documented above as *the* repo idiom. |

### Deliberately NOT changed

- The `layer()` scope/`beforeAll`/`afterAll` construction, including `Effect.runSync(Scope.make())`
  at collection time. Resource release is correct even when a layer build fails; this was probed,
  not assumed.
- The upstream conformance suite's `import { ... } from 'effect'` root-barrel imports in tests —
  `importFromBarrel` does not fire on them.
- `src/utils.ts`'s assertion vocabulary, retained for upstream parity though `@packages/effect-test-kit/tagged` is canonical for tagged errors.
