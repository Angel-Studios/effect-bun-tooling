import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const manifestPath = resolve(import.meta.dir, '../package.json');

const entriesOf = (value: unknown): readonly (readonly [string, unknown])[] =>
  typeof value === 'object' && value !== null ? Object.entries(value) : [];

const manifest: unknown = existsSync(manifestPath)
  ? JSON.parse(readFileSync(manifestPath, 'utf8'))
  : undefined;

const field = (name: string): unknown => {
  for (const [key, value] of entriesOf(manifest)) {
    if (key === name) return value;
  }
  return undefined;
};

const keysOf = (name: string): readonly string[] => entriesOf(field(name)).map(([key]) => key);

describe('the dependency set is enforced by test, because ultravisor consumes this package', () => {
  it('found the manifest, so every assertion below reads a real file', () => {
    expect({ path: manifestPath, found: existsSync(manifestPath) }).toEqual({
      path: manifestPath,
      found: true,
    });
  });

  it('declares NO runtime dependencies at all', () => {
    expect({ dependencies: keysOf('dependencies') }).toEqual({ dependencies: [] });
  });

  it('declares NO optional dependencies at all', () => {
    expect({ optionalDependencies: keysOf('optionalDependencies') }).toEqual({
      optionalDependencies: [],
    });
  });

  it('declares effect as its ONLY peer, never as a dependency', () => {
    expect(keysOf('peerDependencies')).toEqual(['effect']);
  });

  it('gives the effect peer a non-empty version range', () => {
    const range = entriesOf(field('peerDependencies')).find(([key]) => key === 'effect');
    const value = range === undefined ? '' : String(range[1]);
    expect({ declared: value.length > 0 }).toEqual({ declared: true });
  });

  it('declares no foreign test runner in ANY manifest field', () => {
    const forbidden = ['vitest', 'jest', '@vitest/ui', '@vitest/coverage-v8', '@types/jest'];
    const fields = [
      'dependencies',
      'devDependencies',
      'peerDependencies',
      'optionalDependencies',
      'bundledDependencies',
    ];
    const found = fields.flatMap((name) =>
      keysOf(name).filter((key) => forbidden.includes(key) || key.startsWith('jest-')),
    );
    expect(found).toEqual([]);
  });

  it('runs its unit gate with coverage, so the eighty-percent floor is actually measured', () => {
    const scripts = entriesOf(field('scripts')).find(([key]) => key === 'test:unit:once');
    const command = scripts === undefined ? '' : String(scripts[1]);
    expect({ command, measuresCoverage: command.includes('--coverage') }).toEqual({
      command,
      measuresCoverage: true,
    });
  });

  it('arms an eighty-percent line, function and statement coverage threshold in its own bunfig', () => {
    const bunfigPath = resolve(import.meta.dir, '../bunfig.toml');
    const bunfig = existsSync(bunfigPath) ? readFileSync(bunfigPath, 'utf8') : '';
    expect({
      found: existsSync(bunfigPath),
      lines: bunfig.includes('lines = 0.80') || bunfig.includes('lines = 0.8'),
      functions: bunfig.includes('functions = 0.80') || bunfig.includes('functions = 0.8'),
      statements: bunfig.includes('statements = 0.80') || bunfig.includes('statements = 0.8'),
    }).toEqual({ found: true, lines: true, functions: true, statements: true });
  });
});

describe('the five API subpaths the reference section 11 binds', () => {
  it('exports grammar, tags, config, parse and marking, and nothing is missing from the export map', () => {
    const subpaths = keysOf('exports')
      .map((key) => key.replace('./', ''))
      .sort();
    expect(subpaths).toEqual(['config', 'grammar', 'marking', 'parse', 'tags']);
  });
});
