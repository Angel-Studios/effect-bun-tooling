import { describe, expect, it } from 'bun:test';
import {
  CARRIER_NAMES,
  CARRIERS,
  type CarrierName,
  carrierOf,
  isCarrierName,
  isFrontMatterCloseLine,
  isFrontMatterOpenLine,
  payloadLine,
  SENTINEL,
  SENTINEL_TERMINATOR,
  stripPayloadPrefix,
} from '../src/carrier.ts';
import { type FrontMatterBlock, NO_FRONT_MATTER, parseFrontMatter } from '../src/parse.ts';
import { REGISTRY_KEYS } from '../src/registry.ts';
import type { FrontMatter } from '../src/schema.ts';
import { detectEol, joinLines, splitLines } from '../src/sentinel.ts';
import { renderFrontMatter, upsertFrontMatter } from '../src/write.ts';
import { CARRIED_REAL_FIXTURES } from './fixtures/provenance.ts';
import { CANONICAL_PAYLOAD, fixtureText, ROUND_TRIP_FIXTURE_OF, successOf } from './support.ts';

const carriedBlockOf = (text: string, carrierName: CarrierName): FrontMatterBlock => {
  const outcome = successOf(parseFrontMatter(text, carrierName));
  if (outcome._tag === 'NoFrontMatter') {
    throw new Error(`expected front matter in the ${carrierName} carrier, found none`);
  }
  return outcome;
};

const writeInto = (fixture: string, carrierName: CarrierName, value: FrontMatter): string =>
  successOf(upsertFrontMatter(fixtureText(fixture), carrierName, value));

const roundTripThrough = (carrierName: CarrierName): FrontMatterBlock =>
  carriedBlockOf(writeInto(ROUND_TRIP_FIXTURE_OF[carrierName], carrierName, CANONICAL_PAYLOAD), carrierName);

const sortedCopy = (values: readonly string[]): readonly string[] => [...values].sort();

describe('the payload exercises the whole registry, so the matrix is not a partial claim', () => {
  it('names every registry field exactly once', () => {
    expect(sortedCopy(Object.keys(CANONICAL_PAYLOAD))).toEqual(sortedCopy(REGISTRY_KEYS));
  });
});

describe('the four carriers are one sentinel wearing four comment syntaxes', () => {
  it('builds every open and close delimiter out of the shared sentinel token', () => {
    for (const carrierName of CARRIER_NAMES) {
      const carrier = carrierOf(carrierName);
      expect(carrier.open).toContain(SENTINEL);
      expect(carrier.close).toContain(SENTINEL_TERMINATOR);
      expect(carrier.name).toBe(carrierName);
    }
  });

  it('pins every carrier by content, so no delimiter or leader can drift unnoticed', () => {
    expect(CARRIERS).toEqual({
      block: {
        name: 'block',
        open: '/* ---uv',
        linePrefix: '',
        close: '--- */',
        lineCommentLeaders: ['//'],
        blockComment: { open: '/*', close: '*/', nests: true },
      },
      hash: {
        name: 'hash',
        open: '# ---uv',
        linePrefix: '# ',
        close: '# ---',
        lineCommentLeaders: ['#'],
        blockComment: undefined,
      },
      apostrophe: {
        name: 'apostrophe',
        open: "' ---uv",
        linePrefix: "' ",
        close: "' ---",
        lineCommentLeaders: ["'"],
        blockComment: undefined,
      },
      xml: {
        name: 'xml',
        open: '<!-- ---uv',
        linePrefix: '',
        close: '--- -->',
        lineCommentLeaders: [],
        blockComment: { open: '<!--', close: '-->', nests: false },
      },
    });
  });

  it('gives each carrier a distinct opening line, so a file cannot match two at once', () => {
    const opens = CARRIER_NAMES.map((carrierName) => carrierOf(carrierName).open);
    expect(new Set(opens).size).toBe(CARRIER_NAMES.length);
  });

  it('recognises exactly the four declared carrier names', () => {
    expect(CARRIER_NAMES).toEqual(['block', 'hash', 'apostrophe', 'xml']);
    expect(sortedCopy(Object.keys(CARRIERS))).toEqual(sortedCopy(CARRIER_NAMES));
    for (const carrierName of CARRIER_NAMES) expect(isCarrierName(carrierName)).toBe(true);
    expect(isCarrierName('markdown')).toBe(false);
  });

  it('matches an open or close line only after trimming, and only on an exact token', () => {
    const carrier = carrierOf('block');
    expect(isFrontMatterOpenLine(carrier, '   /* ---uv   ')).toBe(true);
    expect(isFrontMatterOpenLine(carrier, '/* ---uv extra')).toBe(false);
    expect(isFrontMatterOpenLine(carrier, '/*---uv')).toBe(false);
    expect(isFrontMatterCloseLine(carrier, '  --- */ ')).toBe(true);
    expect(isFrontMatterCloseLine(carrier, '---*/')).toBe(false);
  });

  it('round-trips a payload line through its own carrier prefix', () => {
    for (const carrierName of CARRIER_NAMES) {
      const carrier = carrierOf(carrierName);
      expect(stripPayloadPrefix(carrier, payloadLine(carrier, 'l = "domain"'))).toBe('l = "domain"');
      expect(stripPayloadPrefix(carrier, payloadLine(carrier, ''))).toBe('');
    }
  });

  it('reports a payload line missing the carrier prefix as absent rather than as empty', () => {
    expect(stripPayloadPrefix(carrierOf('hash'), 'owner = "cerebro"')).toBeUndefined();
    expect(stripPayloadPrefix(carrierOf('apostrophe'), 'owner = "cerebro"')).toBeUndefined();
    expect(stripPayloadPrefix(carrierOf('block'), 'owner = "cerebro"')).toBe('owner = "cerebro"');
  });
});

