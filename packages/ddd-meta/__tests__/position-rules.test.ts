import { describe, expect, it } from 'bun:test';
import * as Result from 'effect/Result';
import { type CarrierName, carrierOf } from '../src/carrier.ts';
import { parseFrontMatter } from '../src/parse.ts';
import {
  commentSpanEnd,
  containsMachineReadDirective,
  frontMatterCloseIndex,
  frontMatterOpenIndices,
  isBlankLine,
  isRustInnerAttributeLine,
  isShebangLine,
  isXmlPreambleLine,
  MACHINE_READ_DIRECTIVES,
  preambleEnd,
  RUST_INNER_ATTRIBUTE_PREFIX,
  SHEBANG_PREFIX,
  splitLines,
  XML_DOCTYPE_PREFIX,
  XML_PROLOG_PREFIX,
} from '../src/sentinel.ts';
import { fixtureText, successOf } from './support.ts';

const BLOCK_BODY = 'l = "domain"\n--- */\n\nexport const value = 1;\n';

const openingLineOf = (text: string, carrierName: CarrierName): number => {
  const parsed = parseFrontMatter(text, carrierName);
  const outcome = successOf(parsed);
  if (outcome._tag === 'NoFrontMatter') throw new Error('expected front matter, found none');
  return outcome.startLine;
};

const misplacedLineOf = (text: string, carrierName: CarrierName): number => {
  const parsed = parseFrontMatter(text, carrierName);
  if (Result.isSuccess(parsed)) throw new Error(`expected a refusal, received ${JSON.stringify(parsed)}`);
  expect(parsed.failure._tag).toBe('MisplacedFrontMatter');
  return parsed.failure.line;
};

const preambleEndOfFixture = (fixture: string, carrierName: CarrierName): number =>
  preambleEnd(splitLines(fixtureText(fixture)), carrierName);

describe('front matter must open on the first line after the preamble', () => {
  it('accepts a block that opens on line one, with no preamble at all', () => {
    expect(openingLineOf(`/* ---uv\n${BLOCK_BODY}`, 'block')).toBe(1);
  });

  it('refuses a block preceded by a prose comment carrying no machine-read directive', () => {
    expect(misplacedLineOf(`// just prose\n/* ---uv\n${BLOCK_BODY}`, 'block')).toBe(2);
  });

  it('refuses the real Rust doc-comment case, where //! precedes the block', () => {
    const fixture = 'cases/misplaced.rs.fixture';
    const lines = splitLines(fixtureText(fixture));
    expect(preambleEnd(lines, 'block')).toBe(0);
    expect(frontMatterOpenIndices(lines, 'block')[0]).toBeGreaterThan(0);
    expect(misplacedLineOf(fixtureText(fixture), 'block')).toBe(5);
  });
});

describe('a shebang is preamble on line one and nowhere else', () => {
  it('lets a block follow a shebang on line one', () => {
    expect(openingLineOf(`#!/usr/bin/env bun\n/* ---uv\n${BLOCK_BODY}`, 'block')).toBe(2);
  });

  it('refuses to treat a shebang on any later line as preamble', () => {
    expect(misplacedLineOf(`\n#!/usr/bin/env bun\n/* ---uv\n${BLOCK_BODY}`, 'block')).toBe(3);
  });

  it('reads the real python and shell fixtures as one shebang line of preamble', () => {
    for (const fixture of ['hash/scenedetect-wrapper.py.fixture', 'hash/_lib-tokenize.sh.fixture']) {
      const lines = splitLines(fixtureText(fixture));
      expect(isShebangLine(lines[0])).toBe(true);
      expect(preambleEndOfFixture(fixture, 'hash')).toBe(1);
    }
  });

  it('recognises a shebang by its two-character prefix alone', () => {
    expect(SHEBANG_PREFIX).toBe('#!');
    expect(isShebangLine('#!/bin/sh')).toBe(true);
    expect(isShebangLine(' #!/bin/sh')).toBe(false);
  });
});

describe('an XML preamble is preamble for the xml carrier only', () => {
  it('lets a block follow an XML prolog in the real xml fixture', () => {
    expect(preambleEndOfFixture('xml/LoginModalComponent.xml.fixture', 'xml')).toBe(1);
    expect(openingLineOf(fixtureText('cases/carried.xml.fixture'), 'xml')).toBe(2);
  });

  it('lets a block follow a doctype', () => {
    expect(openingLineOf('<!DOCTYPE html>\n<!-- ---uv\nl = "domain"\n--- -->\n', 'xml')).toBe(2);
  });

  it('refuses to treat an XML prolog as preamble under the block carrier', () => {
    expect(misplacedLineOf(`<?xml version="1.0"?>\n/* ---uv\n${BLOCK_BODY}`, 'block')).toBe(2);
  });

  it('recognises the prolog and doctype prefixes it publishes', () => {
    expect(XML_PROLOG_PREFIX).toBe('<?');
    expect(XML_DOCTYPE_PREFIX).toBe('<!DOCTYPE');
    expect(isXmlPreambleLine('  <?xml version="1.0"?>')).toBe(true);
    expect(isXmlPreambleLine('<!DOCTYPE html>')).toBe(true);
    expect(isXmlPreambleLine('<component />')).toBe(false);
  });
});

