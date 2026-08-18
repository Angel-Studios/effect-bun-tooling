import { afterAll, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeFixtureRoot } from '../scripts/fixture-root';
import { packAll } from '../scripts/pack-workspace';
import {
  publishablePackages,
  readManifest,
  repoRoot,
  tarballName,
  WORKSPACE_SCOPE,
} from '../scripts/workspace';

const INSTALL_TIMEOUT_MS = 300_000;
const TYPECHECK_TIMEOUT_MS = 300_000;

const fixtures = makeFixtureRoot('tarball-consumer');

afterAll(() => {
  fixtures.dispose();
});

/** Bundled into `@packages/effect-bun-test`'s dist. A consumer must never be asked to resolve this
 *  name: the `@packages` scope is not ownable, so it resolves nowhere without a manual `overrides`
 *  entry, and proving that requirement is GONE is the point of this suite. */
const BUNDLED_AWAY = '@packages/fixture-residue';

/** An Effect v3 release: outside every peer range here, and a major these packages cannot work
 *  against. Exactly the case a dependency declaration would resolve into a silent second copy. */
const CONFLICTING_EFFECT = '3.19.0';

/**
 * Runs a UUID service the consumer never installed `effect` for, through an Effect the consumer
 * built with the `effect` its own install produced. A `Context.Service` key minted inside the
 * package and a runtime started outside it have to agree, which is the runtime half of the claim
 * that nothing here vendors a copy of Effect.
 */
const USE_SOURCE = [
  `import { parseFixtureOwner } from '@packages/effect-bun-test/fixture-root';`,
  `import { expectTag } from '@packages/effect-test-kit/tagged';`,
  `import { UuidTest } from '@packages/uuid-effect/layer.test';`,
  `import { Uuid } from '@packages/uuid-effect/tag';`,
  `import { Effect } from 'effect';`,
  '',
  "const owner = parseFixtureOwner('suite--box--42--abcd');",
  "if (owner === undefined) throw new Error('parseFixtureOwner returned undefined');",
  '',
  'const uuid = await Effect.runPromise(Effect.provide(Uuid.next, UuidTest(7)));',
  '',
  "const tagged = expectTag({ _tag: 'Boom' } as { readonly _tag: 'Boom' | 'Fine' }, 'Boom');",
  '',
  "process.stdout.write([owner.label, owner.host, String(owner.pid), uuid, tagged._tag].join(' ') + '\\n');",
  '',
].join('\n');

/**
 * The typed surface a consumer actually writes against. Every Effect and Layer below is built with
 * the CONSUMER's `effect`; if the shipped declarations named a vendored copy, this is where the two
 * would fail to line up.
 */
const TYPECHECK_SOURCE = [
  `import * as it from '@packages/effect-bun-test';`,
  `import { parseFixtureOwner, type FixtureOwner } from '@packages/effect-bun-test/fixture-root';`,
  `import { expectTag } from '@packages/effect-test-kit/tagged';`,
  `import { UuidTest } from '@packages/uuid-effect/layer.test';`,
  `import { Uuid } from '@packages/uuid-effect/tag';`,
  `import * as Effect from 'effect/Effect';`,
  `import * as Layer from 'effect/Layer';`,
  '',
  'export const owner: FixtureOwner | undefined = parseFixtureOwner(`suite--box--42--abcd`);',
  '',
  'it.effect(`runs a consumer-built Effect`, () => Effect.sync(() => undefined));',
  '',
  'export const layer: Layer.Layer<Uuid> = UuidTest(0);',
  '',
  'it.layer(layer)(`a consumer-built Layer`, (suite) => {',
  '  suite.effect(`reads the service through it`, () => Effect.asVoid(Uuid.next));',
  '});',
  '',
  'export const tagged: { readonly _tag: `Boom` } = expectTag(',
  '  { _tag: `Boom` } as { readonly _tag: `Boom` | `Fine` },',
  '  `Boom`,',
  ');',
  '',
].join('\n');

/** `--ignore-scripts` keeps a dependency's native-build lifecycle script from spawning node inside
 *  a fixture. The only one in reach (msgpackr's optional native accelerator, transitive through
 *  `effect`) has a pure-JS fallback. */
const INSTALL = ['bun', 'install', '--no-summary', '--ignore-scripts'] as const;

/** TypeScript's own entry, run under bun. The `tsc` bin carries a `#!/usr/bin/env node` shebang,
 *  and nothing here may spawn node. */
const TSC_ENTRY = join(repoRoot, 'node_modules', 'typescript', 'lib', 'tsc.js');

type Run = { readonly exitCode: number; readonly output: string };

const run = (cmd: readonly string[], cwd: string): Run => {
  const result = Bun.spawnSync({ cmd: [...cmd], cwd, stdout: 'pipe', stderr: 'pipe' });
  return {
    exitCode: result.exitCode,
    output: `${result.stdout.toString()}${result.stderr.toString()}`,
  };
};

const tarballs = ((): ReadonlyMap<string, string> => {
  const destination = join(fixtures.path(), 'dist');
  packAll(destination);
  return new Map(
    publishablePackages().map((pkg) => [pkg.manifest.name, join(destination, tarballName(pkg.manifest))]),
  );
})();

