import { describe, expect, it } from 'bun:test';
import * as Result from 'effect/Result';
import { parseFrontMatter } from '../src/parse.ts';
import {
  DIRECTIVE_SCOPES,
  directiveScopeOf,
  isYamlCloseFenceLine,
  isYamlFenceLine,
  MACHINE_READ_DIRECTIVES,
  preambleEnd,
  splitLines,
  yamlFrontMatterEnd,
} from '../src/sentinel.ts';
import { upsertFrontMatter } from '../src/write.ts';
import { fixtureText, successOf } from './support.ts';

const YAML_DOC = '---\ntitle: A doc\nlayout: page\n---\n\n# Heading\n\nBody text.\n';

const UNCLOSED_FENCE_DOC = '---\nnot really front matter\n\n# Heading\n';

const writtenInto = (text: string, carrier: 'block' | 'xml'): readonly string[] => {
  const written = successOf(upsertFrontMatter(text, carrier, { l: 'domain' }));
  return splitLines(written);
};

describe('a Markdown YAML front-matter fence is preamble, so the block goes below it', () => {
  it('recognises a closed fence and reports the closing line', () => {
    expect(isYamlFenceLine('---')).toBe(true);
    expect(isYamlFenceLine('--- -->')).toBe(false);
    expect(yamlFrontMatterEnd(splitLines(YAML_DOC))).toBe(3);
    expect(yamlFrontMatterEnd(splitLines(UNCLOSED_FENCE_DOC))).toBe(-1);
  });

  it('ends the preamble after the closing fence, never at index zero', () => {
    expect(preambleEnd(splitLines(YAML_DOC), 'xml')).toBeGreaterThan(3);
  });

  it('leaves the YAML fence as the first thing in the file', () => {
    const lines = writtenInto(YAML_DOC, 'xml');
    expect(lines[0]).toBe('---');
    expect(lines[1]).toBe('title: A doc');
    expect(lines[3]).toBe('---');
    expect(lines.slice(0, 4).join('\n')).toBe('---\ntitle: A doc\nlayout: page\n---');
  });

  it('reads its own block back from below the fence', () => {
    const written = successOf(upsertFrontMatter(YAML_DOC, 'xml', { l: 'domain' }));
    const outcome = successOf(parseFrontMatter(written, 'xml'));
    expect(outcome).toMatchObject({ _tag: 'FrontMatter', value: { l: 'domain' } });
  });

  it('treats an unclosed leading dash run as ordinary content, not as a fence', () => {
    expect(preambleEnd(splitLines(UNCLOSED_FENCE_DOC), 'xml')).toBe(0);
    expect(writtenInto(UNCLOSED_FENCE_DOC, 'xml')[0]).toBe('<!-- ---uv');
  });

  it('closes the fence only at column zero, so an indented dash run inside a block scalar is content', () => {
    const lines = splitLines(fixtureText('cases/yaml-block-scalar.md.fixture'));
    expect(isYamlCloseFenceLine('---')).toBe(true);
    expect(isYamlCloseFenceLine('  ---')).toBe(false);
    expect(isYamlFenceLine('  ---')).toBe(true);
    expect(lines[3]).toBe('  ---');
    expect(yamlFrontMatterEnd(lines)).toBe(6);
  });

  it('leaves a block-scalar front matter intact, splicing the block below the whole of it', () => {
    const original = fixtureText('cases/yaml-block-scalar.md.fixture');
    const lines = writtenInto(original, 'xml');
    expect(lines.slice(0, 7)).toEqual(splitLines(original).slice(0, 7));
    expect(lines[7]).toBe('');
    expect(lines[8]).toBe('<!-- ---uv');
  });

  it('does not treat a leading dash run as a fence under the block carrier', () => {
    expect(preambleEnd(splitLines('---\na: 1\n---\n\nexport const v = 1;\n'), 'block')).toBe(0);
  });
});

describe('a directive that binds the next line stops the preamble instead of being consumed', () => {
  it('classifies every recognised directive, and nothing else', () => {
    const scoped = DIRECTIVE_SCOPES.map((entry) => entry[0]);
    for (const directive of MACHINE_READ_DIRECTIVES) expect(scoped).toContain(directive);
    expect(directiveScopeOf('// nothing here')).toBeUndefined();
  });

  it('reads the longest matching token, which the table order deliberately cannot supply', () => {
    const tokens = DIRECTIVE_SCOPES.map((entry) => entry[0]);
    const firstMatchScopeOf = (text: string): string | undefined =>
      DIRECTIVE_SCOPES.find((entry) => text.includes(entry[0]))?.[1];

    expect(tokens.indexOf('biome-ignore')).toBeLessThan(tokens.indexOf('biome-ignore-all'));
    expect(tokens.indexOf('eslint-disable')).toBeLessThan(tokens.indexOf('eslint-disable-next-line'));

    expect(directiveScopeOf('// biome-ignore lint/x: why')).toBe('next_line');
    expect(directiveScopeOf('// biome-ignore-all lint/x: why')).toBe('file');
    expect(directiveScopeOf('// eslint-disable')).toBe('file');
    expect(directiveScopeOf('// eslint-disable-next-line no-eval')).toBe('next_line');

    expect(firstMatchScopeOf('// biome-ignore-all lint/x: why')).toBe('next_line');
    expect(firstMatchScopeOf('// eslint-disable-next-line no-eval')).toBe('file');
  });

  it('inserts ABOVE a next-line directive, keeping it adjacent to the line it suppresses', () => {
    const source = '// @ts-expect-error deliberate\nexport const bad: number = 1;\n';
    const lines = writtenInto(source, 'block');
    expect(lines[0]).toBe('/* ---uv');
    expect(lines.indexOf('// @ts-expect-error deliberate')).toBeGreaterThan(2);
    const directiveIndex = lines.indexOf('// @ts-expect-error deliberate');
    expect(lines[directiveIndex + 1]).toBe('export const bad: number = 1;');
  });

  it('inserts BELOW a file-scoped directive, which suppresses the whole file', () => {
    const source = '// biome-ignore-all lint/x: why\nexport const value = 1;\n';
    expect(writtenInto(source, 'block')[1]).toBe('/* ---uv');
  });

  it('refuses a block placed below a next-line directive, loudly', () => {
    const text = '// biome-ignore lint/x: why\n/* ---uv\nl = "domain"\n--- */\n\nexport const v = 1;\n';
    const parsed = parseFrontMatter(text, 'block');
    expect(Result.isFailure(parsed) ? parsed.failure._tag : 'accepted').toBe('MisplacedFrontMatter');
  });
});
