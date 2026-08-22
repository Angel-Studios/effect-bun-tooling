import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PATTERN_REFUTATIONS } from '../src/marking';
import { VOCABULARY_SETS } from './fixtures/vocabulary';

const referencePath = resolve(import.meta.dir, '../../../docs/grammar/README.md');

const referenceText = existsSync(referencePath) ? readFileSync(referencePath, 'utf8') : '';

describe('doc parity — a vocabulary the reference does not mention is undocumented', () => {
  it('found the reference at a path resolved from import.meta.dir, so the parity check cannot pass vacuously', () => {
    expect({ path: referencePath, found: existsSync(referencePath) }).toEqual({
      path: referencePath,
      found: true,
    });
  });

  it('read a non-empty reference, so an emptied file cannot silently satisfy every containment check', () => {
    expect(referenceText.length > 0).toBe(true);
  });

  it('carries the reference marker headings the parity check depends on', () => {
    expect({
      hasSegmentKinds: referenceText.includes('## 2. Segment kinds'),
      hasMarkingSection: referenceText.includes('FALSIFIABLE vs UNFALSIFIABLE'),
    }).toEqual({ hasSegmentKinds: true, hasMarkingSection: true });
  });

  for (const set of VOCABULARY_SETS) {
    it(`documents every member of ${set.name} in docs/grammar/README.md`, () => {
      const undocumented = set.pinned.filter((member) => !referenceText.includes(member));
      expect({ set: set.name, undocumented }).toEqual({ set: set.name, undocumented: [] });
    });
  }

  it('documents every PATTERN_REFUTATIONS oracle VERBATIM, so a code-only oracle fix cannot drift', () => {
    const oracles = Object.entries(PATTERN_REFUTATIONS)
      .map(([pattern, oracle]) => ({ pattern, oracle: typeof oracle === 'string' ? oracle : '' }))
      .filter((entry) => entry.oracle.length > 0);
    const undocumented = oracles
      .filter((entry) => !referenceText.includes(entry.oracle))
      .map((entry) => entry.pattern);
    expect({ oracles: oracles.length, undocumented }).toEqual({ oracles: 4, undocumented: [] });
  });

  it('documents every set NAME, so a set can never ship with no reference row at all', () => {
    const unnamed = VOCABULARY_SETS.map((set) => set.name).filter((name) => !referenceText.includes(name));
    expect(unnamed).toEqual([]);
  });
});
