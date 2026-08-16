# `@packages/effect-test-kit`

Cast-free, framework-agnostic assertions for Effect tagged errors. Four helpers narrow a failure to
one member of a tagged union by its `_tag`, with no `as` cast and no `instanceof`.

```ts
import { expectFailureTag } from '@packages/effect-test-kit/tagged';

const exit = await Effect.runPromiseExit(subject);
const err = expectFailureTag(exit, 'TimeoutError');

expect(err.elapsedMs).toBeGreaterThan(0);
```

| Helper | Narrows |
|---|---|
| `expectTag(value, tag)` | A tagged value in hand. |
| `expectFailureTag(exit, tag)` | An `Exit`'s typed failure. |
| `expectCauseFailureTag(cause, tag)` | A `Cause`'s typed failure. |
| `expectLeftTag(result, tag)` | A `Result`'s `Failure`. (Named for v3's `Either`, which v4 renamed to `Result`.) |

Each returns the narrowed member, so the call site keeps full type information on the specific
error without asserting its way there.

## Why not a cast

`exit.cause` typed as a union and then read as `(value as TimeoutError).elapsedMs` compiles whatever
the value actually is — the test still passes when the subject starts failing a different way. The
`instanceof` alternative is worse for Effect `Schema` classes, whose instances do not reliably
survive a boundary.

These helpers throw instead, loudly, rendering the actual value or `Cause`: a guard converted to one
of them **cannot** silently pass.

## The one case they cannot narrow

Effect `Config` failures. Every `ConfigError` carries the `_tag` `'ConfigError'`, so the tag alone
discriminates nothing. Under Effect v4 a `ConfigError` wraps a `SchemaError` rather than carrying
v3's `_op`, so assert the rendered message.

`effect` is a peer dependency; it resolves from the consumer's tree so there is exactly one copy.
