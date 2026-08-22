import { describe, expect, it } from 'bun:test';
import {
  type BlockCommentDelimiters,
  CARRIER_NAMES,
  type CarrierName,
  carrierOf,
  HOST_COMMENT_END_SEQUENCES,
  stripPayloadPrefix,
} from '../src/carrier.ts';
import type { FrontMatterError } from '../src/errors.ts';
import { parseFrontMatter } from '../src/parse.ts';
import type { FrontMatter } from '../src/schema.ts';
import { countOccurrences, LF, splitLines } from '../src/sentinel.ts';
import { renderFrontMatter, renderFrontMatterLines, upsertFrontMatter } from '../src/write.ts';
import { CANONICAL_PAYLOAD, failureOf, fixtureText, successOf } from './support.ts';

const EXPECTED_END_SEQUENCES: readonly string[] = ['/*', '*/', '-->'];

const NOT_NEUTRALISED: readonly string[] = ['<!--'];

const TERMINATOR_CASES: readonly (readonly [string, FrontMatter])[] = [
  ['a block comment close', { links: { adr: 'https://x.test/a*/b' } }],
  ['an xml comment close', { links: { adr: 'https://x.test/a-->b' } }],
  ['an overlapping block comment close', { links: { adr: 'https://x.test/a**/b' } }],
  ['an overlapping xml comment close', { links: { adr: 'https://x.test/a--->b' } }],
  ['both terminators in one value', { links: { adr: 'https://x.test/a*/b-->c/d**/e--->f' } }],
  ['a terminator beside the characters already escaped', { links: { adr: 'https://x.test/a\\*/"-->' } }],
  ['an unbalanced block comment open', { links: { adr: 'https://x.test/*abc' } }],
  ['an opener immediately followed by a closer', { links: { adr: 'https://x.test/*/y' } }],
  ['an opener and a closer far apart', { links: { adr: 'https://x.test/*a/b*/c' } }],
];

const BLOCK_HOST_FIXTURES: readonly (readonly [string, string])[] = [
  ['a TypeScript host', 'block/sweep.ts.fixture'],
  ['a Rust host, whose block comments nest', 'block/protocol.rs.fixture'],
];

const BLOCK_COMMENT_CARRIERS: readonly (readonly [CarrierName, BlockCommentDelimiters])[] = [
  ['block', { open: '/*', close: '*/', nests: true }],
  ['xml', { open: '<!--', close: '-->', nests: false }],
];

const LINE_COMMENT_CARRIERS: readonly CarrierName[] = ['hash', 'apostrophe'];

const bodyLinesOf = (value: FrontMatter, carrierName: CarrierName): readonly string[] =>
  renderFrontMatterLines(value, carrierName).slice(1, -1);

const strippedBodyOf = (value: FrontMatter, carrierName: CarrierName): readonly string[] => {
  const carrier = carrierOf(carrierName);
  return bodyLinesOf(value, carrierName).map((line) => {
    const stripped = stripPayloadPrefix(carrier, line);
    if (stripped === undefined) throw new Error(`the ${carrierName} carrier rendered an unprefixed line`);
    return stripped;
  });
};

const refusalOf = (text: string, carrierName: CarrierName): FrontMatterError =>
  failureOf(parseFrontMatter(text, carrierName));

const valueReadBack = (text: string, carrierName: CarrierName): FrontMatter => {
  const outcome = successOf(parseFrontMatter(text, carrierName));
  if (outcome._tag === 'NoFrontMatter') throw new Error('expected front matter, found none');
  return outcome.value;
};

describe('an escaped payload preserves the value it was handed, on every carrier', () => {
  for (const carrierName of CARRIER_NAMES) {
    for (const [label, value] of TERMINATOR_CASES) {
      it(`reads back ${label} deep-equal through the ${carrierName} carrier`, () => {
        expect(valueReadBack(renderFrontMatter(value, carrierName, LF), carrierName)).toEqual(value);
      });
    }
  }
});

describe('a rendered payload line never carries a sequence that moves the host comment end', () => {
  for (const carrierName of CARRIER_NAMES) {
    for (const [label, value] of TERMINATOR_CASES) {
      it(`emits no end sequence for ${label} under the ${carrierName} carrier`, () => {
        for (const line of bodyLinesOf(value, carrierName)) {
          for (const sequence of EXPECTED_END_SEQUENCES) expect(line).not.toContain(sequence);
        }
      });
    }
  }

  it('neutralises unconditionally, so the payload bytes stay one payload behind four delimiter sets', () => {
    for (const [label, value] of TERMINATOR_CASES) {
      const payloads = CARRIER_NAMES.map((carrierName) => strippedBodyOf(value, carrierName).join(LF));
      expect(`${label}: ${new Set(payloads).size}`).toBe(`${label}: 1`);
      expect(payloads.length).toBe(CARRIER_NAMES.length);
    }
  });
});

describe('the block a real block-carrier file receives opens and closes exactly once', () => {
  for (const [host, fixture] of BLOCK_HOST_FIXTURES) {
    it(`starts from ${host} carrying no block comment of its own`, () => {
      expect(countOccurrences(fixtureText(fixture), '/*')).toBe(0);
      expect(countOccurrences(fixtureText(fixture), '*/')).toBe(0);
    });

    for (const [label, value] of TERMINATOR_CASES) {
      it(`leaves one open and one close in ${host} after writing ${label}`, () => {
        const written = successOf(upsertFrontMatter(fixtureText(fixture), 'block', value));
        expect(countOccurrences(written, '/*')).toBe(1);
        expect(countOccurrences(written, '*/')).toBe(1);
        expect(valueReadBack(written, 'block')).toEqual(value);
      });
    }
  }
});

