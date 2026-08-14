import { afterAll, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeFixtureRoot } from '../scripts/fixture-root';
import { packAll } from '../scripts/pack-workspace';
import { publishablePackages, readManifest, repoRoot, tarballName } from '../scripts/workspace';

const INSTALL_TIMEOUT_MS = 300_000;

const fixtures = makeFixtureRoot('tarball-consumer');

afterAll(() => {
  fixtures.dispose();
});

const CONSUMED = '@packages/effect-bun-test';
const TRANSITIVE = '@packages/fixture-residue';

const USE_SOURCE = [
  `import { parseFixtureOwner } from '${CONSUMED}/fixture-root';`,
  '',
  "const owner = parseFixtureOwner('suite--box--42--abcd');",
  "if (owner === undefined) throw new Error('parseFixtureOwner returned undefined');",
  "process.stdout.write([owner.label, owner.host, String(owner.pid)].join(' ') + '\\n');",
  '',
].join('\n');

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

const tarballOf = (name: string): string => {
  const path = tarballs.get(name);
  if (path === undefined) throw new Error(`${name} is not a packable workspace package`);
  return path;
};

const readPackageManager = (): string => {
  const parsed = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
    packageManager?: string;
  };
  if (parsed.packageManager === undefined) {
    throw new Error('the root package.json declares no packageManager, so a consumer cannot pin one');
  }
  return parsed.packageManager;
};

const consumerDir = (label: string): string => {
  const dir = join(fixtures.path(), label);
  mkdirSync(dir, { recursive: true });
  return dir;
};

const pnpmConsumer = (label: string, overrides: Readonly<Record<string, string>>): string => {
  const dir = consumerDir(label);
  writeFileSync(
    join(dir, 'package.json'),
    `${JSON.stringify(
      {
        name: label,
        version: '0.0.0',
        private: true,
        type: 'module',
        packageManager: readPackageManager(),
        dependencies: { [CONSUMED]: `file:${tarballOf(CONSUMED)}` },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(dir, 'pnpm-workspace.yaml'),
    [
      'packages:',
      '  - .',
      '',
      'overrides:',
      ...Object.entries(overrides).map(([name, specifier]) => `  '${name}': ${specifier}`),
      '',
      'autoInstallPeers: false',
      '',
    ].join('\n'),
  );
  writeFileSync(join(dir, 'use.ts'), USE_SOURCE);
  return dir;
};

const bunConsumer = (label: string, overrides: Readonly<Record<string, string>>): string => {
  const dir = consumerDir(label);
  writeFileSync(
    join(dir, 'package.json'),
    `${JSON.stringify(
      {
        name: label,
        version: '0.0.0',
        private: true,
        type: 'module',
        dependencies: { [CONSUMED]: `file:${tarballOf(CONSUMED)}` },
        overrides,
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(join(dir, 'use.ts'), USE_SOURCE);
  return dir;
};

const fileSpecifiers = (names: readonly string[]): Readonly<Record<string, string>> =>
  Object.fromEntries(names.map((name) => [name, `file:${tarballOf(name)}`]));

describe('a consumer installs the packed tarballs with no lockfile present', () => {
  it(
    'resolves the whole transitive closure under pnpm and runs code through it',
    () => {
      const dir = pnpmConsumer('consumer-pnpm', fileSpecifiers([CONSUMED, TRANSITIVE]));

      expect(existsSync(join(dir, 'pnpm-lock.yaml'))).toBe(false);
      expect(existsSync(join(dir, 'node_modules'))).toBe(false);

      const install = run(['pnpm', 'install'], dir);
      expect({ exitCode: install.exitCode, output: install.output }).toEqual({
        exitCode: 0,
        output: install.output,
      });

      const used = run(['bun', 'use.ts'], dir);
      expect({ exitCode: used.exitCode, output: used.output }).toEqual({
        exitCode: 0,
        output: used.output,
      });
      expect(used.output).toContain('suite box 42');
    },
    INSTALL_TIMEOUT_MS,
  );

  it(
    'FAILS when only the directly named package is overridden, which is why the closure must be',
    () => {
      const dir = pnpmConsumer('consumer-pnpm-partial', fileSpecifiers([CONSUMED]));

      const install = run(['pnpm', 'install'], dir);

      expect({ exitCode: install.exitCode === 0, transitive: install.output.includes(TRANSITIVE) }).toEqual({
        exitCode: false,
        transitive: true,
      });
    },
    INSTALL_TIMEOUT_MS,
  );

  it(
    'resolves the same closure under bun install, whose overrides live in the manifest',
    () => {
      const dir = bunConsumer('consumer-bun', fileSpecifiers([TRANSITIVE]));

      expect(existsSync(join(dir, 'bun.lock'))).toBe(false);
      expect(existsSync(join(dir, 'node_modules'))).toBe(false);

      const install = run(['bun', 'install', '--no-summary'], dir);
      expect({ exitCode: install.exitCode, output: install.output }).toEqual({
        exitCode: 0,
        output: install.output,
      });

      const used = run(['bun', 'use.ts'], dir);
      expect({ exitCode: used.exitCode, output: used.output }).toEqual({
        exitCode: 0,
        output: used.output,
      });
      expect(used.output).toContain('suite box 42');
    },
    INSTALL_TIMEOUT_MS,
  );

  it('packs every publishable package, so the consumer cases above cover the whole release', () => {
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
