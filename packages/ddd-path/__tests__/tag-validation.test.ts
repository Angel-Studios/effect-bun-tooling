import { describe, expect, it } from 'bun:test';
import { Effect, Result } from 'effect';
import type { DecodedTagSet, TagSet } from '../src/tags';
import {
  decodeTagSet,
  parseTagToken,
  RESERVED_TAG_KEYS,
  shadowedKeys,
  shadowedTokenKeys,
  TAG_ERROR_REASONS,
  TAG_TOKEN,
  tagSetOf,
  validateTagToken,
} from '../src/tags';

const MALFORMED_TOKENS = ['Owner_Platform Team!', '_leading', 'trailing_', 'a__b', ''];

const validationReason = (token: string): string | undefined => {
  const outcome = Effect.runSync(Effect.result(validateTagToken(token)));
  return Result.isFailure(outcome) ? String(outcome.failure.reason) : undefined;
};

const validationDetail = (token: string): { readonly token: string; readonly detail: string } => {
  const outcome = Effect.runSync(Effect.result(validateTagToken(token)));
  return Result.isFailure(outcome)
    ? { token: String(outcome.failure.token), detail: String(outcome.failure.detail) }
    : { token: 'ACCEPTED', detail: 'ACCEPTED' };
};

const decoded = (tokens: readonly string[]): DecodedTagSet | undefined => {
  const outcome = Effect.runSync(Effect.result(decodeTagSet(tokens)));
  return Result.isSuccess(outcome) ? outcome.success : undefined;
};

const decodeReason = (tokens: readonly string[]): string | undefined => {
  const outcome = Effect.runSync(Effect.result(decodeTagSet(tokens)));
  return Result.isFailure(outcome) ? String(outcome.failure.reason) : undefined;
};

const normalize = (
  set: TagSet,
): { readonly keyed: readonly (readonly [string, string])[]; readonly bare: readonly string[] } => ({
  keyed: [...set.keyed.entries()].sort((left, right) => left[0].localeCompare(right[0])),
  bare: [...set.bare].sort(),
});

describe('validateTagToken — the declared tag form is now ENFORCED, not merely exported', () => {
  it('exposes TAG_TOKEN as the NON-global normative form the reference section 8 states', () => {
    expect({ source: TAG_TOKEN.source, global: TAG_TOKEN.global }).toEqual({
      source: '^[a-z0-9]+(_[a-z0-9]+)*$',
      global: false,
    });
  });

  it('pins TAG_ERROR_REASONS to exactly the two reasons the surface declares', () => {
    expect([...TAG_ERROR_REASONS]).toEqual(['malformed_token', 'reserved_key_violation']);
  });

  for (const token of MALFORMED_TOKENS) {
    it(`refuses the malformed token ${JSON.stringify(token)} rather than parsing it silently`, () => {
      expect({ token, reason: validationReason(token) }).toEqual({ token, reason: 'malformed_token' });
    });
  }

  it('refuses every malformed token in one sweep, so a partial charset check reddens', () => {
    const accepted = MALFORMED_TOKENS.filter((token) => validationReason(token) === undefined);
    expect({ candidates: MALFORMED_TOKENS.length, accepted }).toEqual({ candidates: 5, accepted: [] });
  });

  it('eliminates the case-collision class for tag keys the way section 1 does for path values', () => {
    expect({
      shouted: validationReason('Owner_platform'),
      lowercase: validationReason('owner_platform'),
    }).toEqual({ shouted: 'malformed_token', lowercase: undefined });
  });

  it('names the offending token and a non-empty detail, so a refusal is actionable', () => {
    const failure = validationDetail('_leading');
    expect({ token: failure.token, detailIsNonEmpty: failure.detail.length > 0 }).toEqual({
      token: '_leading',
      detailIsNonEmpty: true,
    });
  });

  it('accepts a legal token and returns the parsed TagToken, so validation is not a bare predicate', () => {
    expect(Effect.runSync(validateTagToken('owner_platform_team'))).toEqual({
      _tag: 'KeyValue',
      key: 'owner',
      value: 'platform_team',
    });
  });

  it('accepts a legal bare token', () => {
    expect(Effect.runSync(validateTagToken('pii'))).toEqual({ _tag: 'Bare', name: 'pii' });
  });
});

describe('the reserved key is SCHEMA-CHECKED, closing the section 8 declared-but-unenforced gap', () => {
  it('reserves exactly the one key the reference declares', () => {
    expect([...RESERVED_TAG_KEYS].sort()).toEqual(['subdomain']);
  });

  it('refuses a subdomain value outside the closed Subdomain set', () => {
    expect(validationReason('subdomain_not_a_member')).toBe('reserved_key_violation');
  });

  it('accepts every member of the closed Subdomain set under the reserved key', () => {
    const refused = ['core', 'supporting', 'generic'].filter(
      (member) => validationReason(`subdomain_${member}`) !== undefined,
    );
    expect(refused).toEqual([]);
  });

  it('CONTROL: an UNRESERVED key with the same value shape parses silently, per the open/closed asymmetry', () => {
    expect({
      reserved: validationReason('subdomain_not_a_member'),
      unreserved: validationReason('owner_not_a_member'),
    }).toEqual({ reserved: 'reserved_key_violation', unreserved: undefined });
  });

  it('reaches BOTH declared error reasons, so neither is a literal nothing can produce', () => {
    expect({
      malformed: validationReason('a__b'),
      reserved: validationReason('subdomain_nope'),
    }).toEqual({ malformed: 'malformed_token', reserved: 'reserved_key_violation' });
  });
});

