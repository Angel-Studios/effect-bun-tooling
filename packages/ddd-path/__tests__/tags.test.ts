import { describe, expect, it } from 'bun:test';
import type { ShadowedKey, TagSet } from '../src/tags';
import {
  emptyTagSet,
  inheritTags,
  parseTagToken,
  RESERVED_TAG_KEYS,
  shadowedKeys,
  tagSetOf,
} from '../src/tags';

const normalize = (
  set: TagSet,
): { readonly keyed: readonly (readonly [string, string])[]; readonly bare: readonly string[] } => ({
  keyed: [...set.keyed.entries()].sort((left, right) => left[0].localeCompare(right[0])),
  bare: [...set.bare].sort(),
});

const permutations = <A>(items: readonly A[]): readonly (readonly A[])[] => {
  if (items.length <= 1) return [items];
  const output: (readonly A[])[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const head = items[index];
    if (head === undefined) continue;
    const rest = [...items.slice(0, index), ...items.slice(index + 1)];
    for (const tail of permutations(rest)) output.push([head, ...tail]);
  }
  return output;
};

describe('tag form — split on the FIRST underscore', () => {
  it('reads owner_platform_team as key owner and value platform_team, not as three components', () => {
    expect(parseTagToken('owner_platform_team')).toEqual({
      _tag: 'KeyValue',
      key: 'owner',
      value: 'platform_team',
    });
  });

  it('reads a token with NO underscore as a Bare tag', () => {
    expect(parseTagToken('pii')).toEqual({ _tag: 'Bare', name: 'pii' });
  });

  it('keeps keys single-token and values free, so a multi-word value never becomes a nested key', () => {
    expect([
      parseTagToken('tier_gold'),
      parseTagToken('stability_experimental_preview'),
      parseTagToken('subdomain_generic'),
    ]).toEqual([
      { _tag: 'KeyValue', key: 'tier', value: 'gold' },
      { _tag: 'KeyValue', key: 'stability', value: 'experimental_preview' },
      { _tag: 'KeyValue', key: 'subdomain', value: 'generic' },
    ]);
  });

  it('parses an unknown tag key SILENTLY, because position decides open versus closed', () => {
    expect(parseTagToken('nobody_declared_this')).toEqual({
      _tag: 'KeyValue',
      key: 'nobody',
      value: 'declared_this',
    });
  });

  it('reserves exactly the one schema-checked key the reference declares', () => {
    expect([...RESERVED_TAG_KEYS].sort()).toEqual(['subdomain']);
  });
});

describe('tagSetOf and emptyTagSet', () => {
  it('splits a token list into keyed entries and bare names', () => {
    expect(normalize(tagSetOf(['owner_platform_team', 'pii', 'tier_gold', 'deprecated']))).toEqual({
      keyed: [
        ['owner', 'platform_team'],
        ['tier', 'gold'],
      ],
      bare: ['deprecated', 'pii'],
    });
  });

  it('carries neither a keyed entry nor a bare name in emptyTagSet', () => {
    expect(normalize(emptyTagSet)).toEqual({ keyed: [], bare: [] });
  });

  it('builds an empty set from an empty token list', () => {
    expect(normalize(tagSetOf([]))).toEqual({ keyed: [], bare: [] });
  });
});

describe('inheritTags — a set union, therefore order-independent by construction', () => {
  const COLLISION_FREE_CHAIN = [
    tagSetOf(['owner_platform_team']),
    tagSetOf(['tier_gold', 'pii']),
    tagSetOf(['stability_experimental']),
  ];

  it('produces the SAME TagSet under every permutation of a collision-free chain', () => {
    const expected = normalize(inheritTags(COLLISION_FREE_CHAIN));
    const results = permutations(COLLISION_FREE_CHAIN).map((chain) => normalize(inheritTags(chain)));
    const divergent = results.filter((result) => JSON.stringify(result) !== JSON.stringify(expected));
    expect({ permutations: results.length, divergent }).toEqual({ permutations: 6, divergent: [] });
  });

  it('unions the whole chain rather than taking only the deepest node', () => {
    expect(normalize(inheritTags(COLLISION_FREE_CHAIN))).toEqual({
      keyed: [
        ['owner', 'platform_team'],
        ['stability', 'experimental'],
        ['tier', 'gold'],
      ],
      bare: ['pii'],
    });
  });

  it('returns an empty set for an empty chain', () => {
    expect(normalize(inheritTags([]))).toEqual({ keyed: [], bare: [] });
  });

  it('lets the DEEPEST entry win on a key collision — override semantics, not first-wins', () => {
    const chain = [
      tagSetOf(['owner_platform_team']),
      tagSetOf(['owner_payments_team']),
      tagSetOf(['owner_billing_team']),
    ];
    expect(normalize(inheritTags(chain))).toEqual({ keyed: [['owner', 'billing_team']], bare: [] });
  });

  it('never lets bare tags collide — they union rather than override', () => {
    const chain = [tagSetOf(['pii', 'audited']), tagSetOf(['pii']), tagSetOf(['deprecated'])];
    expect(normalize(inheritTags(chain))).toEqual({
      keyed: [],
      bare: ['audited', 'deprecated', 'pii'],
    });
  });
});

