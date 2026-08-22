import { describe, expect, it } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { classify } from '../src/parse';
import { repoRoot, summarize, testConfig } from './fixtures/corpus';

const WORKING_TREE_FLOOR = 100;

const workingTreePaths = (): readonly string[] => {
  try {
    const listing = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    return listing.split('\n').filter((line) => line.length > 0);
  } catch {
    return [];
  }
};

const TREE = workingTreePaths();

const SHELL_SIBLINGS = new Set(['src', '__tests__', '__test__']);

const packageRelative = (path: string): readonly string[] => {
  const segments = path.split('/');
  return segments[0] === 'packages' && segments.length > 2 ? segments : [];
};

const naiveProjection = (path: string): string => {
  const segments = packageRelative(path);
  const name = segments[1] ?? '';
  return `packages/bc_${name.replace(/-/g, '_')}/lang_typescript/${segments.slice(2).join('/')}`;
};

const recipeProjection = (path: string): string => {
  const segments = packageRelative(path);
  const name = segments[1] ?? '';
  const rest = segments.slice(2);
  const head = rest[0] === 'src' ? 'src' : 't_unit';
  return `packages/bc_${name.replace(/-/g, '_')}/lang_typescript/${[head, ...rest.slice(1)].join('/')}`;
};

const PACKAGE_FILES = TREE.filter((path) => packageRelative(path).length > 0);

const RECIPE_COVERED = TREE.filter((path) => {
  const segments = packageRelative(path);
  const sibling = segments[2];
  return segments.length > 3 && sibling !== undefined && SHELL_SIBLINGS.has(sibling);
});

const FIRST_PARTY_SOURCE = /^packages\/[^/]+\/src\//;

