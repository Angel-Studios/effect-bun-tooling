import { describe, expect, it } from 'bun:test';
import * as Result from 'effect/Result';
import { type CarrierName, carrierOf, stripPayloadPrefix } from '../src/carrier.ts';
import {
  carrierLinePrefixMissing,
  describeFrontMatterError,
  duplicateFrontMatter,
  emptyPayload,
  FRONT_MATTER_ERROR_TAGS,
  type FrontMatterError,
  misplacedFrontMatter,
  payloadMovesHostCommentEnd,
  schemaDecode,
  tomlSyntax,
  unterminatedBlock,
} from '../src/errors.ts';
import { NO_FRONT_MATTER, parseFrontMatter } from '../src/parse.ts';
import { frontMatterCloseIndex, frontMatterOpenIndices, preambleEnd, splitLines } from '../src/sentinel.ts';
import { CASE_FIXTURES, type CaseFixture, REAL_FIXTURES } from './fixtures/provenance.ts';
import { failureOf, fixtureText, successOf } from './support.ts';

const SILENTLY_IGNORED_PROSE_FIXTURES: readonly (readonly [string, CarrierName])[] = [
  ['block/protocol.rs.fixture', 'block'],
  ['hash/_lib-tokenize.sh.fixture', 'hash'],
  ['apostrophe/AttachButton.brs.fixture', 'apostrophe'],
  ['xml/LoginModalComponent.xml.fixture', 'xml'],
];

const caseOf = (fixture: string): CaseFixture => {
  const found = CASE_FIXTURES.find((authored) => authored.fixture === fixture);
  if (found === undefined) throw new Error(`no authored case named ${fixture}`);
  return found;
};

const failureFor = (fixture: string): FrontMatterError => {
  const authored = caseOf(fixture);
  return failureOf(parseFrontMatter(fixtureText(authored.fixture), authored.carrier));
};

const openIndicesFor = (fixture: string): readonly number[] => {
  const authored = caseOf(fixture);
  return frontMatterOpenIndices(splitLines(fixtureText(authored.fixture)), authored.carrier);
};

type ParseResult = ReturnType<typeof parseFrontMatter>;

const tagOfOutcome = (parsed: ParseResult): string =>
  Result.isFailure(parsed) ? parsed.failure._tag : parsed.success._tag;

const lineOfOutcome = (parsed: ParseResult): number => {
  if (Result.isFailure(parsed)) return parsed.failure.line;
  return parsed.success._tag === 'FrontMatter' ? parsed.success.startLine : 0;
};

const outcomeOf = (authored: CaseFixture): ParseResult =>
  parseFrontMatter(fixtureText(authored.fixture), authored.carrier);

describe('a block with no sentinel is not front matter and is silently ignored', () => {
  for (const [fixture, carrierName] of SILENTLY_IGNORED_PROSE_FIXTURES) {
    it(`ignores the leading prose comment in ${fixture} instead of failing on it`, () => {
      const outcome = successOf(parseFrontMatter(fixtureText(fixture), carrierName));
      expect(outcome).toEqual(NO_FRONT_MATTER);
    });
  }

  it('leaves every real derived fixture unbothered, matching what provenance records', () => {
    for (const provenance of REAL_FIXTURES) {
      const outcome = successOf(parseFrontMatter(fixtureText(provenance.fixture), provenance.carrier));
      expect(outcome).toEqual(NO_FRONT_MATTER);
      expect(provenance.carriesFrontMatter).toBe(false);
    }
  });

  it('ignores a near-miss sentinel rather than guessing the author meant front matter', () => {
    for (const open of ['/* ---uvx', '/*---uv', '/* ---uv extra', '/* --uv', '/* ---UV']) {
      const text = `${open}\nl = "domain"\n--- */\n\nexport const value = 1;\n`;
      const outcome = successOf(parseFrontMatter(text, 'block'));
      expect(outcome).toEqual(NO_FRONT_MATTER);
    }
  });

  it('ignores a file with no comment at all', () => {
    const uncommented = successOf(parseFrontMatter('export const value = 1;\n', 'block'));
    const empty = successOf(parseFrontMatter('', 'hash'));
    expect(uncommented).toEqual(NO_FRONT_MATTER);
    expect(empty).toEqual(NO_FRONT_MATTER);
  });
});

describe('a sentinel with a malformed payload is loud, and every declared tag is reachable', () => {
  it('reaches every tag the package declares, and declares no tag it cannot reach', () => {
    const observed = new Set(CASE_FIXTURES.map((authored) => tagOfOutcome(outcomeOf(authored))));
    for (const tag of FRONT_MATTER_ERROR_TAGS) expect(observed.has(tag)).toBe(true);
    expect(new Set(FRONT_MATTER_ERROR_TAGS).size).toBe(FRONT_MATTER_ERROR_TAGS.length);
  });

  it('agrees with every outcome the fixture record claims, tag and line together', () => {
    for (const authored of CASE_FIXTURES) {
      const parsed = outcomeOf(authored);
      expect(`${authored.fixture} ${tagOfOutcome(parsed)}`).toBe(`${authored.fixture} ${authored.expected}`);
      expect(`${authored.fixture} line ${lineOfOutcome(parsed)}`).toBe(
        `${authored.fixture} line ${authored.expectedLine}`,
      );
    }
  });
});

