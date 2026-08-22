import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TACTICAL_PATTERNS } from '../src/grammar';
import {
  ABSTENTION_FLOOR,
  FRONT_MATTER_LEGITIMATE_KINDS,
  frontMatterEligibility,
  isForbiddenInFrontMatter,
  KIND_MARKINGS,
  markingOf,
  PATTERN_REFUTATIONS,
} from '../src/marking';
import { repoRoot } from './fixtures/corpus';

const PATH_KINDS = ['bc', 'lang', 't'];

const FRONT_MATTER_KINDS = [
  'l',
  'p',
  'subdomain',
  'tags',
  'owner',
  'oncall',
  'data_classification',
  'tier',
  'criticality',
  'deprecation',
  'external_links',
  'review_status',
];

const AST_FACT_KINDS = [
  'exports',
  'imports',
  'dependencies',
  'effect_service',
  'effect_layer',
  'loc',
  'language',
  'complexity',
  'coverage',
  'type_signatures',
  'error_types',
  'call_edges',
  'service_unit',
];

const ALL_KINDS = [...PATH_KINDS, ...FRONT_MATTER_KINDS, ...AST_FACT_KINDS];

const REFUTATIONS = new Map<string, string | undefined>(Object.entries(PATTERN_REFUTATIONS));

const ABSTAINING_FILES = [
  'packages/bun-svelte-test/src/checked-pseudo.ts',
  'packages/effect-bun-test/src/utils.ts',
  'packages/bun-svelte-test/src/mount.ts',
  'packages/fixture-residue/src/sweep.ts',
  'packages/effect-test-kit/src/tagged.ts',
  'packages/effect-bun-test/src/fixture-root-suite.ts',
];

const markingCount = (kind: string): number => KIND_MARKINGS.filter((entry) => entry.kind === kind).length;

