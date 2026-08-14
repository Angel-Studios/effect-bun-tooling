# `__e2e__`

Suites that spawn a package manager, or otherwise leave the current process, live here and
NOWHERE else. No unit suite in this repo spawns a subprocess: `pnpm run dod` runs `tsc`, the
unit suites and biome, and none of those may pay an install's latency or depend on a network.

Run them:

```sh
pnpm run test:e2e     # bun test ./__e2e__/*.e2e.test.ts
```

CI runs the same script in the `pack` job of `.github/workflows/ci.yml`, immediately after
packing the workspace, so every pull request and every push to `main` proves the produced
tarballs both resolve in a consumer and carry only what they are meant to carry.

Conventions:

- one flat directory, file names ending `.e2e.test.ts`, because the invocation is a glob
- every scratch directory is rooted under `<repoRoot>/.test-fixtures` and disposed
- each test carries its own generous timeout, since an install is not bounded by the 5s default