describe('each loud tag names the line its own contract says it names', () => {
  it('names the opening line when the block is never closed', () => {
    const failed = failureFor('cases/unterminated.ts.fixture');
    expect(failed._tag).toBe('UnterminatedBlock');
    expect(failed.line).toBe(openIndicesFor('cases/unterminated.ts.fixture')[0] + 1);
    const lines = splitLines(fixtureText('cases/unterminated.ts.fixture'));
    expect(frontMatterCloseIndex(lines, 'block', 1)).toBe(-1);
  });

  it('names the offending payload line when a carrier prefix is missing', () => {
    const fixture = 'cases/prefix-missing.py.fixture';
    const failed = failureFor(fixture);
    const lines = splitLines(fixtureText(fixture));
    const carrier = carrierOf('hash');
    const open = openIndicesFor(fixture)[0];
    const close = frontMatterCloseIndex(lines, 'hash', open + 1);
    const offending = lines.findIndex(
      (line, index) => index > open && index < close && stripPayloadPrefix(carrier, line) === undefined,
    );
    expect(failed._tag).toBe('CarrierLinePrefixMissing');
    expect(failed.line).toBe(offending + 1);
    expect(failed.line).not.toBe(open + 1);
  });

  it('names the opening line when the payload declares no fields', () => {
    const failed = failureFor('cases/empty-payload.css.fixture');
    expect(failed._tag).toBe('EmptyPayload');
    expect(failed.line).toBe(openIndicesFor('cases/empty-payload.css.fixture')[0] + 1);
  });

  it('names the opening line, and the parser message, when the payload is not TOML', () => {
    const failed = failureFor('cases/toml-syntax.kt.fixture');
    expect(failed).toMatchObject({ _tag: 'TomlSyntax', carrier: 'block' });
    expect(failed.line).toBe(openIndicesFor('cases/toml-syntax.kt.fixture')[0] + 1);
    expect(describeFrontMatterError(failed)).toContain('is not TOML');
  });

  it('names the opening line when a declared field breaks its own value shape', () => {
    const failed = failureFor('cases/unsorted-tags.brs.fixture');
    expect(failed).toMatchObject({ _tag: 'SchemaDecode', carrier: 'apostrophe' });
    expect(failed.line).toBe(openIndicesFor('cases/unsorted-tags.brs.fixture')[0] + 1);
  });

  it('names the opening line when the payload carries a key the schema does not declare', () => {
    const failed = failureFor('cases/forbidden-key.ts.fixture');
    expect(failed).toMatchObject({ _tag: 'SchemaDecode', carrier: 'block' });
    expect(failed.line).toBe(openIndicesFor('cases/forbidden-key.ts.fixture')[0] + 1);
  });

  it('names the misplaced opening, and proves it is not where the preamble ends', () => {
    const fixture = 'cases/misplaced.rs.fixture';
    const failed = failureFor(fixture);
    const open = openIndicesFor(fixture)[0];
    expect(failed._tag).toBe('MisplacedFrontMatter');
    expect(failed.line).toBe(open + 1);
    expect(preambleEnd(splitLines(fixtureText(fixture)), 'block')).not.toBe(open);
  });

  it('names the SECOND opening when one file carries two', () => {
    const fixture = 'cases/duplicate.sh.fixture';
    const failed = failureFor(fixture);
    const opens = openIndicesFor(fixture);
    expect(failed._tag).toBe('DuplicateFrontMatter');
    expect(opens.length).toBe(2);
    expect(failed.line).toBe(opens[1] + 1);
    expect(failed.line).not.toBe(opens[0] + 1);
  });
});

describe('the error surface is closed data with a rendering for every tag', () => {
  it('constructs each declared error with the shape the tag promises', () => {
    expect(unterminatedBlock('block', 3)).toEqual({ _tag: 'UnterminatedBlock', carrier: 'block', line: 3 });
    expect(carrierLinePrefixMissing('hash', 4)).toEqual({
      _tag: 'CarrierLinePrefixMissing',
      carrier: 'hash',
      line: 4,
    });
    expect(emptyPayload('xml', 1)).toEqual({ _tag: 'EmptyPayload', carrier: 'xml', line: 1 });
    expect(tomlSyntax('block', 1, 'why')).toEqual({
      _tag: 'TomlSyntax',
      carrier: 'block',
      line: 1,
      message: 'why',
    });
    expect(schemaDecode('block', 1, 'why')).toEqual({
      _tag: 'SchemaDecode',
      carrier: 'block',
      line: 1,
      message: 'why',
    });
    expect(payloadMovesHostCommentEnd('block', 8, '*/')).toEqual({
      _tag: 'PayloadMovesHostCommentEnd',
      carrier: 'block',
      line: 8,
      sequence: '*/',
    });
    expect(misplacedFrontMatter(5)).toEqual({ _tag: 'MisplacedFrontMatter', line: 5 });
    expect(duplicateFrontMatter(6)).toEqual({ _tag: 'DuplicateFrontMatter', line: 6 });
  });

  it('omits the carrier from the two errors that are about position rather than syntax', () => {
    expect('carrier' in misplacedFrontMatter(5)).toBe(false);
    expect('carrier' in duplicateFrontMatter(6)).toBe(false);
  });

  it('renders every tag as a distinct sentence naming its 1-based line', () => {
    const rendered = [
      unterminatedBlock('block', 1),
      carrierLinePrefixMissing('hash', 2),
      emptyPayload('xml', 3),
      tomlSyntax('block', 4, 'why'),
      schemaDecode('block', 5, 'why'),
      payloadMovesHostCommentEnd('block', 6, '*/'),
      misplacedFrontMatter(7),
      duplicateFrontMatter(8),
    ].map(describeFrontMatterError);
    expect(rendered.length).toBe(FRONT_MATTER_ERROR_TAGS.length);
    expect(new Set(rendered).size).toBe(FRONT_MATTER_ERROR_TAGS.length);
    for (const [index, sentence] of rendered.entries()) expect(sentence).toContain(`line ${index + 1}`);
  });
});
