import { afterAll, describe, expect, it } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeFixtureRoot } from '../scripts/fixture-root';
import { packAll, packOne } from '../scripts/pack-workspace';
import { DIST_DIR, distFiles, publishablePackages, tarballName } from '../scripts/workspace';

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

const destination = join(fixtures.path(), 'dist');
const packed = packAll(destination);

describe('the produced archive carries the build output, a manifest and the licence text', () => {
  it('packs one tarball per publishable package', () => {
    expect(packed.length).toBe(publishablePackages().length);
  });

  for (const pkg of publishablePackages()) {
    const tarball = join(destination, tarballName(pkg.manifest));

    it(`ships exactly the built dist in ${pkg.manifest.name}, no more and no less`, () => {
      const expected = [
        ...ROOT_ENTRIES,
        ...distFiles(pkg).map((file) => `package/${DIST_DIR}/${file}`),
      ].sort();
      expect(archiveEntries(tarball)).toEqual(expected);
    });

    it(`ships no TypeScript source in ${pkg.manifest.name}, only the declarations beside the build`, () => {
      const source = archiveEntries(tarball).filter(
        (entry) => entry.endsWith('.ts') && !entry.endsWith('.d.ts'),
      );
      expect(source).toEqual([]);
    });

    it(`ships every target ${pkg.manifest.name}'s exports map names, so no subpath resolves to a missing file`, () => {
      const entries = new Set(archiveEntries(tarball));
      for (const entry of Object.values(pkg.manifest.exports ?? {})) {
        for (const target of [entry.default, entry.types]) {
          const archived = `package/${target.slice('./'.length)}`;
          expect({ target, shipped: entries.has(archived) }).toEqual({ target, shipped: true });
        }
      }
    });
  }

  it(
    'CONTROL: a marker planted under dist/ lands inside the allowlist, and this check catches it',
    () => {
      const packageDir = join(fixtures.path(), 'stowaway-package');
      mkdirSync(join(packageDir, DIST_DIR), { recursive: true });
      writeFileSync(
        join(packageDir, 'package.json'),
        `${JSON.stringify(
          {
            name: '@packages/stowaway-fixture',
            version: '0.0.0',
            type: 'module',
            exports: { '.': { types: './dist/index.d.ts', default: './dist/index.js' } },
            files: [DIST_DIR, 'README.md', 'LICENSE'],
          },
          null,
          2,
        )}\n`,
      );
      writeFileSync(join(packageDir, 'README.md'), '# stowaway fixture\n');
      writeFileSync(join(packageDir, 'LICENSE'), 'MIT\n');
      writeFileSync(join(packageDir, DIST_DIR, 'index.js'), 'export const value = 1;\n');
      writeFileSync(join(packageDir, DIST_DIR, 'index.d.ts'), 'export declare const value: number;\n');
      writeFileSync(join(packageDir, DIST_DIR, 'index.ts'), 'export const value = 1;\n');
      writeFileSync(join(packageDir, DIST_DIR, 'bun.lock'), '{}\n');

      const entries = archiveEntries(packOne(packageDir, destination));

      expect(entries).toContain(`package/${DIST_DIR}/bun.lock`);
      expect(entries.filter((entry) => entry.endsWith('.ts') && !entry.endsWith('.d.ts'))).toEqual([
        `package/${DIST_DIR}/index.ts`,
      ]);
    },
    PACK_TIMEOUT_MS,
  );
});
