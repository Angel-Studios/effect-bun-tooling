# `@packages/bun-svelte-test`

Makes `bun test` able to compile and mount Svelte 5 components, so component tests
run on the same harness as everything else in the monorepo and vitest can be removed.

No vite. No vitest. No `@sveltejs/vite-plugin-svelte`.

## Consumer wiring

**1. Take the dependency edge.** In the consumer's `package.json`:

```jsonc
"devDependencies": { "@packages/bun-svelte-test": "workspace:*" }
```

This is **mandatory, not optional**, even though the `preload` path below may be relative.
The dependency edge is what makes an affected-project filter — CI's, a pre-commit hook's —
treat a loader change as affecting this package's suite. A relative-path preload *without*
the dependency edge means a loader regression lands silently and only surfaces on a full run.

**2. Preload it.** In the consumer's `bunfig.toml`:

```toml
[test]
preload = ["@packages/bun-svelte-test/register"]
```

**3. Map `$app/*` in a test-scoped tsconfig.** See the next section.

## Resolution contract

| Specifier | Mechanism | You must |
|---|---|---|
| `./Foo.svelte` | `onLoad` -> `compile()` | nothing |
| `./foo.svelte.ts` | `onLoad` -> type-strip -> `compileModule()` | nothing |
| `$lib/*` | bun reads tsconfig `paths` from SvelteKit's generated `.svelte-kit/tsconfig.json` | run `svelte-kit sync` |
| `$app/environment`, `$app/navigation`, `$app/state` | tsconfig `paths` -> the doubles in `dist/app-doubles/` | declare them (below) |
| `svelte`, `svelte/legacy`, `svelte/reactivity`, `svelte/store` | `onLoad` substitutes the browser build | nothing |

There is **no `onResolve` anywhere in this package**: in bun 1.3.14 a runtime plugin's
`onResolve` never fires. Every resolution concern is tsconfig `paths`.

### The `$app` doubles, and the `paths` trap

bun resolves tsconfig `paths` from the **nearest tsconfig to the importing file**. Put
them in a test-scoped `__test__/tsconfig.json` so test files get `$app/*` while `src/`
files correctly reject it:

```jsonc
{
  "extends": "../tsconfig.json",
  "compilerOptions": {
    "paths": {
      // TRAP: `paths` does NOT merge across `extends`. A child block REPLACES the
      // parent's entirely, so re-declare every inherited key you still need.
      "$lib": ["../src/lib"],
      "$lib/*": ["../src/lib/*"],
      "$app/types": ["../.svelte-kit/types/$app/types"],

      // A path RELATIVE TO THIS FILE, into the installed package. `.js` serves both sides:
      // bun loads the built module, and TypeScript maps `.js` to the `.d.ts` beside it.
      "$app/environment": ["../node_modules/@packages/bun-svelte-test/dist/app-doubles/environment.js"],
      "$app/navigation": ["../node_modules/@packages/bun-svelte-test/dist/app-doubles/navigation.js"],
      "$app/state": ["../node_modules/@packages/bun-svelte-test/dist/app-doubles/state.js"]
    }
  }
}
```

**TRAP: the value must be a path, not a package specifier.** The obvious spelling —
`["@packages/bun-svelte-test/app-doubles/state"]`, naming the exported subpath — does **not**
resolve. Measured on bun 1.3.14: bun's tsconfig `paths` implementation resolves a relative path and
fails a bare specifier with `Cannot find module '$app/state'`, with or without `baseUrl`. The
exports map is unused on this route, so the path reaches into `dist/` directly.

**What this file is for.** It is read by **bun at runtime**, which resolves tsconfig `paths`
from the nearest tsconfig to the *importing* file — that is what gives test files `$app/*`
while leaving `src/` unable to resolve it. Whether it is also a separate `tsc` project is a
per-package choice: check what your own package's `include` covers rather than copying a
command from here.

