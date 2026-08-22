import { describe, expect, it } from 'bun:test';
import * as Result from 'effect/Result';
import { REGISTRY_KEYS } from '../src/registry.ts';
import {
  decodeVocabulary,
  EMPTY_VOCABULARY,
  GRADING_FINDING_TAGS,
  gradeFrontMatter,
  VOCABULARY_FIELDS,
  VOCABULARY_SOURCE_OF,
  type Vocabulary,
  VocabularySchema,
} from '../src/vocabulary.ts';
import { CANONICAL_PAYLOAD, failureOf, successOf } from './support.ts';

const FULL_CLAIM = { l: 'domain', p: 'aggregate_root', subdomain: 'core', tier: 'tier_one' } as const;

const DECLARED_VOCABULARY: Vocabulary = {
  layer: ['domain'],
  pattern: ['aggregate_root'],
  subdomain: ['core'],
  tier: ['tier_one'],
};

const vocabularyOf = (input: unknown): Vocabulary => successOf(decodeVocabulary(input));

const acceptsVocabulary = (input: unknown): boolean => Result.isSuccess(decodeVocabulary(input));

const LAYER_ONLY_VOCABULARY: Vocabulary = {
  layer: ['domain'],
  pattern: [],
  subdomain: [],
  tier: [],
};

describe('the package ships the vocabulary type and zero members', () => {
  it('pins the field-to-source map by content, so a rewired field cannot pass unnoticed', () => {
    expect(VOCABULARY_SOURCE_OF).toEqual({
      l: 'layer',
      p: 'pattern',
      subdomain: 'subdomain',
      tier: 'tier',
    });
  });

  it('declares an empty member list for every vocabulary source', () => {
    for (const field of VOCABULARY_FIELDS) {
      const source = VOCABULARY_SOURCE_OF[field];
      expect(VocabularySchema.fields).toHaveProperty(source);
      expect(EMPTY_VOCABULARY[source]).toEqual([]);
    }
    expect(Object.keys(EMPTY_VOCABULARY)).toEqual(Object.keys(VocabularySchema.fields));
  });

  it('grades only the fields it claims to grade, and each is a real registry field', () => {
    expect(VOCABULARY_FIELDS).toEqual(['l', 'p', 'subdomain', 'tier']);
    for (const field of VOCABULARY_FIELDS) {
      expect(REGISTRY_KEYS).toContain(field);
      expect(Object.keys(EMPTY_VOCABULARY)).toContain(VOCABULARY_SOURCE_OF[field]);
    }
  });
});

describe('an ungraded claim is reported, never silently passed', () => {
  it('reports one undeclared finding per claimed field when the vocabulary is empty', () => {
    const findings = gradeFrontMatter(FULL_CLAIM, EMPTY_VOCABULARY);
    expect(findings.length).toBe(VOCABULARY_FIELDS.length);
    expect(findings.map((finding) => finding._tag)).toEqual(
      VOCABULARY_FIELDS.map(() => 'VocabularyUndeclared'),
    );
    expect(findings.map((finding) => finding.field)).toEqual([...VOCABULARY_FIELDS]);
  });

  it('carries the claimed value into the finding, so the report names what went ungraded', () => {
    expect(gradeFrontMatter({ l: 'domain' }, EMPTY_VOCABULARY)).toEqual([
      { _tag: 'VocabularyUndeclared', field: 'l', value: 'domain' },
    ]);
  });

  it('reports a field whose own list is empty even when a sibling list is declared', () => {
    const findings = gradeFrontMatter(FULL_CLAIM, LAYER_ONLY_VOCABULARY);
    expect(findings.map((finding) => `${finding._tag}:${finding.field}`)).toEqual([
      'VocabularyUndeclared:p',
      'VocabularyUndeclared:subdomain',
      'VocabularyUndeclared:tier',
    ]);
  });

  it('grades the canonical payload as fully ungraded against the shipped empty vocabulary', () => {
    const findings = gradeFrontMatter(CANONICAL_PAYLOAD, EMPTY_VOCABULARY);
    expect(findings.length).toBe(VOCABULARY_FIELDS.length);
    expect(new Set(findings.map((finding) => finding._tag))).toEqual(new Set(['VocabularyUndeclared']));
  });
});

describe('a claim outside a declared vocabulary is reported with what was declared', () => {
  it('names the field, the rejected value and the declared members', () => {
    expect(gradeFrontMatter({ l: 'ui' }, DECLARED_VOCABULARY)).toEqual([
      { _tag: 'OutsideVocabulary', field: 'l', value: 'ui', declared: ['domain'] },
    ]);
  });

  it('passes a claim that is inside the declared vocabulary', () => {
    expect(gradeFrontMatter(FULL_CLAIM, DECLARED_VOCABULARY)).toEqual([]);
  });

  it('reports every field that falls outside its own list', () => {
    const findings = gradeFrontMatter({ l: 'ui', p: 'widget' }, DECLARED_VOCABULARY);
    expect(findings.map((finding) => finding.field)).toEqual(['l', 'p']);
    expect(new Set(findings.map((finding) => finding._tag))).toEqual(new Set(['OutsideVocabulary']));
  });
});

describe('grading is a second, explicit call over the fields it names', () => {
  it('says nothing about a payload that claims no vocabulary field', () => {
    expect(gradeFrontMatter({ owner: 'platform_tooling', tags: ['alpha'] }, EMPTY_VOCABULARY)).toEqual([]);
    expect(gradeFrontMatter({}, DECLARED_VOCABULARY)).toEqual([]);
  });

  it('declares exactly the two finding tags it can produce', () => {
    expect(GRADING_FINDING_TAGS).toEqual(['OutsideVocabulary', 'VocabularyUndeclared']);
    const produced = new Set([
      ...gradeFrontMatter({ l: 'ui' }, DECLARED_VOCABULARY).map((finding) => finding._tag),
      ...gradeFrontMatter({ l: 'ui' }, EMPTY_VOCABULARY).map((finding) => finding._tag),
    ]);
    expect(produced).toEqual(new Set(GRADING_FINDING_TAGS));
  });
});

describe('the vocabulary arrives as decoded data, never as a second copy of someone else truth', () => {
  it('decodes a well-formed vocabulary', () => {
    expect(vocabularyOf(DECLARED_VOCABULARY)).toEqual(DECLARED_VOCABULARY);
    expect(vocabularyOf(EMPTY_VOCABULARY)).toEqual(EMPTY_VOCABULARY);
  });

  it('refuses an unknown key rather than absorbing it', () => {
    const failed = failureOf(decodeVocabulary({ ...EMPTY_VOCABULARY, zzz: [] }));
    expect(failed._tag).toBe('VocabularyDecode');
    expect(failed.message).toContain('zzz');
  });

  it('refuses a missing source and a mistyped source', () => {
    expect(acceptsVocabulary({ layer: [] })).toBe(false);
    expect(acceptsVocabulary({ ...EMPTY_VOCABULARY, tier: 'tier_one' })).toBe(false);
    expect(acceptsVocabulary(null)).toBe(false);
  });
});