describe('shadowedKeys — the tag-shadowed INFO finding names both sites by chain index', () => {
  const SHADOWING_CHAIN = [
    tagSetOf(['owner_platform_team', 'pii']),
    tagSetOf(['tier_gold']),
    tagSetOf(['owner_payments_team']),
  ];

  const byOccurrence = (entries: readonly ShadowedKey[]): readonly ShadowedKey[] =>
    [...entries].sort((left, right) =>
      left.key === right.key ? left.shadowedIndex - right.shadowedIndex : left.key.localeCompare(right.key),
    );

  it('reports the colliding key ONCE with every field reference section 11 declares, named', () => {
    expect(shadowedKeys(SHADOWING_CHAIN)).toEqual([
      {
        key: 'owner',
        shadowedIndex: 0,
        shadowedValue: 'platform_team',
        winningIndex: 2,
        winningValue: 'payments_team',
      },
    ]);
  });

  it('names an index into the outermost-first chain, the only site identifier a pure function has', () => {
    const [entry] = shadowedKeys(SHADOWING_CHAIN);
    expect({
      found: entry !== undefined,
      shadowedIndex: entry?.shadowedIndex,
      winningIndex: entry?.winningIndex,
    }).toEqual({ found: true, shadowedIndex: 0, winningIndex: 2 });
  });

  it('yields TWO entries for a key set at THREE depths — one per shadowed occurrence', () => {
    const chain = [
      tagSetOf(['owner_platform_team']),
      tagSetOf(['owner_payments_team']),
      tagSetOf(['owner_billing_team']),
    ];
    expect(byOccurrence(shadowedKeys(chain))).toEqual([
      {
        key: 'owner',
        shadowedIndex: 0,
        shadowedValue: 'platform_team',
        winningIndex: 2,
        winningValue: 'billing_team',
      },
      {
        key: 'owner',
        shadowedIndex: 1,
        shadowedValue: 'payments_team',
        winningIndex: 2,
        winningValue: 'billing_team',
      },
    ]);
  });

  it('agrees with inheritTags on the winner, so the finding and the result cannot drift', () => {
    const chain = [
      tagSetOf(['owner_platform_team']),
      tagSetOf(['owner_payments_team']),
      tagSetOf(['owner_billing_team']),
    ];
    const winners = new Set(shadowedKeys(chain).map((entry) => entry.winningValue));
    expect({ winners: [...winners], inherited: inheritTags(chain).keyed.get('owner') }).toEqual({
      winners: ['billing_team'],
      inherited: 'billing_team',
    });
  });

  it('reports NOTHING for a chain with no key collision, so the finding is not noise', () => {
    expect(shadowedKeys([tagSetOf(['owner_platform_team']), tagSetOf(['tier_gold', 'pii'])])).toEqual([]);
  });

  it('reports nothing for a bare-tag repeat, because bare tags never collide', () => {
    expect(shadowedKeys([tagSetOf(['pii']), tagSetOf(['pii'])])).toEqual([]);
  });

  it('reports every colliding key when a chain shadows more than one', () => {
    const chain = [
      tagSetOf(['owner_platform_team', 'tier_gold']),
      tagSetOf(['owner_payments_team', 'tier_silver']),
    ];
    expect(byOccurrence(shadowedKeys(chain))).toEqual([
      {
        key: 'owner',
        shadowedIndex: 0,
        shadowedValue: 'platform_team',
        winningIndex: 1,
        winningValue: 'payments_team',
      },
      {
        key: 'tier',
        shadowedIndex: 0,
        shadowedValue: 'gold',
        winningIndex: 1,
        winningValue: 'silver',
      },
    ]);
  });

  it('reports nothing for an empty chain', () => {
    expect(shadowedKeys([])).toEqual([]);
  });
});