describe('a Rust inner attribute is preamble, because it must stay at the crate root top', () => {
  it('lets a block follow an inner attribute and a blank line', () => {
    expect(openingLineOf(`#![no_std]\n\n/* ---uv\n${BLOCK_BODY}`, 'block')).toBe(3);
  });

  it('separates an inner attribute from a shebang, which share their first two characters', () => {
    expect(RUST_INNER_ATTRIBUTE_PREFIX).toBe('#![');
    expect(isRustInnerAttributeLine('#![no_std]')).toBe(true);
    expect(isRustInnerAttributeLine('#!/usr/bin/env bun')).toBe(false);
    expect(isShebangLine('#![no_std]')).toBe(true);
  });
});

describe('a machine-read directive is preamble, and prose is not', () => {
  it('pins the closed directive list the preamble rule reads', () => {
    expect(MACHINE_READ_DIRECTIVES).toEqual([
      'biome-ignore',
      'ast-grep-ignore',
      '@ts-expect-error',
      '@ts-ignore',
      '@ts-nocheck',
      'eslint-disable',
      'eslint-enable',
      'svelte-ignore',
      'prettier-ignore',
      '/// <reference',
      '@license',
      'SPDX-License-Identifier',
      'shellcheck',
      'ruff:',
      'noqa',
      '-*- coding',
      'type: ignore',
      'mypy:',
      'pylint:',
      'rustfmt::skip',
      'clippy::',
      '@flow',
      '@jsx',
    ]);
  });

  for (const directive of MACHINE_READ_DIRECTIVES) {
    it(`treats a leading comment carrying ${JSON.stringify(directive)} as preamble`, () => {
      expect(containsMachineReadDirective(`// ${directive} trailing text`)).toBe(true);
      expect(openingLineOf(`// ${directive}\n/* ---uv\n${BLOCK_BODY}`, 'block')).toBe(2);
    });
  }

  it('reads the real biome-ignore fixture as one line of preamble', () => {
    expect(preambleEndOfFixture('cases/machine-read-preamble.ts.fixture', 'block')).toBe(1);
    expect(openingLineOf(fixtureText('cases/machine-read-preamble.ts.fixture'), 'block')).toBe(2);
  });

  it('treats a whole multi-line block comment as preamble when any line of it carries a directive', () => {
    expect(openingLineOf(`/*\n * @license MIT\n */\n/* ---uv\n${BLOCK_BODY}`, 'block')).toBe(4);
  });

  it('does not treat an ordinary comment as preamble', () => {
    expect(containsMachineReadDirective('// just prose')).toBe(false);
    expect(misplacedLineOf(`/* a header */\n/* ---uv\n${BLOCK_BODY}`, 'block')).toBe(2);
  });
});

describe('the preamble scan never swallows the front matter it is scanning for', () => {
  it('reads a block whose payload contains a directive word as front matter', () => {
    const parsed = successOf(parseFrontMatter('/* ---uv\ntags = ["noqa"]\n--- */\n', 'block'));
    expect(parsed).toMatchObject({ _tag: 'FrontMatter', startLine: 1, value: { tags: ['noqa'] } });
  });

  it('reads a block whose link value contains a licence directive as front matter', () => {
    const payload = 'links = { license = "https://spdx.test/@license" }';
    const parsed = successOf(parseFrontMatter(`/* ---uv\n${payload}\n--- */\n`, 'block'));
    expect(parsed).toMatchObject({ _tag: 'FrontMatter', startLine: 1 });
  });

  it('keeps that carve-out under a preamble, where the scan is already running', () => {
    expect(openingLineOf('// biome-ignore lint: x\n/* ---uv\ntags = ["noqa"]\n--- */\n', 'block')).toBe(2);
  });
});

describe('the preamble primitives report what the position rule is built on', () => {
  it('counts blank lines as preamble without ending it', () => {
    expect(isBlankLine('')).toBe(true);
    expect(isBlankLine('   \t ')).toBe(true);
    expect(isBlankLine('x')).toBe(false);
    expect(openingLineOf(`\n\n/* ---uv\n${BLOCK_BODY}`, 'block')).toBe(3);
  });

  it('reports a comment span end, and reports minus one when the line is not a comment', () => {
    const block = carrierOf('block');
    expect(commentSpanEnd(block, ['// one', 'code'], 0)).toBe(0);
    expect(commentSpanEnd(block, ['/*', 'body', '*/', 'code'], 0)).toBe(2);
    expect(commentSpanEnd(block, ['/* one */', 'code'], 0)).toBe(0);
    expect(commentSpanEnd(block, ['code'], 0)).toBe(-1);
    expect(commentSpanEnd(carrierOf('xml'), ['# hash', 'code'], 0)).toBe(-1);
  });

  it('reports opening indices zero-based and a missing close as minus one', () => {
    const lines = splitLines('# ---uv\n# l = "domain"\n# ---\n');
    expect(frontMatterOpenIndices(lines, 'hash')).toEqual([0]);
    expect(frontMatterCloseIndex(lines, 'hash', 1)).toBe(2);
    expect(frontMatterCloseIndex(splitLines('# ---uv\n'), 'hash', 1)).toBe(-1);
    expect(frontMatterOpenIndices(splitLines('code\n'), 'hash')).toEqual([]);
  });

  it('ends the preamble at the first line that is neither exempt nor a directive comment', () => {
    expect(preambleEnd(splitLines('code\n'), 'block')).toBe(0);
    expect(preambleEnd(splitLines('#!/bin/sh\ncode\n'), 'hash')).toBe(1);
    expect(preambleEnd(splitLines('\n\n'), 'block')).toBe(0);
  });
});
