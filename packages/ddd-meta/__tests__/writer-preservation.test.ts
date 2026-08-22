import { describe, expect, it } from 'bun:test';
import { CARRIER_NAMES, type CarrierName, carrierOf } from '../src/carrier.ts';
import { parseFrontMatter } from '../src/parse.ts';
import { FIELD_REGISTRY, REGISTRY_KEYS } from '../src/registry.ts';
import type { FrontMatter } from '../src/schema.ts';
import {
  CRLF,
  countOccurrences,
  detectEol,
  hasFinalNewline,
  joinLines,
  LF,
  splitLines,
} from '../src/sentinel.ts';
import {
  canonicalIdentList,
  escapeTomlBasicString,
  renderFrontMatter,
  renderFrontMatterLines,
  renderPayloadLines,
  renderTomlArray,
  renderTomlInlineTable,
  renderTomlString,
  renderTomlValue,
  upsertFrontMatter,
} from '../src/write.ts';
import { REAL_FIXTURES } from './fixtures/provenance.ts';
import {
  CANONICAL_PAYLOAD,
  failureOf,
  fixtureText,
  ROUND_TRIP_FIXTURE_OF,
  SECOND_PAYLOAD,
  successOf,
} from './support.ts';

const upsertInto = (text: string, carrierName: CarrierName, value: FrontMatter): string =>
  successOf(upsertFrontMatter(text, carrierName, value));

const valueReadBack = (text: string, carrierName: CarrierName): FrontMatter => {
  const outcome = successOf(parseFrontMatter(text, carrierName));
  if (outcome._tag === 'NoFrontMatter') throw new Error('expected front matter, found none');
  return outcome.value;
};

const REVERSED_PAYLOAD: FrontMatter = {
  oncall: 'platform_oncall',
  review: '2026-08-01',
  links: { runbook: 'https://example.test/runbook', adr: 'https://example.test/adr/0001' },
  deprecated: '2026-01-31',
  data: ['pii', 'pci'],
  tier: 'tier_one',
  owner: 'platform_tooling',
  tags: ['beta', 'alpha'],
  subdomain: 'core',
  p: 'aggregate_root',
  l: 'domain',
};

describe('upsert is idempotent, byte for byte, on every carrier', () => {
  for (const carrierName of CARRIER_NAMES) {
    it(`writes the same bytes twice through the ${carrierName} carrier`, () => {
      const original = fixtureText(ROUND_TRIP_FIXTURE_OF[carrierName]);
      const once = upsertInto(original, carrierName, CANONICAL_PAYLOAD);
      expect(upsertInto(once, carrierName, CANONICAL_PAYLOAD)).toBe(once);
    });
  }

  for (const provenance of REAL_FIXTURES) {
    it(`writes the same bytes twice into ${provenance.fixture}`, () => {
      const once = upsertInto(fixtureText(provenance.fixture), provenance.carrier, CANONICAL_PAYLOAD);
      expect(upsertInto(once, provenance.carrier, CANONICAL_PAYLOAD)).toBe(once);
    });
  }

  it('stays idempotent when the payload it writes replaces a different payload', () => {
    const first = upsertInto(fixtureText('cases/carried.xml.fixture'), 'xml', CANONICAL_PAYLOAD);
    const second = upsertInto(first, 'xml', SECOND_PAYLOAD);
    expect(upsertInto(second, 'xml', SECOND_PAYLOAD)).toBe(second);
  });
});