describe('FALSIFIABLE vs UNFALSIFIABLE — the parity gate input and the derivability gate input', () => {
  it('marks every kind named in the reference section 7 tables exactly once', () => {
    const wrong = ALL_KINDS.filter((kind) => markingCount(kind) !== 1);
    expect({ kindCount: ALL_KINDS.length, notMarkedExactlyOnce: wrong }).toEqual({
      kindCount: 28,
      notMarkedExactlyOnce: [],
    });
  });

  it('pins the table at 28 = 3 path + 12 front-matter + 13 AST-fact, band by band', () => {
    const inBand = (home: string): number => KIND_MARKINGS.filter((entry) => entry.home === home).length;
    expect({
      total: KIND_MARKINGS.length,
      pathBand: inBand('path'),
      frontMatterBand: inBand('front_matter'),
      astFactBand: inBand('ast_fact'),
      declaredPath: PATH_KINDS.length,
      declaredFrontMatter: FRONT_MATTER_KINDS.length,
      declaredAstFact: AST_FACT_KINDS.length,
    }).toEqual({
      total: 28,
      pathBand: 3,
      frontMatterBand: 12,
      astFactBand: 13,
      declaredPath: 3,
      declaredFrontMatter: 12,
      declaredAstFact: 13,
    });
  });

  it('places every kind in the band the reference section 7 tables put it in', () => {
    const misplaced = [
      ...PATH_KINDS.filter((kind) => markingOf(kind)?.home !== 'path'),
      ...FRONT_MATTER_KINDS.filter((kind) => markingOf(kind)?.home !== 'front_matter'),
      ...AST_FACT_KINDS.filter((kind) => markingOf(kind)?.home !== 'ast_fact'),
    ];
    expect(misplaced).toEqual([]);
  });

  it('marks every AST-fact kind FALSIFIABLE, which is exactly what forbids it from front matter', () => {
    const notFalsifiable = AST_FACT_KINDS.filter((kind) => markingOf(kind)?.falsifiability !== 'falsifiable');
    expect(notFalsifiable).toEqual([]);
  });

  it('marks NOTHING that the reference section 7 tables do not name', () => {
    const extra = KIND_MARKINGS.map((entry) => entry.kind).filter((kind) => !ALL_KINDS.includes(kind));
    expect(extra).toEqual([]);
  });

  it('resolves each named kind through markingOf, and refuses an unnamed one with undefined', () => {
    const unresolved = ALL_KINDS.filter((kind) => markingOf(kind) === undefined);
    expect({ unresolved, unknownKind: markingOf('kind_that_does_not_exist') }).toEqual({
      unresolved: [],
      unknownKind: undefined,
    });
  });

  it('gives every marking a NON-EMPTY oracle, or the stated reason no oracle exists', () => {
    const withoutOracle = KIND_MARKINGS.filter((entry) => entry.oracle.trim().length === 0).map(
      (entry) => entry.kind,
    );
    expect(withoutOracle).toEqual([]);
  });

  it('never marks a front_matter kind falsifiable, since a falsifiable fact is forbidden there', () => {
    const contradictions = KIND_MARKINGS.filter(
      (entry) => entry.home === 'front_matter' && entry.falsifiability !== 'unfalsifiable',
    ).map((entry) => entry.kind);
    expect(contradictions).toEqual([]);
  });

  it('uses only the two declared falsifiability values and the three declared homes', () => {
    expect({
      falsifiabilities: [...new Set(KIND_MARKINGS.map((entry) => entry.falsifiability))].sort(),
      homes: [...new Set(KIND_MARKINGS.map((entry) => entry.home))].sort(),
    }).toEqual({
      falsifiabilities: ['falsifiable', 'unfalsifiable'],
      homes: ['ast_fact', 'front_matter', 'path'],
    });
  });

  it('marks the three path kinds as the reference records them, keeping lang separate from language', () => {
    expect(
      PATH_KINDS.map((kind) => {
        const marking = markingOf(kind);
        return marking === undefined
          ? { kind, falsifiability: 'MISSING', home: 'MISSING' }
          : { kind, falsifiability: marking.falsifiability, home: marking.home };
      }),
    ).toEqual([
      { kind: 'bc', falsifiability: 'unfalsifiable', home: 'path' },
      { kind: 'lang', falsifiability: 'falsifiable', home: 'path' },
      { kind: 't', falsifiability: 'unfalsifiable', home: 'path' },
    ]);
  });

  it('carries a partialRefutation for exactly l, p and t — a partly-refutable field stays UNFALSIFIABLE', () => {
    const withPartial = KIND_MARKINGS.filter(
      (entry) => entry.partialRefutation !== undefined && entry.partialRefutation.length > 0,
    ).map((entry) => entry.kind);
    expect(withPartial.sort()).toEqual(['l', 'p', 't']);
  });

  it('marks t UNFALSIFIABLE, because an oracle that refutes t_support and t_fixture cannot COMPUTE the kind', () => {
    const marking = markingOf('t');
    expect({
      falsifiability: marking?.falsifiability,
      home: marking?.home,
      hasPartial: (marking?.partialRefutation ?? '').length > 0,
    }).toEqual({ falsifiability: 'unfalsifiable', home: 'path', hasPartial: true });
  });

  it('never marks a kind falsifiable merely because SOME of its values can be contradicted', () => {
    const contradictory = KIND_MARKINGS.filter(
      (entry) => entry.falsifiability === 'falsifiable' && (entry.partialRefutation ?? '').length > 0,
    ).map((entry) => entry.kind);
    expect(contradictory).toEqual([]);
  });
});

const UNMARKED_PROBES = ['exported_symbols', 'line_count', 'cyclomatic', 'import_list'];

describe('isForbiddenInFrontMatter — the derivability gate, keyed on HOME and fail-closed', () => {
  it('forbids EVERY AST-fact kind in front matter, so a derivable fact is never duplicated', () => {
    const permitted = AST_FACT_KINDS.filter((kind) => !isForbiddenInFrontMatter(kind));
    expect({ astFactKinds: AST_FACT_KINDS.length, permitted }).toEqual({
      astFactKinds: 13,
      permitted: [],
    });
  });

  it('permits EVERY front-matter kind, so a downgrade cannot quietly outlaw legitimate metadata', () => {
    const forbidden = FRONT_MATTER_KINDS.filter((kind) => isForbiddenInFrontMatter(kind));
    expect({ frontMatterKinds: FRONT_MATTER_KINDS.length, forbidden }).toEqual({
      frontMatterKinds: 12,
      forbidden: [],
    });
  });

  it('forbids every PATH kind, because a bounded context belongs in the path and not in front matter', () => {
    expect(PATH_KINDS.map((kind) => [kind, isForbiddenInFrontMatter(kind)])).toEqual([
      ['bc', true],
      ['lang', true],
      ['t', true],
    ]);
  });

  it('FAILS CLOSED on a kind that is not in the table at all, so an unmarked derivable fact cannot pass', () => {
    const permitted = UNMARKED_PROBES.filter((kind) => !isForbiddenInFrontMatter(kind));
    expect({ probes: UNMARKED_PROBES.length, permitted }).toEqual({ probes: 4, permitted: [] });
  });

  it('is the EXACT COMPLEMENT of FRONT_MATTER_LEGITIMATE_KINDS over all 28 kinds plus unknown probes', () => {
    const legitimate = new Set(FRONT_MATTER_LEGITIMATE_KINDS);
    const probes = [...ALL_KINDS, ...UNMARKED_PROBES];
    const disagreements = probes.filter((kind) => isForbiddenInFrontMatter(kind) === legitimate.has(kind));
    expect({ probes: probes.length, disagreements }).toEqual({ probes: 32, disagreements: [] });
  });

  it('names service_unit as an AST fact rather than dropping the retired s_ kind', () => {
    expect({
      forbidden: isForbiddenInFrontMatter('service_unit'),
      home: markingOf('service_unit')?.home,
    }).toEqual({ forbidden: true, home: 'ast_fact' });
  });

  it('pins FRONT_MATTER_LEGITIMATE_KINDS to the reference section 7 legitimate table, in order', () => {
    expect([...FRONT_MATTER_LEGITIMATE_KINDS]).toEqual([...FRONT_MATTER_KINDS]);
  });
});

