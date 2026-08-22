import { describe, expect, it } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as Schema from 'effect/Schema';
import { CASE_FIXTURES, FIXTURE_SUFFIX, REAL_FIXTURES } from './fixtures/provenance.ts';
import { FIXTURE_ROOT, PACKAGE_ROOT, successOf } from './support.ts';

const spelled = (parts: readonly string[]): string => parts.join('');

const FORBIDDEN_TEST_RUNNERS: readonly string[] = [
  spelled(['vi', 'test']),
  spelled(['j', 'est']),
  spelled(['@vi', 'test', '/']),
  spelled(['@types/j', 'est']),
  spelled(['j', 'est', '-']),
];

const PATH_PACKAGE_NAME = spelled(['ddd', '-', 'path']);

const OUT_OF_REPO_ROOTS: readonly string[] = [
  spelled(['/Users/ai/Documents/', 'project-xavier']),
  spelled(['/Users/ai/Documents/', 'harvest']),
];

const sortedCopy = (values: readonly string[]): readonly string[] => [...values].sort();

const READ_CALLS: readonly string[] = ['readFileSync', 'readFile', 'Bun.file', 'import('];

const ManifestRecord = Schema.Record(Schema.String, Schema.Unknown);

const DependencyMap = Schema.Record(Schema.String, Schema.String);

const manifestText = readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8');

const manifest = successOf(Schema.decodeUnknownResult(ManifestRecord)(JSON.parse(manifestText)));

const manifestField = (field: string): unknown => manifest[field];

const dependencyMapAt = (field: string): Readonly<Record<string, string>> =>
  successOf(Schema.decodeUnknownResult(DependencyMap)(manifestField(field)));

const sourceFilesUnder = (directory: string): readonly string[] =>
  readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => join(entry.parentPath, entry.name));

const PACKAGE_SOURCE_FILES: readonly string[] = [
  ...sourceFilesUnder(join(PACKAGE_ROOT, 'src')),
  ...sourceFilesUnder(join(PACKAGE_ROOT, '__tests__')),
];

const fixtureFilesOnDisk = (): readonly string[] =>
  readdirSync(FIXTURE_ROOT, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(FIXTURE_SUFFIX))
    .map((entry) => join(entry.parentPath, entry.name).slice(FIXTURE_ROOT.length + 1));

describe('the dependency set is exactly what the package declares it to be', () => {
  it('takes effect as its only peer dependency, on an open range', () => {
    expect(dependencyMapAt('peerDependencies')).toEqual({ effect: '>=4.0.0-rc.109 <5' });
  });

  it('takes exactly three development dependencies, each from the workspace catalog', () => {
    expect(dependencyMapAt('devDependencies')).toEqual({
      '@types/bun': 'catalog:',
      effect: 'catalog:',
      typescript: 'catalog:',
    });
  });

  it('declares no runtime dependencies and no optional or bundled ones', () => {
    const dependencyFields = Object.keys(manifest).filter((field) => field.toLowerCase().includes('depend'));
    expect(sortedCopy(dependencyFields)).toEqual(['devDependencies', 'peerDependencies']);
  });
});

describe('bun:test is the only harness, in the manifest and in the source', () => {
  it('names no foreign test runner anywhere in the manifest', () => {
    for (const runner of FORBIDDEN_TEST_RUNNERS) expect(manifestText).not.toContain(runner);
  });

  it('runs its unit suite through bun', () => {
    expect(dependencyMapAt('scripts')['test:unit:once']).toBe('bun test');
  });

  it('ships no foreign runner configuration file', () => {
    const configPrefixes = [spelled(['vi', 'test', '.config']), spelled(['j', 'est', '.config'])];
    const names = [...readdirSync(PACKAGE_ROOT), ...readdirSync(join(PACKAGE_ROOT, '__tests__'))];
    for (const name of names) {
      for (const prefix of configPrefixes) expect(name.startsWith(prefix)).toBe(false);
    }
  });

  it('imports no foreign test runner in any source or test file', () => {
    for (const file of PACKAGE_SOURCE_FILES) {
      const text = readFileSync(file, 'utf8');
      for (const runner of FORBIDDEN_TEST_RUNNERS) {
        expect(`${file} imports ${runner}: ${text.includes(`'${runner}`)}`).toBe(
          `${file} imports ${runner}: false`,
        );
      }
    }
  });
});

describe('the format layer holds no vocabulary and no coupling to the path package', () => {
  it('never names the path package in any source or test file', () => {
    for (const file of PACKAGE_SOURCE_FILES) {
      expect(`${file}: ${readFileSync(file, 'utf8').includes(PATH_PACKAGE_NAME)}`).toBe(`${file}: false`);
    }
  });
});

describe('every export subpath is backed by a source file of the same leaf name', () => {
  it('publishes one subpath per source module and no more', () => {
    const exportsMap = successOf(Schema.decodeUnknownResult(ManifestRecord)(manifestField('exports')));
    const leaves = Object.keys(exportsMap).map((subpath) => subpath.replace('./', ''));
    const modules = sourceFilesUnder(join(PACKAGE_ROOT, 'src')).map((file) =>
      file.slice(join(PACKAGE_ROOT, 'src').length + 1).replace('.ts', ''),
    );
    expect(sortedCopy(leaves)).toEqual(sortedCopy(modules));
  });

  it('points every subpath at a built declaration and a built module', () => {
    const exportsMap = successOf(Schema.decodeUnknownResult(ManifestRecord)(manifestField('exports')));
    for (const subpath of Object.keys(exportsMap)) {
      const target = successOf(Schema.decodeUnknownResult(DependencyMap)(exportsMap[subpath]));
      const leaf = subpath.replace('./', '');
      expect(target).toEqual({ types: `./dist/${leaf}.d.ts`, default: `./dist/${leaf}.js` });
    }
  });
});

describe('the fixture corpus is committed in-repo and read only from in-repo', () => {
  it('has every recorded fixture on disk, and records every fixture on disk', () => {
    const recorded = [
      ...REAL_FIXTURES.map((provenance) => provenance.fixture),
      ...CASE_FIXTURES.map((authored) => authored.fixture),
    ];
    for (const fixture of recorded) expect(existsSync(join(FIXTURE_ROOT, fixture))).toBe(true);
    expect(sortedCopy(fixtureFilesOnDisk())).toEqual(sortedCopy(recorded));
  });

  it('keeps every out-of-repo origin path as inert data in the provenance record alone', () => {
    for (const file of PACKAGE_SOURCE_FILES) {
      const text = readFileSync(file, 'utf8');
      const isProvenance = file.endsWith(join('fixtures', 'provenance.ts'));
      for (const root of OUT_OF_REPO_ROOTS) {
        expect(`${file} names ${root}: ${text.includes(root)}`).toBe(
          `${file} names ${root}: ${isProvenance}`,
        );
      }
    }
  });

  it('never reads a file from the provenance record itself', () => {
    const text = readFileSync(join(FIXTURE_ROOT, 'provenance.ts'), 'utf8');
    for (const call of READ_CALLS) expect(text).not.toContain(call);
  });

  it('records a real repository and a positive derived line count for every real fixture', () => {
    for (const provenance of REAL_FIXTURES) {
      expect(provenance.origin.endsWith(provenance.classifierPath)).toBe(true);
      expect(provenance.origin).toContain(provenance.originRepository);
      expect(provenance.derivedLines).toBeGreaterThan(0);
    }
  });
});
