import { afterAll, describe, expect, it } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeFixtureRoot, repoRoot, resolveRepoRootFrom } from '../src/fixture-root';

const fixtures = makeFixtureRoot('fixture-root-guard');

afterAll(() => {
  fixtures.dispose();
});

const installedPackageDir = (label: string): string => {
  const dir = join(fixtures.path(), label, 'node_modules', '@packages', 'effect-bun-test', 'src');
  mkdirSync(dir, { recursive: true });
  return dir;
};

describe('resolveRepoRootFrom', () => {
  it('finds the repo root of a directory that lives inside the repo', () => {
    expect(resolveRepoRootFrom(fixtures.path())).toBe(repoRoot());
  });

  it('walks an installed-package path out to the consuming repo while that copy carries no marker', () => {
    expect(resolveRepoRootFrom(installedPackageDir('unmarked'))).toBe(repoRoot());
  });

  it('throws when a marker inside the installed copy would move the root into node_modules', () => {
    const src = installedPackageDir('marked');
    const installed = join(src, '..');
    writeFileSync(join(installed, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n');

    expect(() => resolveRepoRootFrom(src)).toThrow('node_modules');
  });

  it('names the offending directory in the refusal, so the planted marker is findable', () => {
    const src = installedPackageDir('named');
    const installed = join(src, '..');
    writeFileSync(join(installed, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n');

    expect(() => resolveRepoRootFrom(src)).toThrow(join(fixtures.path(), 'named'));
  });

  it('refuses an out-of-repo start rather than falling back to the filesystem root', () => {
    expect(() => resolveRepoRootFrom('/')).toThrow('no out-of-repo fallback');
  });
});