describe('frontMatterEligibility — three-valued, so a gate can say WHY rather than pass silently', () => {
  it('separates legitimate, forbidden and unmarked, with unmarked REACHABLE', () => {
    expect({
      frontMatter: frontMatterEligibility('l'),
      pathKind: frontMatterEligibility('bc'),
      astFact: frontMatterEligibility('exports'),
      unknown: frontMatterEligibility('exported_symbols'),
    }).toEqual({
      frontMatter: 'legitimate',
      pathKind: 'forbidden',
      astFact: 'forbidden',
      unknown: 'unmarked',
    });
  });

  it('uses only the three declared values over the full table plus unknown probes', () => {
    const values = [...new Set([...ALL_KINDS, ...UNMARKED_PROBES].map(frontMatterEligibility))].sort();
    expect(values).toEqual(['forbidden', 'legitimate', 'unmarked']);
  });

  it('agrees with isForbiddenInFrontMatter on every probe — two predicates, one truth', () => {
    const probes = [...ALL_KINDS, ...UNMARKED_PROBES];
    const disagreements = probes.filter(
      (kind) => isForbiddenInFrontMatter(kind) !== (frontMatterEligibility(kind) !== 'legitimate'),
    );
    expect({ probes: probes.length, disagreements }).toEqual({ probes: 32, disagreements: [] });
  });

  it('reports legitimate for EXACTLY the twelve front-matter kinds and nothing else', () => {
    const legitimate = [...ALL_KINDS, ...UNMARKED_PROBES].filter(
      (kind) => frontMatterEligibility(kind) === 'legitimate',
    );
    expect(legitimate).toEqual([...FRONT_MATTER_KINDS]);
  });
});

describe('PATTERN_REFUTATIONS — per-value partial refutation for the tactical pattern field', () => {
  it('decides EVERY TacticalPattern literal, so an appended pattern with no decision reddens', () => {
    expect([...REFUTATIONS.keys()].sort()).toEqual([...TACTICAL_PATTERNS].sort());
  });

  it('populates exactly the four structural literals the reference names', () => {
    const populated = TACTICAL_PATTERNS.filter((pattern) => {
      const refutation = REFUTATIONS.get(pattern);
      return typeof refutation === 'string' && refutation.length > 0;
    });
    expect([...populated]).toEqual(['port', 'adapter', 'test_double', 'barrel']);
  });

  it('leaves every other TacticalPattern undefined, because weak signals are not refutation', () => {
    const decided = ['barrel', 'port', 'adapter', 'test_double'];
    const wronglyPopulated = TACTICAL_PATTERNS.filter(
      (pattern) => !decided.includes(pattern) && REFUTATIONS.get(pattern) !== undefined,
    );
    expect([...wronglyPopulated]).toEqual([]);
  });

  it('leaves the abstention terminal unassigned with no refuting oracle', () => {
    expect(REFUTATIONS.get('unassigned')).toBe(undefined);
  });
});

const sourceOf = (path: string): string => {
  const absolute = resolve(repoRoot, path);
  return existsSync(absolute) ? readFileSync(absolute, 'utf8') : '';
};

const exportedRuntimeBindings = (source: string): readonly string[] =>
  source
    .split('\n')
    .filter((line) => line.startsWith('export '))
    .filter((line) => !line.startsWith('export type ') && !line.startsWith('export interface '));

