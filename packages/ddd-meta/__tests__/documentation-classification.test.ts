import { describe, expect, it } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import * as Result from 'effect/Result';
import { readFrontMatter } from '../src/parse.ts';
import { PACKAGE_ROOT } from './support.ts';

const REPO_ROOT_MARKERS: readonly string[] = ['bun.lock', '.git'];

const FORMAT_DOCUMENTATION_DIRECTORY = join('docs', 'frontmatter');

const MARKDOWN_SUFFIX = '.md';

const SCANNED_OUTCOMES: readonly string[] = ['NoFrontMatter', 'FrontMatter'];

const repoRoot = (): string => {
  let directory = import.meta.dir;
  for (;;) {
    if (REPO_ROOT_MARKERS.some((marker) => existsSync(join(directory, marker)))) return directory;
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  throw new Error(`could not locate the repo root by walking up from ${import.meta.dir}`);
};

const ROOT = repoRoot();

const classifierPathOf = (absolute: string): string => relative(ROOT, absolute).split(sep).join('/');

const markdownUnder = (directory: string): readonly string[] =>
  readdirSync(directory)
    .filter((name) => name.endsWith(MARKDOWN_SUFFIX))
    .sort()
    .map((name) => join(directory, name));

const DOCUMENTS: readonly string[] = [
  ...markdownUnder(join(ROOT, FORMAT_DOCUMENTATION_DIRECTORY)),
  join(PACKAGE_ROOT, 'README.md'),
];

const verdictOf = (absolute: string): string => {
  const outcome = readFrontMatter(classifierPathOf(absolute), readFileSync(absolute, 'utf8'));
  if (Result.isFailure(outcome)) return `refused with ${JSON.stringify(outcome.failure)}`;
  const tag = outcome.success._tag;
  return SCANNED_OUTCOMES.includes(tag) ? 'scanned and accepted' : `left unscanned as ${tag}`;
};

describe('the documentation of the format classifies through the format it documents', () => {
  it('finds the format documentation directory and the package README', () => {
    expect(DOCUMENTS.length).toBeGreaterThan(1);
    for (const document of DOCUMENTS) expect(existsSync(document)).toBe(true);
    expect(DOCUMENTS.map(classifierPathOf)).toContain('packages/ddd-meta/README.md');
  });

  for (const document of DOCUMENTS) {
    it(`classifies ${relative(ROOT, document)} without a refusal`, () => {
      const classifierPath = classifierPathOf(document);
      expect(`${classifierPath}: ${verdictOf(document)}`).toBe(`${classifierPath}: scanned and accepted`);
    });
  }
});
