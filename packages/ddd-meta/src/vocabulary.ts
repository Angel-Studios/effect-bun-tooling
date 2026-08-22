import * as Result from 'effect/Result';
import * as Schema from 'effect/Schema';
import { type VocabularyDecodeError, vocabularyDecodeError } from './errors.ts';
import type { FrontMatter } from './schema.ts';

export const VOCABULARY_FIELDS = ['l', 'p', 'subdomain', 'tier'] as const;

export type VocabularyField = (typeof VOCABULARY_FIELDS)[number];

const MemberList = Schema.Array(Schema.String);

export const VocabularySchema = Schema.Struct({
  layer: MemberList,
  pattern: MemberList,
  subdomain: MemberList,
  tier: MemberList,
});

export type Vocabulary = typeof VocabularySchema.Type;

export const VOCABULARY_SOURCE_OF: Readonly<Record<VocabularyField, keyof Vocabulary>> = {
  l: 'layer',
  p: 'pattern',
  subdomain: 'subdomain',
  tier: 'tier',
};

export const EMPTY_VOCABULARY: Vocabulary = {
  layer: [],
  pattern: [],
  subdomain: [],
  tier: [],
};

export type OutsideVocabulary = {
  readonly _tag: 'OutsideVocabulary';
  readonly field: VocabularyField;
  readonly value: string;
  readonly declared: readonly string[];
};

export type VocabularyUndeclared = {
  readonly _tag: 'VocabularyUndeclared';
  readonly field: VocabularyField;
  readonly value: string;
};

export type GradingFinding = OutsideVocabulary | VocabularyUndeclared;

export const GRADING_FINDING_TAGS = ['OutsideVocabulary', 'VocabularyUndeclared'] as const;

const gradeField = (
  field: VocabularyField,
  claimed: string | undefined,
  declared: readonly string[],
): readonly GradingFinding[] => {
  if (claimed === undefined) return [];
  if (declared.length === 0) return [{ _tag: 'VocabularyUndeclared', field, value: claimed }];
  return declared.includes(claimed) ? [] : [{ _tag: 'OutsideVocabulary', field, value: claimed, declared }];
};

export const gradeFrontMatter = (value: FrontMatter, vocabulary: Vocabulary): readonly GradingFinding[] => [
  ...gradeField('l', value.l, vocabulary.layer),
  ...gradeField('p', value.p, vocabulary.pattern),
  ...gradeField('subdomain', value.subdomain, vocabulary.subdomain),
  ...gradeField('tier', value.tier, vocabulary.tier),
];

export const decodeVocabulary = (input: unknown): Result.Result<Vocabulary, VocabularyDecodeError> => {
  const decoded = Schema.decodeUnknownResult(VocabularySchema, {
    errors: 'all',
    onExcessProperty: 'error',
  })(input);
  return Result.isFailure(decoded)
    ? Result.fail(vocabularyDecodeError(decoded.failure.message))
    : Result.succeed(decoded.success);
};