describe('an existing block is replaced in place, never duplicated', () => {
  it('leaves exactly one opening line and the new payload behind', () => {
    const original = fixtureText('cases/carried.xml.fixture');
    const rewritten = upsertInto(original, 'xml', SECOND_PAYLOAD);
    expect(countOccurrences(rewritten, carrierOf('xml').open)).toBe(1);
    expect(countOccurrences(rewritten, carrierOf('xml').close)).toBe(1);
    expect(valueReadBack(rewritten, 'xml')).toEqual(SECOND_PAYLOAD);
  });

  it('keeps the file content that followed the block it replaced', () => {
    const rewritten = upsertInto(fixtureText('cases/carried.xml.fixture'), 'xml', SECOND_PAYLOAD);
    expect(rewritten).toContain('<component name="LoginModal" extends="BaseScreen">');
    expect(rewritten).toContain('<?xml version="1.0" encoding="utf-8" ?>');
  });

  it('keeps the preamble above the block it inserts', () => {
    for (const fixture of ['hash/scenedetect-wrapper.py.fixture', 'hash/_lib-tokenize.sh.fixture']) {
      const original = fixtureText(fixture);
      const written = upsertInto(original, 'hash', CANONICAL_PAYLOAD);
      expect(splitLines(written)[0]).toBe(splitLines(original)[0]);
      expect(splitLines(written)[1]).toBe(carrierOf('hash').open);
    }
  });

  it('keeps an XML prolog above the block it inserts', () => {
    const original = fixtureText('xml/LoginModalComponent.xml.fixture');
    const written = upsertInto(original, 'xml', CANONICAL_PAYLOAD);
    expect(splitLines(written)[0]).toBe(splitLines(original)[0]);
    expect(splitLines(written)[1]).toBe(carrierOf('xml').open);
  });

  it('separates the block from adjacent content, so a comment cannot read as a continuation', () => {
    const written = upsertInto(fixtureText('hash/bunfig.toml.fixture'), 'hash', CANONICAL_PAYLOAD);
    const lines = splitLines(written);
    const closeIndex = lines.indexOf(carrierOf('hash').close);
    expect(closeIndex).toBeGreaterThan(0);
    expect(lines[closeIndex + 1]).toBe('');
    expect(lines[closeIndex + 2]).toBe(splitLines(fixtureText('hash/bunfig.toml.fixture'))[0]);
  });
});

describe('the file conventions the writer found are the conventions it leaves', () => {
  it('preserves CRLF endings and introduces no bare line feed', () => {
    const original = fixtureText('cases/crlf.toml.fixture');
    expect(detectEol(original)).toBe(CRLF);
    const written = upsertInto(original, 'hash', CANONICAL_PAYLOAD);
    expect(detectEol(written)).toBe(CRLF);
    expect(countOccurrences(written, LF)).toBe(countOccurrences(written, CRLF));
    expect(valueReadBack(written, 'hash')).toEqual(CANONICAL_PAYLOAD);
  });

  it('preserves a final newline where the file had one', () => {
    const original = fixtureText('block/sweep.ts.fixture');
    expect(hasFinalNewline(original)).toBe(true);
    expect(hasFinalNewline(upsertInto(original, 'block', CANONICAL_PAYLOAD))).toBe(true);
  });

  it('preserves the absence of a final newline where the file had none', () => {
    const original = fixtureText('block/iOSApp.swift.fixture');
    expect(hasFinalNewline(original)).toBe(false);
    expect(hasFinalNewline(upsertInto(original, 'block', CANONICAL_PAYLOAD))).toBe(false);
  });

  it('splits and rejoins every real fixture back to the identical bytes', () => {
    for (const provenance of REAL_FIXTURES) {
      const text = fixtureText(provenance.fixture);
      expect(joinLines(splitLines(text), detectEol(text))).toBe(text);
    }
  });

  it('detects the dominant ending and gives a tie to the line feed', () => {
    expect(detectEol('a\r\nb\r\nc\n')).toBe(CRLF);
    expect(detectEol('a\r\nb\n')).toBe(LF);
    expect(detectEol('a\nb\n')).toBe(LF);
    expect(detectEol('no endings')).toBe(LF);
  });
});

describe('the writer refuses rather than guessing when the file is already wrong', () => {
  it('refuses a file whose block is out of position', () => {
    const failed = failureOf(
      upsertFrontMatter(fixtureText('cases/misplaced.rs.fixture'), 'block', CANONICAL_PAYLOAD),
    );
    expect(failed).toEqual({ _tag: 'MisplacedFrontMatter', line: 5 });
  });

  it('refuses a file carrying two blocks', () => {
    const failed = failureOf(
      upsertFrontMatter(fixtureText('cases/duplicate.sh.fixture'), 'hash', CANONICAL_PAYLOAD),
    );
    expect(failed).toEqual({ _tag: 'DuplicateFrontMatter', line: 6 });
  });

  it('refuses a file whose block is never closed', () => {
    const failed = failureOf(
      upsertFrontMatter(fixtureText('cases/unterminated.ts.fixture'), 'block', CANONICAL_PAYLOAD),
    );
    expect(failed).toMatchObject({ _tag: 'UnterminatedBlock', carrier: 'block', line: 1 });
  });
});