const TAG_DECLARATION = /Context\.Service|Schema\.|\bTag\(/;

const portRefuted = (source: string): boolean =>
  exportedRuntimeBindings(source).some((line) => !TAG_DECLARATION.test(line));

const PORT_ORACLE =
  'an exported runtime binding that is neither a `Context.Service`/`Tag` declaration nor a `Schema` — an implementation living in the port module';

describe('the port oracle is pinned AS SHIPPED, then modelled behaviourally against real files', () => {
  const PORT_FILE = 'packages/uuid-effect/src/tag.ts';
  const IMPLEMENTATION_FILE = 'packages/uuid-effect/src/layer.live.ts';

  it('pins PATTERN_REFUTATIONS.port to the exact shipped string, so a reword is deliberate not silent drift', () => {
    expect(PATTERN_REFUTATIONS.port).toEqual(PORT_ORACLE);
  });

  it('pins the other three shipped oracle strings exactly, on the same ground', () => {
    expect({
      adapter: PATTERN_REFUTATIONS.adapter,
      test_double: PATTERN_REFUTATIONS.test_double,
      barrel: PATTERN_REFUTATIONS.barrel,
    }).toEqual({
      adapter: 'importing nothing external',
      test_double: 'exporting no `Layer` and no stand-in',
      barrel: 'any non-re-export declaration in the module',
    });
  });

  it('states an oracle that INVERTS the refuted wording, which is the substance of the correction', () => {
    expect({
      refutedWording: String(PATTERN_REFUTATIONS.port) === 'any exported runtime binding',
      namesTheTagException: String(PATTERN_REFUTATIONS.port).includes('Context.Service'),
    }).toEqual({ refutedWording: false, namesTheTagException: true });
  });

  it('reads both real files, so neither verdict below can be reached on an empty string', () => {
    expect({
      port: sourceOf(PORT_FILE).length > 0,
      implementation: sourceOf(IMPLEMENTATION_FILE).length > 0,
    }).toEqual({ port: true, implementation: true });
  });

  it('LOCAL MODEL of the pinned oracle: does not refute the section 5 port token, an Effect Context.Service', () => {
    const source = sourceOf(PORT_FILE);
    expect({
      hasExportedRuntimeBinding: exportedRuntimeBindings(source).length > 0,
      refuted: portRefuted(source),
    }).toEqual({ hasExportedRuntimeBinding: true, refuted: false });
  });

  it('LOCAL MODEL of the pinned oracle: DOES refute a live implementation module in the same package', () => {
    expect(portRefuted(sourceOf(IMPLEMENTATION_FILE))).toBe(true);
  });

  it('LOCAL MODEL of the pinned oracle: separates the two real files, so an inversion fails one half', () => {
    expect([portRefuted(sourceOf(PORT_FILE)), portRefuted(sourceOf(IMPLEMENTATION_FILE))]).toEqual([
      false,
      true,
    ]);
  });
});

describe('ABSTENTION_FLOOR — six files in twenty-four, measured in THIS repository', () => {
  it('pins the RECORDED snapshot at six entries, so the record cannot be quietly engineered down', () => {
    expect(ABSTENTION_FLOOR.length).toBe(6);
  });

  it('pins a record, NOT an abstention count in any tree — no gate here reads a live abstention total', () => {
    expect({
      recorded: ABSTENTION_FLOOR.length,
      isASnapshotOfThisRepository: ABSTENTION_FLOOR.every((entry) => entry.path.startsWith('packages/')),
    }).toEqual({ recorded: 6, isASnapshotOfThisRepository: true });
  });

  it('names the six abstaining files the reference section 9 measured', () => {
    expect(ABSTENTION_FLOOR.map((entry) => entry.path).sort()).toEqual([...ABSTAINING_FILES].sort());
  });

  it('resolves every recorded path to a file that EXISTS under this repository root', () => {
    const missing = ABSTENTION_FLOOR.map((entry) => entry.path).filter(
      (path) => !existsSync(resolve(repoRoot, path)),
    );
    expect({ repoRoot, missing }).toEqual({ repoRoot, missing: [] });
  });

  it('gives every entry a non-empty reason, so an abstention says WHY no term applies', () => {
    const withoutReason = ABSTENTION_FLOOR.filter((entry) => entry.reason.trim().length === 0).map(
      (entry) => entry.path,
    );
    expect(withoutReason).toEqual([]);
  });
});
