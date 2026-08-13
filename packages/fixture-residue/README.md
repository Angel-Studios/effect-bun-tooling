# `@packages/fixture-residue`

The fixture-residue **convention**, and nothing else: the `.test-fixtures` directory name, the
`<label>--<host>--<pid>--<random>` ownership-token format, owner liveness, entry classification,
the sweep, and its rendering.

```ts
import { renderResidue, sweepFixtureResidue } from '@packages/fixture-residue/sweep';

const result = sweepFixtureResidue({ reap: false, base: `${repoRoot}/.test-fixtures` });
if (result.residue.length > 0) process.stderr.write(`${renderResidue(result)}\n`);
```

## Why this is its own package

Two components have to agree on the convention byte for byte: the one that **mints** conforming
directories (`@packages/effect-bun-test/fixture-root`) and whatever **inspects** them and enforces
that none outlives its suite — typically a tooling plane or CI gate. Housing the convention in
either one makes the other depend on it, and the inspector depending on a test harness is exactly
backwards.

So it lives here, with **zero runtime dependencies and node builtins only**, which is what lets a
`bun build --compile` binary bundle it without dragging a test harness into production. Do not add
a runtime dependency to this package. `devDependencies` are fine.

## The classification, and why it has five verdicts rather than two

| Verdict | Meaning | Residue? |
|---|---|---|
| `live` | The owning pid is still running on this host. | no |
| `within-grace` | The owner is gone, but the directory is younger than 60s. | no |
| `unjudgeable` | No ownership token, or another host's token. Its pids mean nothing here. | no |
| `dead-owner` | The owner is gone and the grace window has passed. | **yes** |
| `over-age` | Older than 24h, whatever its owner is doing. | **yes** |

The grace window exists because a directory can be observed between `mkdtemp` and the owning
process becoming visible. `unjudgeable` is counted separately rather than folded into either side:
a foreign-host token is not evidence of a leak, and silently reaping it would delete another
machine's live fixture on a shared volume.

## Residue is a defect signal, not untidiness

`afterAll` does **not** run on a bail-out, a `SIGKILL`, or a runner crash, so every stranded
directory marks a suite whose disposal did not run. The rendering says so in the text it emits,
deliberately: deleting them by hand hides the defect and it comes back.

A sweep that cannot read its base reports `baseResolved: false`, which is **not** the same result
as a clean sweep and must never be rendered as one — inside a compiled binary `import.meta.dir` is
`/$bunfs/root`, the repo-root marker walk finds nothing, and a tripwire that reported "clean" there
would be a gate passing by not running.