This package itself declares the same three `$app/*` keys in its **root** `tsconfig.json`
instead, pointing at its own `src/`, because that is where the doubles live and there is
nothing to hide them from. A consumer with real `src/` code must scope them to the test directory as above, or
production code will resolve `$app/*` to the doubles.

## What the preload does, in order

1. Fails fast, **by name**, if this package's tsconfig extends `.svelte-kit/tsconfig.json`
   and that file is missing — it is gitignored, so a fresh checkout or new worktree needs
   `svelte-kit sync`. Without this you get a bare `Cannot find module '$lib/...'` that
   reads exactly like a loader bug.
2. Registers happy-dom globals via `@happy-dom/global-registrator`.
3. Registers the loader plugin.
4. **Asserts the svelte browser-build substitution took, and throws if not.**
5. Eagerly imports `@testing-library/svelte`, if the consumer installed one, to wire its
   auto-cleanup. It is probed for at runtime and declared as a dependency nowhere.
6. Registers an automatic `afterEach` reset. Never opt-in.

### Why step 4 exists

Plain `bun test` resolves svelte's entry to `index-server.js`. Every failure mode that
follows is **silent**:

- `flushSync`, `onMount`, `beforeUpdate`, `afterUpdate` are all the same `noop` — they do
  not throw, they just do nothing. Tests keep "passing" while asserting on a DOM that
  never updated.
- `svelte/reactivity` hands out plain `globalThis` Map/Set/Date with no error.

So the loader substitutes the browser build, and the preload then *proves* it did:
`flushSync !== onMount`, `mount.toString()` has no `lifecycle_function_unavailable`, and
`SvelteMap !== globalThis.Map`. A failure throws with the likely cause named.

The substitution set is **derived**, not hardcoded: at preload the plugin reads the
installed svelte's `package.json` `exports` map and substitutes every subpath carrying a
`browser` condition. At 5.56.4 that is four subpaths (`.`, `./legacy`, `./reactivity`,
`./store`) — a naive `index-server.js` -> `index-client.js` string swap would catch one of
four and would break on any internal layout change.

A `--conditions browser` CLI flag would also work, and was **rejected**: it has to be
threaded through every consumer script and CI job, and one place that misses it is a silent
coverage cliff.

## The `$app` doubles — read this before porting a test

The doubles are real modules resolved through tsconfig `paths` (`mock.module` is banned
repo-wide). Their API is **`setPage` / `resetPage` / `resetNavigation`**. `resetPage` and
`resetNavigation` are wired into the automatic per-test reset, so you do not call them
yourself.

**`$app/state` is NOT reactive, and this is the difference most likely to make a ported
test pass for the wrong reason.** The real `$app/state` is `$state`-backed; this double is
a plain object. A component therefore reads `page` **once, at mount**, and never re-renders
when you change it.

```ts
// CORRECT — set the route, then mount.
setPage({ url: new URL('https://x/lab/devices/42') });
const { container } = render(DevicePage);

// WRONG — mounts against the default page, then mutates it. The DOM does NOT
// update, no error is thrown, and the assertion fails for a misleading reason
// (or worse, passes because it was asserting the default all along).
const { container } = render(DevicePage);
setPage({ url: new URL('https://x/lab/devices/42') });
```

Always call `setPage()` **before** mounting. A test pinning this non-reactivity ships with
the package, so the behaviour cannot change silently underneath you.

Two more things that will catch you when porting:

- **Runes are unavailable in `.test.ts` files.** `$effect.root` and friends throw
  `rune_outside_svelte` from a test file. Rune-using helpers must live in a `.svelte.ts`
  fixture, which this loader compiles via `compileModule`.
- **A green local run proves neither CI-safety nor isolate-safety.** Validate with
  `CI=true bun test` as well. A local gate that leaves `CI` unset cannot see an
  environment-conditional failure at all — a harness in the originating monorepo threw at
  import time only under `CI=true` for exactly that reason.

