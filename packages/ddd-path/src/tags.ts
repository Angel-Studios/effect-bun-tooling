import { Data, Effect, Schema } from 'effect';
import { SUBDOMAINS } from './grammar.ts';

export type TagToken =
  | { readonly _tag: 'Bare'; readonly name: string }
  | { readonly _tag: 'KeyValue'; readonly key: string; readonly value: string };

export type TagSet = {
  readonly keyed: ReadonlyMap<string, string>;
  readonly bare: ReadonlySet<string>;
};

export type ShadowedKey = {
  readonly key: string;
  readonly shadowedIndex: number;
  readonly shadowedValue: string;
  readonly winningIndex: number;
  readonly winningValue: string;
};

export const TAG_TOKEN: RegExp = /^[a-z0-9]+(_[a-z0-9]+)*$/;

export const TAG_COMPONENT: RegExp = /^[a-z0-9]+$/;

const RESERVED_KEY_MEMBERS: ReadonlyMap<string, ReadonlySet<string>> = new Map<string, ReadonlySet<string>>([
  ['subdomain', new Set<string>(SUBDOMAINS)],
]);

export const RESERVED_TAG_KEYS: ReadonlySet<string> = new Set<string>(RESERVED_KEY_MEMBERS.keys());

export const emptyTagSet: TagSet = { keyed: new Map<string, string>(), bare: new Set<string>() };

export const TAG_ERROR_REASONS = ['malformed_token', 'reserved_key_violation'] as const;
export const TagErrorReason = Schema.Literals(TAG_ERROR_REASONS);
export type TagErrorReason = typeof TagErrorReason.Type;

export class TagError extends Data.TaggedError('TagError')<{
  readonly reason: TagErrorReason;
  readonly token: string;
  readonly detail: string;
}> {}

export const parseTagToken = (token: string): TagToken => {
  const split = token.indexOf('_');
  if (split === -1) return { _tag: 'Bare', name: token };
  return { _tag: 'KeyValue', key: token.slice(0, split), value: token.slice(split + 1) };
};

const reservedKeyFailure = (token: string, key: string, value: string): TagError | undefined => {
  const members = RESERVED_KEY_MEMBERS.get(key);
  if (members === undefined || members.has(value)) return undefined;
  return new TagError({
    reason: 'reserved_key_violation',
    token,
    detail: `the reserved tag key "${key}" admits only ${[...members].join(', ')}, not "${value}"`,
  });
};

const tagTokenFailure = (token: string): TagError | undefined => {
  const parsed = parseTagToken(token);
  const malformed = new TagError({
    reason: 'malformed_token',
    token,
    detail: `a tag token must match ${String(TAG_TOKEN)}`,
  });
  if (parsed._tag === 'Bare') return TAG_COMPONENT.test(parsed.name) ? undefined : malformed;
  if (!TAG_COMPONENT.test(parsed.key) || !TAG_TOKEN.test(parsed.value)) return malformed;
  return reservedKeyFailure(token, parsed.key, parsed.value);
};

export const validateTagToken = (token: string): Effect.Effect<TagToken, TagError> => {
  const failure = tagTokenFailure(token);
  return failure === undefined ? Effect.succeed(parseTagToken(token)) : Effect.fail(failure);
};

export const tagSetOf = (tokens: readonly string[]): TagSet => {
  const keyed = new Map<string, string>();
  const bare = new Set<string>();
  for (const token of tokens) {
    const parsed = parseTagToken(token);
    if (parsed._tag === 'Bare') bare.add(parsed.name);
    else keyed.set(parsed.key, parsed.value);
  }
  return { keyed, bare };
};

export const inheritTags = (chainOutermostFirst: readonly TagSet[]): TagSet => {
  const keyed = new Map<string, string>();
  const bare = new Set<string>();
  for (const set of chainOutermostFirst) {
    for (const [key, value] of set.keyed) keyed.set(key, value);
    for (const name of set.bare) bare.add(name);
  }
  return { keyed, bare };
};

type Occurrence = { readonly index: number; readonly value: string };

const collect = (
  entries: Iterable<readonly [number, string, string]>,
): ReadonlyMap<string, readonly Occurrence[]> => {
  const occurrences = new Map<string, Occurrence[]>();
  for (const [index, key, value] of entries) {
    const seen = occurrences.get(key);
    if (seen === undefined) occurrences.set(key, [{ index, value }]);
    else seen.push({ index, value });
  }
  return occurrences;
};

const shadowedFrom = (occurrences: ReadonlyMap<string, readonly Occurrence[]>): readonly ShadowedKey[] => {
  const shadowed: ShadowedKey[] = [];
  for (const [key, sites] of occurrences) {
    const winner = sites[sites.length - 1];
    if (winner === undefined || sites.length < 2) continue;
    for (const site of sites.slice(0, -1)) {
      shadowed.push({
        key,
        shadowedIndex: site.index,
        shadowedValue: site.value,
        winningIndex: winner.index,
        winningValue: winner.value,
      });
    }
  }
  return shadowed;
};

const chainEntries = function* (
  chainOutermostFirst: readonly TagSet[],
): Generator<readonly [number, string, string]> {
  for (const [index, set] of chainOutermostFirst.entries()) {
    for (const [key, value] of set.keyed) yield [index, key, value] as const;
  }
};

const tokenEntries = function* (tokens: readonly string[]): Generator<readonly [number, string, string]> {
  for (const [index, token] of tokens.entries()) {
    const parsed = parseTagToken(token);
    if (parsed._tag === 'KeyValue') yield [index, parsed.key, parsed.value] as const;
  }
};

export const shadowedKeys = (chainOutermostFirst: readonly TagSet[]): readonly ShadowedKey[] =>
  shadowedFrom(collect(chainEntries(chainOutermostFirst)));

export const shadowedTokenKeys = (tokens: readonly string[]): readonly ShadowedKey[] =>
  shadowedFrom(collect(tokenEntries(tokens)));

export type DecodedTagSet = {
  readonly tags: TagSet;
  readonly shadowed: readonly ShadowedKey[];
};

export const decodeTagSet = (tokens: readonly string[]): Effect.Effect<DecodedTagSet, TagError> => {
  for (const token of tokens) {
    const failure = tagTokenFailure(token);
    if (failure !== undefined) return Effect.fail(failure);
  }
  return Effect.succeed({ tags: tagSetOf(tokens), shadowed: shadowedTokenKeys(tokens) });
};
