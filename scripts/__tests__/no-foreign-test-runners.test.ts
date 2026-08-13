import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot, workspacePackages } from '../workspace';

const FORBIDDEN_PACKAGES = ['vitest', 'jest', '@vitest/ui', '@vitest/coverage-v8', '@types/jest'];
const FORBIDDEN_PREFIXES = ['@vitest/', 'jest-', 'vitest-'];
const MANIFEST_DEP_FIELDS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const;
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.svelte'];
const SKIPPED_DIRS = ['node_modules', 'dist', 'dist-tarballs', 'coverage'];

const isForbidden = (dep: string): boolean =>
  FORBIDDEN_PACKAGES.includes(dep) || FORBIDDEN_PREFIXES.some((prefix) => dep.startsWith(prefix));

const sourceFiles = (dir: string): readonly string[] => {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.') || SKIPPED_DIRS.includes(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) found.push(...sourceFiles(path));
    else if (SOURCE_EXTENSIONS.some((ext) => entry.endsWith(ext))) found.push(path);
  }
  return found;
};

const manifestPaths = (): readonly string[] => [
  join(repoRoot, 'package.json'),
  ...workspacePackages().map((pkg) => pkg.manifestPath),
];

describe('bun:test is the only test runner', () => {
  it('finds source files to inspect', () => {
    expect(sourceFiles(repoRoot).length).toBeGreaterThan(0);
  });

  it('declares no foreign runner in any manifest dependency field', () => {
    for (const manifestPath of manifestPaths()) {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
      for (const field of MANIFEST_DEP_FIELDS) {
        const deps = (manifest[field] as Record<string, string> | undefined) ?? {};
        for (const dep of Object.keys(deps)) {
          expect({ manifestPath, field, dep, forbidden: isForbidden(dep) }).toEqual({
            manifestPath,
            field,
            dep,
            forbidden: false,
          });
        }
      }
    }
  });

  it('imports no foreign runner from any source file', () => {
    const pattern = /(?:from|import|require)\s*\(?\s*['"]((?:@vitest\/|jest-|vitest)[^'"]*|vitest|jest)['"]/;
    for (const file of sourceFiles(repoRoot)) {
      const hit = pattern.exec(readFileSync(file, 'utf8'));
      expect({ file, importedRunner: hit === null ? undefined : hit[1] }).toEqual({
        file,
        importedRunner: undefined,
      });
    }
  });

  it('declares no vitest configuration file', () => {
    const configs = readdirSync(repoRoot).filter((entry) => entry.startsWith('vitest.config.'));
    expect(configs).toEqual([]);
  });
});