describe('a hand-authored payload line that moves the host comment end is refused, loudly', () => {
  it('refuses a block payload line carrying the block comment close', () => {
    const text = '/* ---uv\nlinks = { adr = "https://x.test/a*/b" }\n--- */\n\nexport const value = 1;\n';
    expect(refusalOf(text, 'block')).toEqual({
      _tag: 'PayloadMovesHostCommentEnd',
      carrier: 'block',
      line: 2,
      sequence: '*/',
    });
  });

  it('refuses an xml payload line carrying the xml comment close', () => {
    const text = '<!-- ---uv\nlinks = { adr = "https://x.test/a-->b" }\n--- -->\n';
    expect(refusalOf(text, 'xml')).toEqual({
      _tag: 'PayloadMovesHostCommentEnd',
      carrier: 'xml',
      line: 2,
      sequence: '-->',
    });
  });

  it('refuses a block payload line carrying an unbalanced block comment open', () => {
    const text = '/* ---uv\nlinks = { adr = "https://x.test/*abc" }\n--- */\n\nexport const value = 1;\n';
    expect(refusalOf(text, 'block')).toEqual({
      _tag: 'PayloadMovesHostCommentEnd',
      carrier: 'block',
      line: 2,
      sequence: '/*',
    });
  });

  it('accepts an xml payload line carrying a block comment open, which cannot move an xml end', () => {
    const text = '<!-- ---uv\nlinks = { adr = "https://x.test/*abc" }\n--- -->\n';
    expect(valueReadBack(text, 'xml')).toEqual({ links: { adr: 'https://x.test/*abc' } });
  });

  it('names the offending payload line rather than the opening line', () => {
    const text = '/* ---uv\nl = "domain"\nlinks = { adr = "https://x.test/a*/b" }\n--- */\n';
    expect(refusalOf(text, 'block')).toMatchObject({
      _tag: 'PayloadMovesHostCommentEnd',
      line: 3,
    });
  });
});

describe('the close fence carries the terminator by construction and must never trip the guard', () => {
  for (const carrierName of CARRIER_NAMES) {
    it(`accepts a well-formed ${carrierName} block whatever its own fences contain`, () => {
      expect(valueReadBack(renderFrontMatter(CANONICAL_PAYLOAD, carrierName, LF), carrierName)).toEqual(
        CANONICAL_PAYLOAD,
      );
    });
  }

  for (const [carrierName, delimiters] of BLOCK_COMMENT_CARRIERS) {
    it(`closes the ${carrierName} block on a fence that does contain ${delimiters.close}`, () => {
      const carrier = carrierOf(carrierName);
      expect(carrier.blockComment).toEqual(delimiters);
      expect(carrier.close).toContain(delimiters.close);
      const lines = splitLines(renderFrontMatter(CANONICAL_PAYLOAD, carrierName, LF));
      expect(lines[lines.length - 1]).toBe(carrier.close);
    });
  }
});

describe('the neutralised set is derived from the carrier table, and its boundary is deliberate', () => {
  it('holds exactly the sequences that relocate a host comment end', () => {
    expect([...HOST_COMMENT_END_SEQUENCES].sort()).toEqual([...EXPECTED_END_SEQUENCES].sort());
  });

  it('excludes the xml comment open, which cannot move where an xml comment ends', () => {
    for (const sequence of NOT_NEUTRALISED) expect(HOST_COMMENT_END_SEQUENCES).not.toContain(sequence);
  });

  it('takes the block comment open only from the carrier that declares its hosts nest', () => {
    expect(carrierOf('block').blockComment?.nests).toBe(true);
    expect(carrierOf('xml').blockComment?.nests).toBe(false);
    expect(HOST_COMMENT_END_SEQUENCES).toContain('/*');
  });

  it('round-trips a value whose opener and closer overlap at adjacent indices', () => {
    const value: FrontMatter = { links: { adr: 'https://x.test/*/y' } };
    const payload = strippedBodyOf(value, 'block').join(LF);
    expect(payload).toBe('links = { adr = "https://x.test\\u002F\\u002A/y" }');
    for (const sequence of EXPECTED_END_SEQUENCES) expect(payload).not.toContain(sequence);
    expect(valueReadBack(renderFrontMatter(value, 'block', LF), 'block')).toEqual(value);
  });
});

describe('the guard is a genuine no-op for the two line-comment carriers', () => {
  it('accepts a hand-authored hash payload line containing every end sequence', () => {
    const text = '# ---uv\n# links = { adr = "https://x.test/*a*/b-->c" }\n# ---\n';
    expect(valueReadBack(text, 'hash')).toEqual({ links: { adr: 'https://x.test/*a*/b-->c' } });
  });

  it('accepts a hand-authored apostrophe payload line containing every end sequence', () => {
    const text = "' ---uv\n' links = { adr = \"https://x.test/*a*/b-->c\" }\n' ---\n";
    expect(valueReadBack(text, 'apostrophe')).toEqual({ links: { adr: 'https://x.test/*a*/b-->c' } });
  });

  it('declares no block comment for either line-comment carrier, which is why nothing can fire', () => {
    for (const carrierName of LINE_COMMENT_CARRIERS) {
      expect(carrierOf(carrierName).blockComment).toBeUndefined();
    }
  });
});
