import { describe, expect, it } from 'bun:test';
import * as Result from 'effect/Result';
import type { CarrierName } from '../src/carrier.ts';
import type { FrontMatterError } from '../src/errors.ts';
import { decodePayload, messageOfThrown, parseFrontMatter, parseToml } from '../src/parse.ts';
import { FIELD_REGISTRY } from '../src/registry.ts';
import {
  DATE_PATTERN,
  decodeFrontMatter,
  FRONT_MATTER_FIELD_KEYS,
  FRONT_MATTER_PARSE_OPTIONS,
  type FrontMatter,
  FrontMatterSchema,
  frontMatterEntries,
  IDENT_PATTERN,
  isCanonicalIdentList,
  isIdent,
  isIsoDate,
  isStringArray,
  isUri,
  URI_PATTERN,
} from '../src/schema.ts';
import { CASE_FIXTURES } from './fixtures/provenance.ts';
import { failureOf, fixtureText, successOf, threwOf } from './support.ts';

const NON_OBJECT_INPUTS: readonly unknown[] = [null, undefined, 5, 'x', [], true, Symbol.iterator];

const messageOf = (input: unknown): string => {
  const failed = failureOf(decodeFrontMatter(input));
  return failed.message;
};

const accepts = (input: unknown): boolean => Result.isSuccess(decodeFrontMatter(input));

const decodedValue = (input: unknown): FrontMatter => successOf(decodeFrontMatter(input));

const tomlOf = (payload: string): object => successOf(parseToml(payload));

const tomlRefusalOf = (payload: string): string => failureOf(parseToml(payload));

const payloadValueOf = (payload: string, carrier: CarrierName, line: number): FrontMatter =>
  successOf(decodePayload(payload, carrier, line));

const payloadRefusalOf = (payload: string, carrier: CarrierName, line: number): FrontMatterError =>
  failureOf(decodePayload(payload, carrier, line));

describe('decoding is total: a Result, never a throw', () => {
  it('returns a failure Result rather than throwing for any non-payload input', () => {
    for (const input of NON_OBJECT_INPUTS) {
      expect(threwOf(() => decodeFrontMatter(input))).toBe(false);
      expect(accepts(input)).toBe(false);
    }
  });

  it('never throws while parsing any authored loud-path fixture', () => {
    for (const authored of CASE_FIXTURES) {
      const text = fixtureText(authored.fixture);
      expect(threwOf(() => parseFrontMatter(text, authored.carrier))).toBe(false);
    }
  });

  it('converts the throw Bun.TOML raises into a failure carrying the parser message', () => {
    expect(threwOf(() => Bun.TOML.parse('l = = 1'))).toBe(true);
    expect(tomlRefusalOf('l = = 1')).toBe('Unexpected =');
    expect(tomlOf('l = "domain"')).toEqual({ l: 'domain' });
    expect(tomlOf('')).toEqual({});
  });

  it('renders a thrown value as a message whether or not it is an Error', () => {
    expect(messageOfThrown(new Error('boom'))).toBe('boom');
    expect(messageOfThrown('boom')).toBe('boom');
    expect(messageOfThrown({ message: 7 })).toBe('7');
    expect(messageOfThrown(undefined)).toBe('undefined');
  });
});

describe('the payload decodes through Effect Schema into a typed value', () => {
  it('accepts a payload naming every registry field', () => {
    const decoded = successOf(
      decodeFrontMatter({
        l: 'domain',
        p: 'aggregate_root',
        subdomain: 'core',
        tags: ['alpha', 'beta'],
        owner: 'platform_tooling',
        tier: 'tier_one',
        data: ['pci', 'pii'],
        deprecated: '2026-01-31',
        links: { adr: 'https://example.test/adr/0001' },
        review: '2026-08-01',
        oncall: 'platform_oncall',
      }),
    );
    expect(Object.keys(decoded)).toEqual([...FRONT_MATTER_FIELD_KEYS]);
  });

  it('treats every field as optional, so a single-field payload decodes', () => {
    expect(decodedValue({ owner: 'platform_tooling' })).toEqual({
      owner: 'platform_tooling',
    });
  });

  it('derives its exported field-key list from the schema rather than restating it', () => {
    expect(FRONT_MATTER_FIELD_KEYS).toEqual(Object.keys(FrontMatterSchema.fields));
  });
});

describe('unknown keys are refused, and the decode options are what refuses them', () => {
  it('pins the decode options that carry unknown-key refusal', () => {
    expect(FRONT_MATTER_PARSE_OPTIONS).toEqual({ errors: 'all', onExcessProperty: 'error' });
  });

  it('refuses an unknown key through decodeFrontMatter rather than stripping it', () => {
    expect(accepts({ l: 'domain' })).toBe(true);
    expect(accepts({ l: 'domain', zzz: 'anything' })).toBe(false);
    expect(messageOf({ l: 'domain', zzz: 'anything' })).toContain('zzz');
  });

  it('refuses a forbidden derivable key as an excess property rather than accepting it', () => {
    expect(accepts({ l: 'domain', exports: 'parseFrontMatter' })).toBe(false);
  });

  it('reports every violation at once, because errors are collected rather than short-circuited', () => {
    const message = messageOf({ l: 'Bad', review: 'nope' });
    expect(message).toContain('"l"');
    expect(message).toContain('"review"');
  });
});