## Automatic per-test reset

Within one worker, bun runs many test *files* in one process against one shared `Window`
and one shared module graph. `resetDom()` runs after every test and, **in this order**:

1. **destroys every live component** (see below), then
2. resets `document.body`, `localStorage`, `sessionStorage`, `location`, focus, and the
   `$app` doubles.

`document.head` is cleared of test residue **except `<style>` elements**, which are
preserved: components compile with `css: 'injected'`, so those styles belong to the module,
not to the test.

Extend it with `registerResetHook(fn)` for your own module-level globals, or
`registerTeardownHook(fn)` for work that must happen *before* the DOM is cleared.

Known limitation: `history.length` is not resettable (happy-dom exposes no history-clear
API). `location` is returned to `http://localhost:3000/`.

### Clearing the DOM is NOT component teardown

`document.body.innerHTML = ''` removes **nodes**. It cannot destroy a Svelte effect root.
A component that is only detached is still **running**: its `$effect`s stay subscribed, its
intervals and timeouts keep firing, and its `window` / `document` listeners keep handling
events — for the rest of the process, across every test file that follows.

That failure mode is invisible to the obvious assertion. A leaked component sits happily
next to `expect(document.body.innerHTML).toBe('')`. It was measured in the originating
monorepo with a **cross-file** pair: with teardown disabled, a component mounted by one test
file answered a `window` event dispatched from the next file while the body read empty.

So teardown is real `unmount()` from `svelte`, and it runs **before** the DOM is cleared —
while the component's nodes are still attached and its effect root still reachable.

**That cross-file proof is not in this repo**, and the reason is worth stating rather than
rediscovering. A test cannot assert on a *later* file's state in-process, so the pair has to
be driven by a parent that spawns a child `bun test` over the two halves in a fixed order —
and a unit suite here may not spawn a subprocess. What survives is the mechanism itself plus
the single-file assertions in `__test__/`; a differential of that shape belongs in an
`__e2e__/` suite, not in this one.

One consequence of the missing pair: `bun test --coverage` here leaves the `active.blur()`
focus reset and the body-attribute sweep in `src/dom.ts` uncovered. Do not read them as dead
code. This package sets no `coverageThreshold`, so no gate is affected.

### Which mount path guarantees teardown

| Path | Teardown | Mechanism |
|---|---|---|
| `mountComponent()` from this package | **automatic** | registered per mount; `resetDom()` calls svelte `unmount()` |
| `render()` from `@testing-library/svelte` | **automatic** | testing-library's own auto-cleanup, wired at preload |
| bare `mount()` imported from `svelte` | **none — you own it** | call svelte's `unmount()` yourself |

Reaching for bare `mount()` opts out of every guarantee above. Prefer `mountComponent()`.

The `unmount` returned by `mountComponent()` is idempotent: calling it explicitly and then
letting the automatic teardown run again is safe, and does **not** trigger svelte's
`lifecycle_double_unmount` warning. `unmountAll()` is exported for consumers driving
`resetDom()` manually.

## Compile options

```ts
{ filename, generate: 'client', dev: true, css: 'injected' }
```

`runes` is deliberately **not** set. Passing `runes: true` *forces* runes mode on every
file, so any legacy-authored component fails outright — `export let` is rejected with
`legacy_export_invalid`. Svelte 5 auto-detects per file and compiles both dialects, which
is the only correct default for a loader that may see third-party `.svelte` sources it
does not own. (Measured against a real third-party library — `@xyflow/svelte@1.5.2`, whose
52 uncompiled `.svelte` files all compile under both settings because they are already
runes-authored — so the decision rests on the general argument, not on that package.
`__test__/fixtures/LegacyGreeting.svelte` is the positive oracle for auto-detection: it uses
`export let` and `$:`, both of which are compile ERRORS under `runes: true`.)

`dev: true` buys real component names and useful runtime errors; it also enables ownership
validation.

