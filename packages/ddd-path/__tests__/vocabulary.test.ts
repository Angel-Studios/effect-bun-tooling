import { describe, expect, it } from 'bun:test';
import { SUPERSEDED_KIND_DESTINATION } from '../src/grammar';
import { VOCABULARY_SETS } from './fixtures/vocabulary';

describe('closed vocabulary sets — the one one-way door the design cannot close', () => {
  it('ships every set named in the reference section 2 table and no others', () => {
    expect(VOCABULARY_SETS.map((set) => set.name)).toEqual([
      'StructuralKind',
      'SupersededKind',
      'Language',
      'Subdomain',
      'DddLayer',
      'TacticalPattern',
      'TestKind',
      'Provenance',
      'AnchorKind',
      'OutsideKind',
      'UngradedReason',
      'MalformedReason',
      'HierarchyRole',
      'RelationshipPattern',
    ]);
  });

  for (const set of VOCABULARY_SETS) {
    describe(set.name, () => {
      it('exports the exact member list, in order, so a rename or removal orphans no persisted fact silently', () => {
        expect([...set.exported]).toEqual([...set.pinned]);
      });

      it('mints no duplicate member', () => {
        expect(new Set(set.exported).size).toBe(set.exported.length);
      });

      it('round-trips every pinned member through its Effect Schema', () => {
        const rejected = set.pinned.filter((member) => !set.accepts(member));
        expect({ set: set.name, rejectedMembers: rejected }).toEqual({
          set: set.name,
          rejectedMembers: [],
        });
      });

      it('rejects a near-miss member, so the schema is a real closed set rather than Schema.String', () => {
        expect({ set: set.name, nearMiss: set.nearMiss, accepted: set.accepts(set.nearMiss) }).toEqual({
          set: set.name,
          nearMiss: set.nearMiss,
          accepted: false,
        });
      });

      it('rejects the first member spelled with an uppercase initial', () => {
        const [first] = set.pinned;
        const shouted = first === undefined ? 'MISSING' : `${first.charAt(0).toUpperCase()}${first.slice(1)}`;
        expect({ set: set.name, shouted, accepted: set.accepts(shouted) }).toEqual({
          set: set.name,
          shouted,
          accepted: false,
        });
      });

      it('rejects the empty string', () => {
        expect({ set: set.name, accepted: set.accepts('') }).toEqual({ set: set.name, accepted: false });
      });
    });
  }
});

describe('SUPERSEDED_KIND_DESTINATION', () => {
  it('names a non-empty destination for every superseded kind, so a refusal says where the fact moved', () => {
    const destinations = new Map<string, string>(
      Object.entries(SUPERSEDED_KIND_DESTINATION).map(([kind, destination]) => [kind, String(destination)]),
    );
    const empty = ['l', 'p', 's', 'tag'].filter((kind) => {
      const destination = destinations.get(kind);
      return destination === undefined || destination.length === 0;
    });
    expect({ keys: [...destinations.keys()].sort(), withoutDestination: empty }).toEqual({
      keys: ['l', 'p', 's', 'tag'],
      withoutDestination: [],
    });
  });
});