describe('CONTROL: parseTagToken and tagSetOf stay TOTAL and permissive, so both entry points remain', () => {
  it('still parses every malformed token without throwing, since validation is a separate decision', () => {
    const thrown = MALFORMED_TOKENS.filter((token) => {
      try {
        parseTagToken(token);
        return false;
      } catch {
        return true;
      }
    });
    expect({ candidates: MALFORMED_TOKENS.length, thrown }).toEqual({ candidates: 5, thrown: [] });
  });

  it('still splits a shouted token on the first underscore, unchanged by the new refusal', () => {
    expect(parseTagToken('Owner_Platform Team!')).toEqual({
      _tag: 'KeyValue',
      key: 'Owner',
      value: 'Platform Team!',
    });
  });

  it('still builds a TagSet from an unvalidated token list', () => {
    expect(normalize(tagSetOf(['subdomain_not_a_member']))).toEqual({
      keyed: [['subdomain', 'not_a_member']],
      bare: [],
    });
  });
});

describe('decodeTagSet reports INTRA-NODE shadowing, which shadowedKeys structurally cannot see', () => {
  it('reports the collision inside one node own tag list', () => {
    expect(decoded(['tier_one', 'tier_two'])?.shadowed).toEqual([
      {
        key: 'tier',
        shadowedIndex: 0,
        shadowedValue: 'one',
        winningIndex: 1,
        winningValue: 'two',
      },
    ]);
  });

  it('still resolves the collision last-wins, so the finding and the value agree', () => {
    const outcome = decoded(['tier_one', 'tier_two']);
    expect(outcome === undefined ? undefined : normalize(outcome.tags)).toEqual({
      keyed: [['tier', 'two']],
      bare: [],
    });
  });

  it('CONTROL: shadowedKeys over the SAME already-collapsed node reports nothing — the case it misses', () => {
    expect(shadowedKeys([tagSetOf(['tier_one', 'tier_two'])])).toEqual([]);
  });

  it('exposes the token-list entry point directly, so a caller need not decode to see the shadowing', () => {
    expect(shadowedTokenKeys(['tier_one', 'tier_two'])).toEqual([
      {
        key: 'tier',
        shadowedIndex: 0,
        shadowedValue: 'one',
        winningIndex: 1,
        winningValue: 'two',
      },
    ]);
  });

  it('agrees with decodeTagSet on the same token list, so the two entry points are one truth', () => {
    const viaDecode = decoded(['tier_one', 'tier_two', 'tier_three'])?.shadowed ?? [];
    expect({
      decodeSucceeded: viaDecode.length > 0,
      direct: shadowedTokenKeys(['tier_one', 'tier_two', 'tier_three']),
    }).toEqual({ decodeSucceeded: true, direct: viaDecode });
  });

  it('reports one entry per shadowed occurrence when a key is set three times in one node', () => {
    expect(decoded(['tier_one', 'tier_two', 'tier_three'])?.shadowed).toEqual([
      {
        key: 'tier',
        shadowedIndex: 0,
        shadowedValue: 'one',
        winningIndex: 2,
        winningValue: 'three',
      },
      {
        key: 'tier',
        shadowedIndex: 1,
        shadowedValue: 'two',
        winningIndex: 2,
        winningValue: 'three',
      },
    ]);
  });

  it('reports NOTHING for a clean token list, so the finding is not noise', () => {
    expect(decoded(['tier_one', 'pii', 'owner_platform'])?.shadowed).toEqual([]);
  });

  it('never lets bare tags collide, even repeated in one node', () => {
    const outcome = decoded(['pii', 'pii']);
    expect({
      shadowed: outcome?.shadowed,
      bare: outcome === undefined ? undefined : normalize(outcome.tags).bare,
    }).toEqual({ shadowed: [], bare: ['pii'] });
  });

  it('refuses a malformed token BEFORE reporting any shadowing, so a bad list never decodes half-way', () => {
    expect({
      reason: decodeReason(['tier_one', 'a__b', 'tier_two']),
      decoded: decoded(['tier_one', 'a__b', 'tier_two']),
    }).toEqual({ reason: 'malformed_token', decoded: undefined });
  });

  it('decodes an empty token list to an empty set with no findings', () => {
    const outcome = decoded([]);
    expect({
      shadowed: outcome?.shadowed,
      tags: outcome === undefined ? undefined : normalize(outcome.tags),
    }).toEqual({ shadowed: [], tags: { keyed: [], bare: [] } });
  });
});