describe('the rendered payload is canonical, and canonical is what the reader accepts', () => {
  it('emits the registry order whatever order the value was built in', () => {
    const keysOf = (value: FrontMatter): readonly string[] =>
      renderPayloadLines(value).map((line) => line.slice(0, line.indexOf(' =')));
    expect(keysOf(CANONICAL_PAYLOAD)).toEqual(REGISTRY_KEYS);
    expect(keysOf(REVERSED_PAYLOAD)).toEqual(REGISTRY_KEYS);
  });

  it('emits only the fields the value carries, still in registry order', () => {
    expect(renderPayloadLines(SECOND_PAYLOAD)).toEqual(['l = "application"', 'owner = "other_team"']);
    expect(renderPayloadLines({})).toEqual([]);
  });

  it('sorts and dedupes a list, and sorts a table by key', () => {
    expect(canonicalIdentList(['zeta', 'alpha', 'zeta'])).toEqual(['alpha', 'zeta']);
    expect(renderTomlArray(['zeta', 'alpha', 'zeta'])).toBe('["alpha", "zeta"]');
    expect(renderTomlInlineTable({ runbook: 'r', adr: 'a' })).toBe('{ adr = "a", runbook = "r" }');
  });

  it('writes an unsorted value in the one spelling the reader will accept back', () => {
    const written = upsertInto('const value = 1;\n', 'block', REVERSED_PAYLOAD);
    expect(valueReadBack(written, 'block')).toEqual(CANONICAL_PAYLOAD);
  });

  it('escapes the characters that would otherwise break the TOML string or the line', () => {
    expect(escapeTomlBasicString('a"b\\c')).toBe('a\\"b\\\\c');
    expect(escapeTomlBasicString('a\nb\tc\rd')).toBe('a\\nb\\tc\\rd');
    expect(renderTomlString('a"b')).toBe('"a\\"b"');
    expect(renderTomlValue('plain')).toBe('"plain"');
    expect(renderTomlValue(['b', 'a'])).toBe('["a", "b"]');
    expect(renderTomlValue({ b: '2', a: '1' })).toBe('{ a = "1", b = "2" }');
  });

  it('never emits a payload line that reopens or closes the carrier comment', () => {
    for (const carrierName of CARRIER_NAMES) {
      const carrier = carrierOf(carrierName);
      const lines = renderFrontMatterLines(CANONICAL_PAYLOAD, carrierName);
      expect(lines[0]).toBe(carrier.open);
      expect(lines[lines.length - 1]).toBe(carrier.close);
      for (const line of lines.slice(1, -1)) {
        expect(line.trim()).not.toBe(carrier.open);
        expect(line.trim()).not.toBe(carrier.close);
      }
    }
  });

  it('prefixes every payload line for the carriers that need one, and none for the rest', () => {
    for (const carrierName of CARRIER_NAMES) {
      const carrier = carrierOf(carrierName);
      const body = renderFrontMatterLines(CANONICAL_PAYLOAD, carrierName).slice(1, -1);
      expect(body.length).toBe(FIELD_REGISTRY.length);
      for (const line of body) expect(line.startsWith(carrier.linePrefix)).toBe(true);
    }
  });

  it('joins the rendered block with the line ending it was handed', () => {
    expect(renderFrontMatter(SECOND_PAYLOAD, 'hash', CRLF)).toBe(
      '# ---uv\r\n# l = "application"\r\n# owner = "other_team"\r\n# ---',
    );
    expect(renderFrontMatter(SECOND_PAYLOAD, 'hash', LF).includes(CRLF)).toBe(false);
  });
});