describe('the links record refuses a bad key rather than dropping it', () => {
  it('keeps a conforming link key, so a drop would be visible as a success', () => {
    expect(decodedValue({ links: { adr: 'https://example.test/adr/1' } })).toEqual({
      links: { adr: 'https://example.test/adr/1' },
    });
  });

  it('refuses a link key outside the identifier charset', () => {
    expect(accepts({ links: { 'Bad-Key': 'https://example.test/' } })).toBe(false);
    expect(messageOf({ links: { 'Bad-Key': 'https://example.test/' } })).toContain('link key');
  });

  it('refuses a link value that carries no URI scheme', () => {
    expect(accepts({ links: { adr: 'not-a-uri' } })).toBe(false);
  });
});

describe('the value shapes are enforced, not repaired', () => {
  it('refuses a scalar outside the identifier charset', () => {
    for (const bad of ['Domain', '1domain', 'do-main', 'do main', '']) {
      expect(accepts({ l: bad })).toBe(false);
    }
    expect(accepts({ l: '_private0' })).toBe(true);
  });

  it('refuses a date that is not written YYYY-MM-DD', () => {
    for (const bad of ['2026-8-1', '26-08-01', 'yesterday']) {
      expect(accepts({ review: bad })).toBe(false);
    }
    expect(accepts({ review: '2026-08-01' })).toBe(true);
  });

  it('refuses an ident list that is unsorted, duplicated or empty', () => {
    expect(accepts({ tags: ['zeta', 'alpha'] })).toBe(false);
    expect(accepts({ tags: ['alpha', 'alpha'] })).toBe(false);
    expect(accepts({ tags: [] })).toBe(false);
    expect(decodedValue({ tags: ['alpha', 'beta'] })).toEqual({ tags: ['alpha', 'beta'] });
  });

  it('refuses a value whose TOML kind disagrees with the kind the registry declares', () => {
    for (const entry of FIELD_REGISTRY) {
      const wrongKind = entry.tomlType === 'string[]' ? 'scalar' : ['alpha'];
      expect(accepts({ [entry.key]: wrongKind })).toBe(false);
      expect(accepts({ [entry.key]: 1 })).toBe(false);
    }
  });
});

describe('the exported predicates agree with the exported patterns', () => {
  it('matches the identifier, date and URI patterns it publishes', () => {
    expect(IDENT_PATTERN.test('aggregate_root')).toBe(isIdent('aggregate_root'));
    expect(DATE_PATTERN.test('2026-01-31')).toBe(isIsoDate('2026-01-31'));
    expect(URI_PATTERN.test('https://example.test/')).toBe(isUri('https://example.test/'));
    expect(isIdent('Aggregate')).toBe(false);
    expect(isIsoDate('2026/01/31')).toBe(false);
    expect(isUri('//example.test/')).toBe(false);
  });

  it('calls a list canonical only when it is non-empty and strictly ascending', () => {
    expect(isCanonicalIdentList(['alpha', 'beta'])).toBe(true);
    expect(isCanonicalIdentList(['beta', 'alpha'])).toBe(false);
    expect(isCanonicalIdentList(['alpha', 'alpha'])).toBe(false);
    expect(isCanonicalIdentList([])).toBe(false);
  });

  it('separates a list value from a table value', () => {
    expect(isStringArray(['alpha'])).toBe(true);
    expect(isStringArray({ adr: 'https://example.test/' })).toBe(false);
  });

  it('lists only the fields a decoded value actually carries', () => {
    expect(frontMatterEntries({ l: 'domain', tags: ['alpha'] })).toEqual([
      ['l', 'domain'],
      ['tags', ['alpha']],
    ]);
    expect(frontMatterEntries({})).toEqual([]);
  });
});

describe('decodePayload turns each decode stage into its own typed error', () => {
  it('names a TOML syntax failure with the carrier and the opening line', () => {
    expect(payloadRefusalOf('l = = 1', 'block', 4)).toEqual({
      _tag: 'TomlSyntax',
      carrier: 'block',
      line: 4,
      message: 'Unexpected =',
    });
  });

  it('names a payload that declares no fields as empty rather than as a decode failure', () => {
    expect(payloadRefusalOf('', 'hash', 2)).toEqual({
      _tag: 'EmptyPayload',
      carrier: 'hash',
      line: 2,
    });
  });

  it('names a field violation as a schema decode failure carrying the rendered message', () => {
    const failed = payloadRefusalOf('l = "Domain"', 'xml', 7);
    expect(failed._tag).toBe('SchemaDecode');
    expect(failed).toMatchObject({ carrier: 'xml', line: 7 });
  });

  it('returns the decoded value when every stage passes', () => {
    expect(payloadValueOf('l = "domain"', 'apostrophe', 1)).toEqual({ l: 'domain' });
  });
});
