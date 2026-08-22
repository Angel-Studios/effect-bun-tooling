import type * as Result from 'effect/Result';
import * as Schema from 'effect/Schema';

export const IDENT_PATTERN = /^[a-z_][a-z0-9_]*$/;

export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const URI_PATTERN = /^[a-z][a-z0-9+.-]*:/;

export const IDENT_EXPECTATION =
  'a lowercase identifier matching ^[a-z_][a-z0-9_]*$, the least-common-denominator charset every carrier and every path segment admits';

export const DATE_EXPECTATION = 'a calendar date written YYYY-MM-DD';

export const URI_EXPECTATION = 'an absolute URI carrying a scheme, matching ^[a-z][a-z0-9+.-]*:';

export const IDENT_LIST_EXPECTATION =
  'a non-empty array of identifiers in strictly ascending lexicographic order, which is the one canonical spelling of the set';

export const LINK_KEY_EXPECTATION = 'every link key to be a lowercase identifier';

export const isIdent = (value: string): value is string => IDENT_PATTERN.test(value);

export const isIsoDate = (value: string): value is string => DATE_PATTERN.test(value);

export const isUri = (value: string): value is string => URI_PATTERN.test(value);

export const isCanonicalIdentList = (value: readonly string[]): value is readonly string[] => {
  if (value.length === 0) return false;
  return value.every((member, index) => index === 0 || value[index - 1] < member);
};

export const hasIdentKeys = (
  value: Readonly<Record<string, string>>,
): value is Readonly<Record<string, string>> => Object.keys(value).every(isIdent);

export const Ident = Schema.String.pipe(Schema.refine(isIdent, { message: IDENT_EXPECTATION }));

export const IsoDate = Schema.String.pipe(Schema.refine(isIsoDate, { message: DATE_EXPECTATION }));

export const Uri = Schema.String.pipe(Schema.refine(isUri, { message: URI_EXPECTATION }));

export const IdentList = Schema.UniqueArray(Ident).pipe(
  Schema.refine(isCanonicalIdentList, { message: IDENT_LIST_EXPECTATION }),
);

export const Links = Schema.Record(Schema.String, Uri).pipe(
  Schema.refine(hasIdentKeys, { message: LINK_KEY_EXPECTATION }),
);

export const FrontMatterSchema = Schema.Struct({
  l: Schema.optionalKey(Ident),
  p: Schema.optionalKey(Ident),
  subdomain: Schema.optionalKey(Ident),
  tags: Schema.optionalKey(IdentList),
  owner: Schema.optionalKey(Ident),
  tier: Schema.optionalKey(Ident),
  data: Schema.optionalKey(IdentList),
  deprecated: Schema.optionalKey(IsoDate),
  links: Schema.optionalKey(Links),
  review: Schema.optionalKey(IsoDate),
  oncall: Schema.optionalKey(Ident),
});

export type FrontMatter = typeof FrontMatterSchema.Type;

export type FrontMatterFieldValue = string | readonly string[] | Readonly<Record<string, string>>;

export const FRONT_MATTER_FIELD_KEYS: readonly string[] = Object.keys(FrontMatterSchema.fields);

export const FRONT_MATTER_PARSE_OPTIONS = {
  errors: 'all',
  onExcessProperty: 'error',
} as const;

export const decodeFrontMatter = (input: unknown): Result.Result<FrontMatter, Schema.SchemaError> =>
  Schema.decodeUnknownResult(FrontMatterSchema, FRONT_MATTER_PARSE_OPTIONS)(input);

export const isStringArray = (
  value: readonly string[] | Readonly<Record<string, string>>,
): value is readonly string[] => Array.isArray(value);

export const frontMatterEntries = (
  value: FrontMatter,
): readonly (readonly [string, FrontMatterFieldValue])[] =>
  Object.entries(value).flatMap((entry) => (entry[1] === undefined ? [] : [[entry[0], entry[1]] as const]));