`.svelte` files with `lang="ts"` need no pre-pass — `compile()` handles TypeScript natively.
`.svelte.ts` runes modules **do**: `compileModule()` has no TypeScript support and throws
`js_parse_error` on the first annotation, so they are type-stripped with `Bun.Transpiler`
(bun built-in — no extra dependency) before compiling.

## `bun test --parallel` is UNSUPPORTED — and now refused

**Do not run suites using this loader with `--parallel`.** The loader detects it and
**fails every test loudly**. That refusal is deliberate; it replaces a silent
wrong-answer failure mode.

### The measured reason

Under `--parallel` (bun 1.3.14), everything a preload does **after a top-level `await`
is silently abandoned** — the continuation never runs at all, so no hook it would have
registered is ever wired. `register.ts` reaches its first `await` at step 4, so
`--parallel` discards:

- the **svelte browser-build assertion** — so that guard cannot fire even when it should;
- `@testing-library/svelte`'s automatic render cleanup;
- the **automatic per-test reset** of the DOM, storage, location, and the `$app` doubles.

Tests then bleed into one another: `goto.mock.calls` accumulates across tests, and a
component mounted by one test reads a `page` a *different* test wrote. `--parallel` also
runs separate files in **separate processes**, so cross-file cleanup proofs cannot hold.

Note this is *not* tests racing on a shared DOM — `--parallel` does not interleave tests
within a file (measured: one PID, strictly serial). The hazard is the truncated preload.

### How the refusal works

The flag is **not** detectable: `process.argv`, `process.execArgv`, and `Bun.argv` are
identical with and without it. So `register.ts` registers a `beforeEach` **before** its
first `await` (that hook always survives) which throws unless a flag set on the file's
**last line** is true. Reaching that line is the proof the preload actually resumed.
Serial runs complete the whole preload before any test starts, so the guard cannot
false-positive.

The RED/GREEN proof of that refusal needs a child `bun test` run under `--parallel` and an
**unguarded** preload control, so like the cross-file teardown pair it belongs in an
`__e2e__/` suite rather than this unit suite. Measured in the originating monorepo: 55 pass
serial, 0 pass / 55 fail with `--parallel` wired.

## Version coupling

- **svelte** is a **peer** dependency (`^5.56.8`), and the one this package can least afford to
  duplicate: components compile with whichever svelte resolves in the consumer's tree, and
  compiler output binds `svelte/internal/client` at runtime, so compiling against one copy while
  mounting on another fails in exactly the silent way step 4 of the preload exists to prevent.
  Measured on bun 1.3.14: as an ordinary dependency, a consumer on `svelte@4.2.19` silently
  receives a nested `svelte@5.56.9`; as a peer they get a warning and no second copy. A consumer
  still declares nothing, because bun auto-installs a missing peer. The `^` range lets their own
  svelte dedupe onto one copy; a bump re-verifies this package's fixture suite. The browser
  substitution is derived from the installed version's `exports` map, so it survives most bumps —
  and hard-fails loudly rather than silently if it ever does not.
- **`@testing-library/svelte`** is declared NOWHERE, by design. The loader probes for it at
  preload time with `Bun.resolveSync` and a dynamic `import`, so it is a pure runtime opt-in
  rather than an optional peer a consumer has to know to decline. Absent: the loader works, no
  auto-cleanup, no noise. Present but broken: hard failure. Those two cases are kept
  distinguishable on purpose.
- Never import `@testing-library/svelte/vitest` — that subpath does `import { beforeEach }
  from 'vitest'`.
- **`@happy-dom/global-registrator`** is pinned to the same `20.9.0` as the `happy-dom` the
  consumer UIs carry. A hand-rolled list of globals does **not** work: happy-dom internals
  reach `this.window.<Ctor>` for non-DOM constructors like `SyntaxError`, so the first
  `querySelector` throws `undefined is not a constructor`.
