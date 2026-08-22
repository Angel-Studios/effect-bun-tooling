import { describe, expect, it } from 'bun:test';
import * as Result from 'effect/Result';
import { CARRIER_NAMES, type CarrierName } from '../src/carrier.ts';
import { parseFrontMatter, parseToml } from '../src/parse.ts';
import type { FrontMatter, FrontMatterFieldValue } from '../src/schema.ts';
import { LF } from '../src/sentinel.ts';
import { renderFrontMatter, renderPayloadLines, renderTomlValue, upsertFrontMatter } from '../src/write.ts';
import { CANONICAL_PAYLOAD, failureOf, successOf } from './support.ts';

const TS_HOST = 'export const value = 1;\nexport const other = 2;\n';

const ESCAPE = String.fromCharCode(27);

const HOSTILE_KEYS: readonly (readonly [string, string])[] = [
  ['a block comment close', 'a*/b'],
  ['a block comment open', 'a/*b'],
  ['an xml comment close', 'a-->b'],
  ['a space, which is not a bare TOML key', 'a b'],
  ['a quote', 'a"b'],
];

const DECODE_ARM_CASES: readonly (readonly [string, string, FrontMatterFieldValue])[] = [
  ['a layer value that is not an ident', 'l', 'Domain'],
  ['an empty ident list', 'tags', []],
  ['a date that is not ISO 8601', 'deprecated', '31-01-2026'],
  ['a link value carrying no scheme', 'links', { adr: 'x.test/a' }],
  ['a link key that is not an ident', 'links', { ADR: 'https://x.test/a' }],
];

const valueOf = (key: string, field: FrontMatterFieldValue): FrontMatter =>
  ({ [key]: field }) as unknown as FrontMatter;

const rawPayloadOf = (key: string, field: FrontMatterFieldValue): string =>
  `${key} = ${renderTomlValue(field)}`;

const refusesRender = (value: FrontMatter, carrierName: CarrierName): boolean =>
  Result.isFailure(renderFrontMatter(value, carrierName, LF));

const refusalTagOf = (value: FrontMatter, carrierName: CarrierName = 'block'): string => {
  const written = upsertFrontMatter(TS_HOST, carrierName, value);
  return Result.isFailure(written) ? written.failure._tag : `wrote ${JSON.stringify(written.success)}`;
};

describe('the write path refuses a value it cannot render, rather than emitting it', () => {
  for (const [label, key] of HOSTILE_KEYS) {
    it(`refuses a links key carrying ${label}`, () => {
      const value: FrontMatter = { links: { [key]: 'https://x.test/ok' } };
      expect(`${key}: ${refusalTagOf(value)}`).toBe(`${key}: PayloadNotRenderable`);
    });
  }

  it('refuses a links value carrying a control character its own reader would refuse', () => {
    const value: FrontMatter = { links: { adr: `https://x.test/${ESCAPE}y` } };
    expect(refusalTagOf(value)).toBe('PayloadNotRenderable');
  });

  it('refuses a field the registry does not declare rather than dropping it silently', () => {
    const value = { l: 'domain', exports: 'parseFrontMatter' } as unknown as FrontMatter;
    expect(refusalTagOf(value)).toBe('UnregisteredField');
  });

  it('names the offending keys when it refuses an unregistered field', () => {
    const value = { l: 'domain', exports: 'x', loc: 'y' } as unknown as FrontMatter;
    const failed = failureOf(upsertFrontMatter(TS_HOST, 'block', value));
    expect(failed).toEqual({ _tag: 'UnregisteredField', keys: ['exports', 'loc'] });
  });
});

describe('a value that renders as valid TOML but fails field validation is refused by the decode arm', () => {
  for (const [label, key, field] of DECODE_ARM_CASES) {
    it(`refuses ${label}`, () => {
      expect(`${label}: ${refusalTagOf(valueOf(key, field))}`).toBe(`${label}: PayloadNotRenderable`);
    });
  }

  it('proves each of them clears the TOML parse arm, so the DECODE arm is what refuses them', () => {
    for (const [label, key, field] of DECODE_ARM_CASES) {
      const parsed = parseToml(rawPayloadOf(key, field));
      expect(`${label}: parses as TOML ${Result.isSuccess(parsed)}`).toBe(`${label}: parses as TOML true`);
    }
  });

  it('separates the two arms: a hostile KEY fails the parse arm, a bad VALUE fails the decode arm', () => {
    const hostileKey = parseToml(rawPayloadOf('links', { 'a*/b': 'https://x.test/ok' }));
    const badValue = parseToml(rawPayloadOf('l', 'Domain'));
    expect(Result.isFailure(hostileKey)).toBe(true);
    expect(Result.isSuccess(badValue)).toBe(true);
  });
});

describe('the refusal is a property of the renderer, not of one carrier or one helper', () => {
  for (const carrierName of CARRIER_NAMES) {
    it(`refuses the same hostile key under the ${carrierName} carrier`, () => {
      const value: FrontMatter = { links: { 'a*/b': 'https://x.test/ok' } };
      expect(refusesRender(value, carrierName)).toBe(true);
    });
  }

  it('renders a legitimate value through the same total signature', () => {
    for (const carrierName of CARRIER_NAMES) {
      const rendered = successOf(renderFrontMatter(CANONICAL_PAYLOAD, carrierName, LF));
      const outcome = successOf(parseFrontMatter(rendered, carrierName));
      expect(outcome._tag).toBe('FrontMatter');
    }
  });
});

describe('the writer never emits a payload its own reader refuses', () => {
  it('refuses an empty value rather than writing a block the reader calls EmptyPayload', () => {
    expect(refusalTagOf({})).toBe('PayloadNotRenderable');
    for (const carrierName of CARRIER_NAMES) {
      expect(refusesRender({}, carrierName)).toBe(true);
    }
  });

  it('still renders zero payload lines for an empty value, which is not the same thing', () => {
    const lines = successOf(renderPayloadLines({}));
    expect(lines).toEqual([]);
  });

  it('reads back everything it agrees to write, on every carrier', () => {
    for (const carrierName of CARRIER_NAMES) {
      const written = successOf(upsertFrontMatter(TS_HOST, carrierName, CANONICAL_PAYLOAD));
      const outcome = successOf(parseFrontMatter(written, carrierName));
      expect(outcome).toMatchObject({ _tag: 'FrontMatter', value: CANONICAL_PAYLOAD });
    }
  });
});