/**
 * A consumer manifest that names the tarballs and NOTHING else: no `overrides`, no peer to satisfy,
 * no `effect`, `svelte` or `@types/bun` of its own. That is the whole claim this suite proves.
 */
const consumerDir = ((): string => {
  const dir = join(fixtures.path(), 'consumer-bun');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'package.json'),
    `${JSON.stringify(
      {
        name: 'consumer-bun',
        version: '0.0.0',
        private: true,
        type: 'module',
        dependencies: Object.fromEntries([...tarballs].map(([name, path]) => [name, `file:${path}`])),
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(join(dir, 'use.ts'), USE_SOURCE);
  writeFileSync(join(dir, 'check.ts'), TYPECHECK_SOURCE);
  return dir;
})();

const tsconfigFor = (moduleResolution: 'bundler' | 'nodenext'): string =>
  `${JSON.stringify(
    {
      compilerOptions: {
        strict: true,
        // NOT skipped. `skipLibCheck` suppresses the very error this proof exists for: an
        // extensionless relative specifier inside a shipped `.d.ts` is fatal under `nodenext`,
        // and skipping lib checks hides it right up until a consumer trips over it.
        skipLibCheck: false,
        noEmit: true,
        target: 'ES2022',
        // `effect`'s own declarations reference DOM names (`TextDecoderOptions`, `ReadableStream`).
        lib: ['ESNext', 'DOM'],
        module: moduleResolution === 'nodenext' ? 'nodenext' : 'esnext',
        moduleResolution,
        // `@types/bun` arrives as a dependency of the packages, not from the consumer.
        types: ['bun'],
      },
      include: ['check.ts'],
    },
    null,
    2,
  )}\n`;

describe('a consumer installs the packed tarballs and declares nothing else', () => {
  it(
    'installs the whole release with no overrides, no peer to satisfy and no lockfile present',
    () => {
      expect(existsSync(join(consumerDir, 'bun.lock'))).toBe(false);
      expect(existsSync(join(consumerDir, 'node_modules'))).toBe(false);

      const install = run(INSTALL, consumerDir);
      expect({ exitCode: install.exitCode, output: install.output }).toEqual({
        exitCode: 0,
        output: install.output,
      });
    },
    INSTALL_TIMEOUT_MS,
  );

  it('runs a consumer-built Effect through a service the installed packages define', () => {
    const used = run(['bun', 'use.ts'], consumerDir);
    expect({ exitCode: used.exitCode, output: used.output }).toEqual({
      exitCode: 0,
      output: used.output,
    });
    expect(used.output).toContain('suite box 42 00000000-0000-4000-8000-000000000007 Boom');
  });

  it('has `effect`, `svelte` and `@types/bun` installed for it, having named none of them', () => {
    const manifest = JSON.parse(readFileSync(join(consumerDir, 'package.json'), 'utf8')) as {
      readonly dependencies?: Readonly<Record<string, string>>;
    };
    expect(Object.keys(manifest.dependencies ?? {}).every((name) => name.startsWith(WORKSPACE_SCOPE))).toBe(
      true,
    );
    for (const installed of ['effect', 'svelte', join('@types', 'bun')]) {
      const path = join(consumerDir, 'node_modules', installed, 'package.json');
      expect({ installed, present: existsSync(path) }).toEqual({ installed, present: true });
    }
  });

  it('resolves ONE copy of `effect`, so nothing crosses a boundary between two of them', () => {
    const nested = publishablePackages().flatMap((pkg) => {
      const path = join(consumerDir, 'node_modules', pkg.manifest.name, 'node_modules', 'effect');
      return existsSync(path) ? [pkg.manifest.name] : [];
    });
    expect(nested).toEqual([]);
  });

  it('installs exactly the packages it named, and no closure beneath them', () => {
    expect(readdirSync(join(consumerDir, 'node_modules', '@packages')).sort()).toEqual(
      publishablePackages()
        .map((pkg) => pkg.manifest.name.slice(WORKSPACE_SCOPE.length))
        .sort(),
    );
  });

  for (const moduleResolution of ['bundler', 'nodenext'] as const) {
    it(
      `typechecks against the shipped declarations under moduleResolution: ${moduleResolution}`,
      () => {
        const config = `tsconfig.${moduleResolution}.json`;
        writeFileSync(join(consumerDir, config), tsconfigFor(moduleResolution));

        const checked = run(['bun', TSC_ENTRY, '--project', config], consumerDir);
        expect({ exitCode: checked.exitCode, output: checked.output }).toEqual({
          exitCode: 0,
          output: checked.output,
        });
      },
      TYPECHECK_TIMEOUT_MS,
    );
  }
});

/**
 * The narrow case the old contract could not satisfy. `@packages/effect-bun-test` used to depend on
 * `@packages/fixture-residue`, and because that scope resolves nowhere a consumer naming only the
 * one package got a failed install until they hand-wrote an `overrides` entry for the whole
 * transitive closure. The sibling is bundled into the dist now, so the closure is empty.
 */
describe('a consumer naming ONE package needs no overrides for a closure beneath it', () => {
  const soloDir = ((): string => {
    const dir = join(fixtures.path(), 'consumer-solo');
    mkdirSync(dir, { recursive: true });
    const consumed = '@packages/effect-bun-test';
    writeFileSync(
      join(dir, 'package.json'),
      `${JSON.stringify(
        {
          name: 'consumer-solo',
          version: '0.0.0',
          private: true,
          type: 'module',
          dependencies: { [consumed]: `file:${tarballs.get(consumed) ?? ''}` },
        },
        null,
        2,
      )}\n`,
    );
    writeFileSync(
      join(dir, 'use.ts'),
      [
        `import { parseFixtureOwner } from '${consumed}/fixture-root';`,
        '',
        "const owner = parseFixtureOwner('suite--box--42--abcd');",
        "if (owner === undefined) throw new Error('parseFixtureOwner returned undefined');",
        "process.stdout.write([owner.label, owner.host, String(owner.pid)].join(' ') + '\\n');",
        '',
      ].join('\n'),
    );
    return dir;
  })();

  it(
    'installs and runs with no overrides at all',
    () => {
      const install = run(INSTALL, soloDir);
      expect({ exitCode: install.exitCode, output: install.output }).toEqual({
        exitCode: 0,
        output: install.output,
      });

      const used = run(['bun', 'use.ts'], soloDir);
      expect({ exitCode: used.exitCode, output: used.output }).toEqual({
        exitCode: 0,
        output: used.output,
      });
      expect(used.output).toContain('suite box 42');
    },
    INSTALL_TIMEOUT_MS,
  );

  it('never resolves the bundled sibling, whose scope resolves nowhere', () => {
    expect(readdirSync(join(soloDir, 'node_modules', WORKSPACE_SCOPE.slice(0, -1)))).toEqual([
      'effect-bun-test',
    ]);
    expect(existsSync(join(soloDir, 'node_modules', BUNDLED_AWAY))).toBe(false);
  });

  it('still reaches the code that sibling contributes, because the bundle carries it', () => {
    const used = run(['bun', 'use.ts'], soloDir);
    expect(used.output).toContain('suite box 42');
  });
});

/**
 * The reason `effect` and `svelte` are PEERS rather than dependencies.
 *
 * Measured on bun 1.3.14, with a consumer pinned to Effect v3 while these packages require v4:
 *
 * - as a `dependency`, bun installs a SECOND, nested `effect@4.x` under the package. Exit 0, no
 *   warning. The consumer's v3 test code then meets a v4 harness, and v3 and v4 do not
 *   interoperate — they identify their values by different schemes entirely.
 * - as a `peerDependency`, bun warns and installs NO second copy.
 *
 * bun does not fail the install either way, so the guarantee proved here is the one that matters:
 * a version conflict never silently becomes two copies.
 */
describe('a consumer whose own effect conflicts gets a warning, never a second copy', () => {
  const conflictDir = ((): string => {
    const dir = join(fixtures.path(), 'consumer-effect-v3');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'package.json'),
      `${JSON.stringify(
        {
          name: 'consumer-effect-v3',
          version: '0.0.0',
          private: true,
          type: 'module',
          dependencies: {
            '@packages/effect-bun-test': `file:${tarballs.get('@packages/effect-bun-test') ?? ''}`,
            effect: CONFLICTING_EFFECT,
          },
        },
        null,
        2,
      )}\n`,
    );
    return dir;
  })();

  let installed: Run | undefined;

  it(
    'surfaces the conflict at install time rather than passing it over in silence',
    () => {
      installed = run(INSTALL, conflictDir);
      expect(installed.output.toLowerCase()).toContain('peer');
    },
    INSTALL_TIMEOUT_MS,
  );

  it('installs the consumer their OWN effect, unreplaced', () => {
    const version = JSON.parse(
      readFileSync(join(conflictDir, 'node_modules', 'effect', 'package.json'), 'utf8'),
    ) as { readonly version: string };
    expect(version.version).toBe(CONFLICTING_EFFECT);
  });

  it('nests no second copy of effect under the package, which is the whole guarantee', () => {
    const nested = join(
      conflictDir,
      'node_modules',
      '@packages',
      'effect-bun-test',
      'node_modules',
      'effect',
    );
    expect({ nested, present: existsSync(nested) }).toEqual({ nested, present: false });
  });
});

describe('the release covers every publishable package', () => {
  it('packs every publishable package, so the consumer case above covers the whole release', () => {
    expect([...tarballs.keys()].sort()).toEqual(
      publishablePackages()
        .map((pkg) => pkg.manifest.name)
        .sort(),
    );
    for (const path of tarballs.values()) expect(existsSync(path)).toBe(true);
  });

  it('names every tarball after the version the manifests carry, which is what the Release URL embeds', () => {
    const version = readManifest(join(repoRoot, 'package.json')).version;
    for (const [name, path] of tarballs) {
      expect({ name, matches: path.endsWith(`-${version}.tgz`) }).toEqual({ name, matches: true });
    }
  });
});
