import { afterAll, describe, expect, it } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { makeFixtureRoot } from '../scripts/fixture-root';
import { typeScriptFiles } from '../scripts/imports';
import { packAll, packOne } from '../scripts/pack-workspace';
import { publishablePackages, tarballName } from '../scripts/workspace';

const PACK_TIMEOUT_MS = 300_000;

const fixtures = makeFixtureRoot('tarball-contents');

afterAll(() => {
  fixtures.dispose();
});

const ROOT_ENTRIES = ['package/package.json', 'package/README.md', 'package/LICENSE'];

const archiveEntries = (tarball: string): readonly string[] => {
  const result = Bun.spawnSync({ cmd: ['tar', '-tzf', tarball], stdout: 'pipe', stderr: 'pipe' });
  if (result.exitCode !== 0) throw new Error(`tar could not list ${tarball}: ${result.stderr.toString()}`);
  return result.stdout
    .toString()
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.endsWith('/'))
    .sort();
};

const expectedEntries = (packageDir: string): readonly string[] =>
  [
    ...ROOT_ENTRIES,
    ...typeScriptFiles(join(packageDir, 'src')).map(
      (file) => `package/src/${relative(join(packageDir, 'src'), file)}`,
    ),
  ].sort();

const destination = join(fixtures.path(), 'dist');
const packed = packAll(destination);

describe('the produced archive carries only source TypeScript, a manifest and the licence text', () => {
  it('packs one tarball per publishable package', () => {
    expect(packed.length).toBe(publishablePackages().length);
  });

  for (const pkg of publishablePackages()) {
    const tarball = join(destination, tarballName(pkg.manifest));

    it(`ships exactly the expected file set in ${pkg.manifest.name}`, () => {
      expect(archiveEntries(tarball)).toEqual(expectedEntries(pkg.dir));
    });

    it(`ships no non-TypeScript stowaway under ${pkg.manifest.name}'s src/, which the files allowlist would let through`, () => {
      const strays = archiveEntries(tarball).filter(
        (entry) => entry.startsWith('package/src/') && !entry.endsWith('.ts'),
      );
      expect(strays).toEqual([]);
    });
  }

  it(
    'CONTROL: a repo-root marker planted under src/ lands inside the allowlist, and this check catches it',
    () => {
      const packageDir = join(fixtures.path(), 'stowaway-package');
      mkdirSync(join(packageDir, 'src'), { recursive: true });
      writeFileSync(
        join(packageDir, 'package.json'),
        `${JSON.stringify(
          {
            name: '@packages/stowaway-fixture',
            version: '0.0.0',
            type: 'module',
            exports: { '.': './src/index.ts' },
            files: ['src', 'README.md', 'LICENSE'],
          },
          null,
          2,
        )}\n`,
      );
      writeFileSync(join(packageDir, 'README.md'), '# stowaway fixture\n');
      writeFileSync(join(packageDir, 'LICENSE'), 'MIT\n');
      writeFileSync(join(packageDir, 'src', 'index.ts'), 'export const value = 1;\n');
      writeFileSync(join(packageDir, 'src', 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n');

      const entries = archiveEntries(packOne(packageDir, destination));

      expect(entries).toContain('package/src/pnpm-workspace.yaml');
      expect(entries).not.toEqual(expectedEntries(packageDir));
    },
    PACK_TIMEOUT_MS,
  );
});