const histogramOf = (
  paths: readonly string[],
  project: (path: string) => string,
): ReadonlyMap<string, number> => {
  const counts = new Map<string, number>();
  for (const path of paths) {
    const key = summarize(classify(project(path), testConfig)).tag;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
};

const malformedIn = (paths: readonly string[], project: (path: string) => string): readonly string[] =>
  paths
    .map((path) => ({ path: project(path), result: summarize(classify(project(path), testConfig)) }))
    .filter((entry) => entry.result.tag === 'Malformed')
    .map((entry) => `${entry.path} -> ${String(entry.result.reason)}`);

const malformedReasonsIn = (paths: readonly string[], project: (path: string) => string): readonly string[] =>
  [
    ...new Set(
      paths
        .map((path) => summarize(classify(project(path), testConfig)))
        .filter((result) => result.tag === 'Malformed')
        .map((result) => String(result.reason)),
    ),
  ].sort();

const identity = (path: string): string => path;

describe('corpus sweep — the UNADOPTED working tree of this repository, which IS present in CI', () => {
  it('swept a non-trivial denominator, so a sweep reduced to zero inputs fails loudly rather than green', () => {
    expect({
      floor: WORKING_TREE_FLOOR,
      swept: TREE.length,
      meetsFloor: TREE.length >= WORKING_TREE_FLOOR,
    }).toEqual({
      floor: WORKING_TREE_FLOOR,
      swept: TREE.length,
      meetsFloor: true,
    });
  });

  it('classifies ZERO paths Malformed over an unadopted tree — closure requirement 4 as a PROPERTY', () => {
    expect({ swept: TREE.length >= WORKING_TREE_FLOOR, malformed: malformedIn(TREE, identity) }).toEqual({
      swept: true,
      malformed: [],
    });
  });

  it('classifies ZERO first-party packages/*/src/** files Outside, so no source file is silently excluded', () => {
    const firstPartySource = TREE.filter((path) => FIRST_PARTY_SOURCE.test(path));
    const swallowed = firstPartySource.filter(
      (path) => summarize(classify(path, testConfig)).tag === 'Outside',
    );
    expect({ firstPartySource: firstPartySource.length > 0, swallowed }).toEqual({
      firstPartySource: true,
      swallowed: [],
    });
  });

  it('leaves the histogram DOMINATED by Ungraded — the partial-adoption hinge holding at tree scale', () => {
    const histogram = histogramOf(TREE, identity);
    const ungraded = histogram.get('Ungraded') ?? 0;
    expect({
      swept: TREE.length >= WORKING_TREE_FLOOR,
      ungradedIsMajority: ungraded * 2 > TREE.length,
      malformed: histogram.get('Malformed') ?? 0,
    }).toEqual({ swept: true, ungradedIsMajority: true, malformed: 0 });
  });

  it('uses only the terminals the reference declares, never an unnamed outcome', () => {
    const tags = [...histogramOf(TREE, identity).keys()].sort();
    const foreign = tags.filter(
      (tag) => !['Anchor', 'Graded', 'Malformed', 'Outside', 'Test', 'Ungraded'].includes(tag),
    );
    expect({ swept: TREE.length >= WORKING_TREE_FLOOR, foreignTerminals: foreign }).toEqual({
      swept: true,
      foreignTerminals: [],
    });
  });
});

describe('corpus sweep — SELF-CHECK, so a green sweep is earned rather than blind', () => {
  it('reports a Malformed path when the instrument is handed one', () => {
    expect(malformedIn(['packages/bc_x/lang_typescript/src/l_domain/types.ts'], identity)).toEqual([
      'packages/bc_x/lang_typescript/src/l_domain/types.ts -> superseded_kind',
    ]);
  });

  it('reports the Malformed REASON, so a sweep failure names what broke', () => {
    expect(malformedReasonsIn(['bc_a/bc_b/lang_rust/src/x.rs', '/leading/slash.ts'], identity)).toEqual([
      'duplicate_kind',
      'unnormalized_path',
    ]);
  });

  it('detects a first-party src path that IS Outside, so the zero above is a real zero', () => {
    const planted = 'packages/x/src/node_modules/y.ts';
    expect({
      matchesTheFilter: FIRST_PARTY_SOURCE.test(planted),
      tag: summarize(classify(planted, testConfig)).tag,
    }).toEqual({ matchesTheFilter: true, tag: 'Outside' });
  });

  it('counts a histogram rather than returning an empty map for a non-empty input', () => {
    const histogram = histogramOf(
      ['packages/uuid-effect/src/tag.ts', 'bc_a/bc_b/lang_rust/src/x.rs'],
      identity,
    );
    expect([...histogram.entries()].sort()).toEqual([
      ['Malformed', 1],
      ['Ungraded', 1],
    ]);
  });
});

describe('corpus sweep — a synthetic MIGRATED projection of the same tree', () => {
  it('swept a non-trivial denominator of package files', () => {
    expect({ swept: PACKAGE_FILES.length, meetsFloor: PACKAGE_FILES.length >= 50 }).toEqual({
      swept: PACKAGE_FILES.length,
      meetsFloor: true,
    });
  });

  it('produces ONLY file_outside_shell under the naive insert-above-the-shell projection', () => {
    expect({
      swept: PACKAGE_FILES.length >= 50,
      reasons: malformedReasonsIn(PACKAGE_FILES, naiveProjection),
    }).toEqual({ swept: true, reasons: ['file_outside_shell'] });
  });

  it('mints no spurious refusal under migration — no reserved_basename, superseded_kind or duplicate_kind', () => {
    const reasons = new Set(malformedReasonsIn(PACKAGE_FILES, naiveProjection));
    const spurious = [
      'reserved_basename',
      'superseded_kind',
      'duplicate_kind',
      'unknown_structural_kind',
      'token_below_shell',
      'unnormalized_path',
      'not_lowercase',
    ].filter((reason) => reasons.has(reason));
    expect({ swept: PACKAGE_FILES.length >= 50, spurious }).toEqual({ swept: true, spurious: [] });
  });

  it('classifies ZERO Malformed once the migration recipe also mints the test tree', () => {
    expect({
      covered: RECIPE_COVERED.length >= 50,
      malformed: malformedIn(RECIPE_COVERED, recipeProjection),
    }).toEqual({ covered: true, malformed: [] });
  });

  it('grades the recipe-covered projection as Graded and Test only, never Ungraded', () => {
    const tags = [...histogramOf(RECIPE_COVERED, recipeProjection).keys()].sort();
    expect({ covered: RECIPE_COVERED.length >= 50, tags }).toEqual({
      covered: true,
      tags: ['Graded', 'Test'],
    });
  });
});

describe('corpus sweep — hostile paths MEASURED in project-xavier @ 444244199, committed as literals', () => {
  const FIRST_PARTY_UNMIGRATED = [
    'scripts/tag_branch.sh',
    'apps/xavier/src/device-lab/build/build-service.ts',
    'apps/sofa/src/calibration/target/cdp-eval.ts',
    'apps/xavier/src/nav-protocol/coverage/metrics.ts',
  ];

  for (const path of FIRST_PARTY_UNMIGRATED) {
    it(`leaves the real first-party unmigrated ${path} green, never Malformed and never Outside`, () => {
      const result = summarize(classify(path, testConfig));
      expect({ path, tag: result.tag }).toEqual({ path, tag: 'Ungraded' });
    });
  }

  it('sweeps every hostile path at once, so a partial fix cannot pass', () => {
    const notGreen = FIRST_PARTY_UNMIGRATED.filter(
      (path) => summarize(classify(path, testConfig)).tag !== 'Ungraded',
    );
    expect({ candidates: FIRST_PARTY_UNMIGRATED.length, notGreen }).toEqual({ candidates: 4, notGreen: [] });
  });
});