describe('one identical payload survives all four carriers', () => {
  for (const carrierName of CARRIER_NAMES) {
    it(`reads back through the ${carrierName} carrier exactly what it wrote`, () => {
      expect(roundTripThrough(carrierName).value).toEqual(CANONICAL_PAYLOAD);
    });
  }

  it('yields four decoded values that equal each other, not merely the source payload', () => {
    const decoded = CARRIER_NAMES.map((carrierName) => roundTripThrough(carrierName).value);
    for (const left of decoded) {
      for (const right of decoded) expect(left).toEqual(right);
    }
    expect(decoded.length).toBe(CARRIER_NAMES.length);
    expect(new Set(decoded.map((value) => JSON.stringify(value))).size).toBe(1);
  });

  it('reports the block span as 1-based inclusive lines whose raw text is the block itself', () => {
    for (const carrierName of CARRIER_NAMES) {
      const written = writeInto(ROUND_TRIP_FIXTURE_OF[carrierName], carrierName, CANONICAL_PAYLOAD);
      const block = carriedBlockOf(written, carrierName);
      const lines = splitLines(written);
      expect(lines[block.startLine - 1]).toBe(carrierOf(carrierName).open);
      expect(lines[block.endLine - 1]).toBe(carrierOf(carrierName).close);
      expect(block.raw).toBe(joinLines(lines.slice(block.startLine - 1, block.endLine), detectEol(written)));
      expect(block.carrier).toBe(carrierName);
    }
  });

  it('renders the block alone, with no trailing line ending', () => {
    for (const carrierName of CARRIER_NAMES) {
      const rendered = successOf(renderFrontMatter(CANONICAL_PAYLOAD, carrierName, '\n'));
      expect(rendered.startsWith(carrierOf(carrierName).open)).toBe(true);
      expect(rendered.endsWith(carrierOf(carrierName).close)).toBe(true);
      expect(splitLines(rendered).length).toBe(REGISTRY_KEYS.length + 2);
    }
  });
});

describe('every real per-language fixture carries the payload through its own carrier', () => {
  for (const provenance of CARRIED_REAL_FIXTURES) {
    it(`writes and reads the canonical payload in ${provenance.fixture}`, () => {
      const written = writeInto(provenance.fixture, provenance.carrier, CANONICAL_PAYLOAD);
      expect(carriedBlockOf(written, provenance.carrier).value).toEqual(CANONICAL_PAYLOAD);
    });
  }

  it('reads a block written for one carrier as absent under any other carrier', () => {
    const written = writeInto(ROUND_TRIP_FIXTURE_OF.block, 'block', CANONICAL_PAYLOAD);
    for (const carrierName of CARRIER_NAMES) {
      if (carrierName !== 'block') {
        const outcome = successOf(parseFrontMatter(written, carrierName));
        expect(outcome).toEqual(NO_FRONT_MATTER);
      }
    }
  });
});
