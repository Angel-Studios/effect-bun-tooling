import { describe, expect, it } from 'bun:test';
import { ANCHOR_KINDS, OUTSIDE_KINDS } from '../src/grammar';
import { ANCHOR_BASENAMES, classify, classifyParsed, OUTSIDE_SEGMENTS, parsePath } from '../src/parse';
import type { ClassSummary } from './fixtures/corpus';
import { summarize, testConfig } from './fixtures/corpus';

const ROKU_LANGUAGE_ROOT_INSIDE = 'tools/bc_overlap_vision/lang_brightscript/source/board_geom.brs';
const ROKU_LANGUAGE_ROOT_OUTSIDE = 'tools/lang_brightscript/bc_overlap_vision/source/board_geom.brs';

type HostileCase = { readonly input: string; readonly expected: ClassSummary };

const HOSTILE_INPUTS: readonly HostileCase[] = [
  { input: '', expected: { tag: 'Ungraded', reason: 'no_grammar_tokens' } },
  { input: '/', expected: { tag: 'Malformed', reason: 'unnormalized_path', segment: '/' } },
  { input: '//', expected: { tag: 'Malformed', reason: 'unnormalized_path', segment: '/' } },
  { input: '///////', expected: { tag: 'Malformed', reason: 'unnormalized_path', segment: '/' } },
  { input: '.', expected: { tag: 'Ungraded', reason: 'no_grammar_tokens' } },
  { input: '..', expected: { tag: 'Malformed', reason: 'unnormalized_path', segment: '..' } },
  { input: './', expected: { tag: 'Ungraded', reason: 'no_grammar_tokens' } },
  { input: '   ', expected: { tag: 'Ungraded', reason: 'no_grammar_tokens' } },
  { input: ' ', expected: { tag: 'Ungraded', reason: 'no_grammar_tokens' } },
  { input: '\u0000', expected: { tag: 'Ungraded', reason: 'no_grammar_tokens' } },
  { input: 'no-slashes-at-all', expected: { tag: 'Ungraded', reason: 'no_grammar_tokens' } },
  { input: 'a/b/c/d/e/f/g', expected: { tag: 'Ungraded', reason: 'no_grammar_tokens' } },
  { input: 'packages/日本語/src/файл.ts', expected: { tag: 'Ungraded', reason: 'no_grammar_tokens' } },
  { input: 'lang_typescript', expected: { tag: 'Ungraded', reason: 'no_grammar_tokens' } },
  { input: 'bc_x', expected: { tag: 'Ungraded', reason: 'no_grammar_tokens' } },
  {
    input: 'packages/bc_ünïcödé/lang_typescript/src/x.ts',
    expected: { tag: 'Malformed', reason: 'bad_name_shape', segment: 'bc_ünïcödé' },
  },
  {
    input: 'packages/bc_/lang_/t_/x.ts',
    expected: { tag: 'Malformed', reason: 'bad_name_shape', segment: 'bc_' },
  },
  {
    input: 'packages/bc_x/lang_typescript/src/',
    expected: { tag: 'Malformed', reason: 'file_outside_shell', segment: 'src' },
  },
  {
    input: 'packages//lang_typescript//src//x.ts',
    expected: { tag: 'Graded', language: 'typescript', shellRole: 'source' },
  },
  {
    input: '.hidden/lang_typescript/src/x.ts',
    expected: { tag: 'Graded', language: 'typescript', shellRole: 'source' },
  },
  {
    input: '/packages/bc_a/lang_typescript/src/x.ts',
    expected: { tag: 'Malformed', reason: 'unnormalized_path', segment: '/' },
  },
  {
    input: 'packages/bc_a/lang_typescript/src/../x.ts',
    expected: { tag: 'Malformed', reason: 'unnormalized_path', segment: '..' },
  },
  {
    input: 'packages\\bc_a\\lang_typescript\\src\\x.ts',
    expected: { tag: 'Malformed', reason: 'unnormalized_path', segment: '\\' },
  },
];

const NONSENSE_INPUTS = HOSTILE_INPUTS.map((entry) => entry.input);

describe('the parse is an ORDER-INDEPENDENT token scan', () => {
  it('classifies the language root OUTSIDE the context segment IDENTICALLY to inside it', () => {
    expect(classify(ROKU_LANGUAGE_ROOT_OUTSIDE, testConfig)).toEqual(
      classify(ROKU_LANGUAGE_ROOT_INSIDE, testConfig),
    );
  });

  it('grades both Roku spellings rather than merely agreeing on a refusal', () => {
    expect(summarize(classify(ROKU_LANGUAGE_ROOT_INSIDE, testConfig))).toEqual({
      tag: 'Graded',
      context: 'overlap_vision',
      language: 'brightscript',
      shellRole: 'source',
    });
  });

  it('is order-independent for the token SET, not only for the two Roku spellings', () => {
    expect(classify('packages/lang_typescript/bc_uuid_effect/src/tag.ts', testConfig)).toEqual(
      classify('packages/bc_uuid_effect/lang_typescript/src/tag.ts', testConfig),
    );
  });

  it('refuses TWO context tokens on one path as a loud typed error, never a precedence rule', () => {
    const result = summarize(classify('bc_a/bc_b/lang_rust/src/x.rs', testConfig));
    expect({ tag: result.tag, reason: result.reason }).toEqual({
      tag: 'Malformed',
      reason: 'duplicate_kind',
    });
  });

  it('refuses two language roots on one path with the same duplicate_kind reason', () => {
    expect(summarize(classify('bc_a/lang_rust/lang_typescript/src/x.rs', testConfig)).reason).toBe(
      'duplicate_kind',
    );
  });

  it('refuses two test-tree tokens on one path with the same duplicate_kind reason', () => {
    expect(summarize(classify('bc_a/lang_typescript/t_unit/t_e2e/src/x.ts', testConfig)).reason).toBe(
      'duplicate_kind',
    );
  });

  it('parsePath is deterministic for one input, so a token scan cannot depend on call order', () => {
    expect(parsePath(ROKU_LANGUAGE_ROOT_INSIDE, testConfig)).toEqual(
      parsePath(ROKU_LANGUAGE_ROOT_INSIDE, testConfig),
    );
  });
});

describe('Ungraded is not Malformed — the partial-adoption hinge', () => {
  it('reports a real unmigrated file in THIS repository as Ungraded and never as an error', () => {
    expect(summarize(classify('packages/uuid-effect/src/tag.ts', testConfig))).toEqual({
      tag: 'Ungraded',
      reason: 'no_grammar_tokens',
    });
  });

  it('reports a bc_ segment with no lang_ root as Ungraded no_language_root, STILL carrying its context', () => {
    expect(summarize(classify('packages/bc_uuid_effect/src/tag.ts', testConfig))).toEqual({
      tag: 'Ungraded',
      reason: 'no_language_root',
      context: 'uuid_effect',
    });
  });

  it('separates the two Ungraded reasons, so an adopted-but-unrooted subtree is distinguishable', () => {
    expect([
      summarize(classify('packages/uuid-effect/src/tag.ts', testConfig)).reason,
      summarize(classify('packages/bc_uuid_effect/src/tag.ts', testConfig)).reason,
    ]).toEqual(['no_grammar_tokens', 'no_language_root']);
  });

  it('keeps Ungraded and Malformed as DISTINCT outcomes for the same subtree', () => {
    expect([
      summarize(classify('packages/bc_uuid_effect/src/tag.ts', testConfig)).tag,
      summarize(classify('packages/bc_match/lang_typescript/src/tag.ts', testConfig)).tag,
    ]).toEqual(['Ungraded', 'Malformed']);
  });

  for (const hostile of HOSTILE_INPUTS) {
    it(`classifies the hostile input ${JSON.stringify(hostile.input)} exactly, not merely without throwing`, () => {
      expect(summarize(classify(hostile.input, testConfig))).toEqual(hostile.expected);
    });
  }

  it('never THROWS for any hostile input either, which is the weaker half of the same property', () => {
    const thrown = NONSENSE_INPUTS.filter((input) => {
      try {
        classify(input, testConfig);
        return false;
      } catch {
        return true;
      }
    });
    expect({ candidates: NONSENSE_INPUTS.length > 0, thrown }).toEqual({ candidates: true, thrown: [] });
  });

  it('never throws from parsePath either, for the same nonsense corpus', () => {
    const failures = NONSENSE_INPUTS.filter((input) => {
      try {
        parsePath(input, testConfig);
        return false;
      } catch {
        return true;
      }
    });
    expect(failures).toEqual([]);
  });
});

describe('superseded_kind outranks every other refusal, including token_below_shell', () => {
  const SUPERSEDED_SEGMENTS = ['l_domain', 'p_adapter', 's_uuid', 'tag_owner_platform'];

  const PLACEMENTS = [
    {
      where: 'ABOVE the language root',
      path: (segment: string): string => `packages/${segment}/lang_typescript/src/types.ts`,
    },
    {
      where: 'BELOW a consumed shell, where the retired directories actually lived',
      path: (segment: string): string => `packages/bc_x/lang_typescript/src/${segment}/types.ts`,
    },
    {
      where: 'on an UNADOPTED path carrying no language root at all',
      path: (segment: string): string => `src/${segment}/types.ts`,
    },
  ];

  for (const placement of PLACEMENTS) {
    for (const segment of SUPERSEDED_SEGMENTS) {
      it(`reports superseded_kind for ${segment} ${placement.where}`, () => {
        const result = summarize(classify(placement.path(segment), testConfig));
        expect({ segment, tag: result.tag, reason: result.reason, named: result.segment }).toEqual({
          segment,
          tag: 'Malformed',
          reason: 'superseded_kind',
          named: segment,
        });
      });
    }
  }

  it('reports the SAME reason in all three placements, so the ranking makes the diagnostic uniform', () => {
    const reasons = PLACEMENTS.flatMap((placement) =>
      SUPERSEDED_SEGMENTS.map((segment) => summarize(classify(placement.path(segment), testConfig)).reason),
    );
    expect(new Set(reasons)).toEqual(new Set(['superseded_kind']));
  });

  it('reports superseded_kind and NOT token_below_shell, because the retired kind is the actionable diagnostic', () => {
    expect(
      summarize(classify('packages/bc_x/lang_typescript/src/l_domain/types.ts', testConfig)).reason,
    ).toBe('superseded_kind');
  });

  it('outranks a competing refusal at a SHALLOWER segment, not just one at the same depth', () => {
    expect(summarize(classify('bc_Billing/lang_typescript/src/l_domain/x.ts', testConfig)).reason).toBe(
      'superseded_kind',
    );
  });

  it('lets the OUTERMOST superseded kind win when a path carries several', () => {
    expect(summarize(classify('src/l_domain/p_port/types.ts', testConfig)).segment).toBe('l_domain');
  });

  it('CONTROL: absent a superseded kind, ordering falls back to segment index', () => {
    const result = summarize(classify('bc_Billing/lang_Klingon/src/x.ts', testConfig));
    expect({ reason: result.reason, segment: result.segment }).toEqual({
      reason: 'not_lowercase',
      segment: 'bc_Billing',
    });
  });

  it('refuses the reference section 0 worked example src/l_domain/p_port/types.ts', () => {
    expect(summarize(classify('src/l_domain/p_port/types.ts', testConfig))).toEqual({
      tag: 'Malformed',
      reason: 'superseded_kind',
      segment: 'l_domain',
    });
  });

  it('CONTROL: a LIVE structural kind below a consumed shell still reports token_below_shell', () => {
    const result = summarize(classify('bc_a/lang_rust/src/t_unit/x.rs', testConfig));
    expect({ tag: result.tag, reason: result.reason, segment: result.segment }).toEqual({
      tag: 'Malformed',
      reason: 'token_below_shell',
      segment: 't_unit',
    });
  });

  it('CONTROL: token_below_shell survives in a second language, so the ranking deleted no reason', () => {
    expect(
      summarize(classify('packages/bc_x/lang_typescript/src/t_integration/helper.ts', testConfig)).reason,
    ).toBe('token_below_shell');
  });

  it('CONTROL: the two reasons are DISTINCT outcomes for the same shell position', () => {
    expect([
      summarize(classify('bc_a/lang_rust/src/t_unit/x.rs', testConfig)).reason,
      summarize(classify('bc_a/lang_rust/src/l_domain/x.rs', testConfig)).reason,
    ]).toEqual(['token_below_shell', 'superseded_kind']);
  });
});

describe('an unknown prefix is a token ONLY inside an adopted subtree — reference section 2', () => {
  it('refuses q_foo with unknown_structural_kind above the shell of an ADOPTED path', () => {
    expect(summarize(classify('packages/q_foo/lang_typescript/src/x.ts', testConfig)).reason).toBe(
      'unknown_structural_kind',
    );
  });

  it('leaves q_foo an ordinary Untyped directory on an UNADOPTED path', () => {
    expect(summarize(classify('packages/q_foo/src/x.ts', testConfig))).toEqual({
      tag: 'Ungraded',
      reason: 'no_grammar_tokens',
    });
  });

  it('keeps the real unmigrated Elixir corpus path green, which is what refutes the literal reading', () => {
    expect(
      summarize(classify('tools/nvenc-lab/direct-sdk/elixir/lib/nvenc_lab/cli.ex', testConfig)).tag,
    ).toBe('Ungraded');
  });

  it('keeps a SUPERSEDED prefix a token adopted or not, unlike an unknown one', () => {
    expect([
      summarize(classify('src/l_domain/types.ts', testConfig)).tag,
      summarize(classify('src/q_foo/types.ts', testConfig)).tag,
    ]).toEqual(['Malformed', 'Ungraded']);
  });
});

describe('tag_suffix_in_path — the subdomain suffix moved to front matter', () => {
  it('refuses bc_uuid_effect__subdomain_generic rather than minting a context of that literal name', () => {
    const result = summarize(
      classify('packages/bc_uuid_effect__subdomain_generic/lang_typescript/src/tag.ts', testConfig),
    );
    expect({ tag: result.tag, reason: result.reason, context: result.context }).toEqual({
      tag: 'Malformed',
      reason: 'tag_suffix_in_path',
      context: undefined,
    });
  });

  it('never yields a context literally named uuid_effect__subdomain_generic', () => {
    expect(
      summarize(classify('packages/bc_uuid_effect__subdomain_generic/lang_typescript/src/tag.ts', testConfig))
        .context,
    ).not.toBe('uuid_effect__subdomain_generic');
  });
});

describe('reserved_basename — a file can never be confused with a directory under a path-only parse', () => {
  it('refuses a file basename whose first underscore-delimited token is a structural kind', () => {
    expect(summarize(classify('packages/bc_x/lang_typescript/src/t_helpers.ts', testConfig)).reason).toBe(
      'reserved_basename',
    );
  });

  it('refuses a file basename whose first underscore-delimited token is a superseded kind', () => {
    expect(summarize(classify('packages/bc_x/lang_typescript/src/tag_owner.ts', testConfig)).reason).toBe(
      'reserved_basename',
    );
  });

  it('leaves an UNDELIMITED basename alone — tag.ts is a file, not a tag_ segment', () => {
    expect(summarize(classify('packages/bc_uuid_effect/lang_typescript/src/tag.ts', testConfig))).toEqual({
      tag: 'Graded',
      context: 'uuid_effect',
      language: 'typescript',
      shellRole: 'source',
    });
  });
});

const tableEntries = <V>(table: ReadonlyMap<string, V>): readonly (readonly [string, string])[] =>
  [...table.entries()].map(([key, value]) => [key, String(value)] as const);

const ANCHOR_KIND_SET = new Set<string>(ANCHOR_KINDS);

const OUTSIDE_KIND_SET = new Set<string>(OUTSIDE_KINDS);

const DOC_ANCHOR_BASENAMES = [
  ['package.json', 'package_manifest'],
  ['Cargo.toml', 'cargo_manifest'],
  ['mix.exs', 'mix_manifest'],
  ['build.gradle.kts', 'gradle_manifest'],
  ['Package.swift', 'swiftpm_manifest'],
  ['manifest', 'roku_manifest'],
  ['lib.rs', 'crate_root'],
];

const DOC_OUTSIDE_SEGMENTS = [
  ['node_modules', 'installed_dependency'],
  ['vendor', 'vendored'],
];

const CLASSIFY_PARITY_INPUTS = [
  ...NONSENSE_INPUTS,
  'packages/bc_uuid_effect/lang_typescript/src/tag.ts',
  'tools/av1rt/crates/bc_av1rt_quality/lang_rust/tests/vmaf_smoke.rs',
  'modules/bc_shared/lang_kotlin/src/wasmJsMain/kotlin/day/harvest/traditions/MapHost.kt',
  'packages/bc_x/lang_typescript/src/l_domain/types.ts',
  'bc_a/lang_rust/src/t_unit/x.rs',
  'node_modules/effect/dist/Schema.js',
  'packages/bc_napi_avahi_client/lang_rust/src/lib.rs',
  'packages/uuid-effect/src/tag.ts',
];

describe('reserved_basename is SCOPED to adopted subtrees, so an unmigrated tree stays green', () => {
  const RESERVED_LOOKING_BASENAMES = [
    'tag_branch.sh',
    'l_domain.ts',
    'p_mobile_check_nor.png',
    's_uuid.ts',
    't_helpers.ts',
    'bc_thing.ts',
    'lang_notes.md',
  ];

  it('leaves the real first-party project-xavier script scripts/tag_branch.sh Ungraded, never Malformed', () => {
    expect(summarize(classify('scripts/tag_branch.sh', testConfig))).toEqual({
      tag: 'Ungraded',
      reason: 'no_grammar_tokens',
    });
  });

  it('leaves EVERY reserved-looking basename green on an unadopted path', () => {
    const refused = RESERVED_LOOKING_BASENAMES.filter(
      (basename) => summarize(classify(`scripts/${basename}`, testConfig)).tag === 'Malformed',
    );
    expect({ candidates: RESERVED_LOOKING_BASENAMES.length, refused }).toEqual({
      candidates: 7,
      refused: [],
    });
  });

  it('CONTROL: the SAME basename inside an adopted root is still Malformed reserved_basename', () => {
    expect(summarize(classify('packages/bc_x/lang_typescript/src/tag_owner.ts', testConfig)).reason).toBe(
      'reserved_basename',
    );
  });

  it('CONTROL: the rule is SCOPED, not deleted — every reserved prefix still refuses inside an adopted root', () => {
    const permitted = RESERVED_LOOKING_BASENAMES.filter(
      (basename) =>
        summarize(classify(`packages/bc_x/lang_typescript/src/${basename}`, testConfig)).reason !==
        'reserved_basename',
    );
    expect({ candidates: RESERVED_LOOKING_BASENAMES.length, permitted }).toEqual({
      candidates: 7,
      permitted: [],
    });
  });
});

describe('OUTSIDE_SEGMENTS may not swallow first-party code — the sdk criterion applied consistently', () => {
  const SWALLOWING_SEGMENTS = ['build', 'target', 'coverage', 'sdk'];

  const RETAINED_SEGMENTS = ['node_modules', 'dist', 'vendor', 'third_party'];

  const FIRST_PARTY_SOURCE_PATHS = [
    'apps/xavier/src/device-lab/build/build-service.ts',
    'apps/sofa/src/calibration/target/cdp-eval.ts',
    'apps/xavier/src/nav-protocol/coverage/metrics.ts',
  ];

  it('drops build, target and coverage from the default table on the criterion sdk already satisfied', () => {
    const segments = new Set(tableEntries(OUTSIDE_SEGMENTS).map(([segment]) => segment));
    const present = SWALLOWING_SEGMENTS.filter((segment) => segments.has(segment));
    expect({ populated: segments.size > 0, present }).toEqual({ populated: true, present: [] });
  });

  it('keeps the four segments that are never first-party source directories', () => {
    const segments = new Set(tableEntries(OUTSIDE_SEGMENTS).map(([segment]) => segment));
    const missing = RETAINED_SEGMENTS.filter((segment) => !segments.has(segment));
    expect(missing).toEqual([]);
  });

  for (const path of FIRST_PARTY_SOURCE_PATHS) {
    it(`leaves the real first-party ${path} NOT Outside`, () => {
      expect(summarize(classify(path, testConfig)).tag).not.toBe('Outside');
    });
  }

  it('CONTROL: an installed-dependency path is still Outside, so the terminal was narrowed not removed', () => {
    const result = summarize(classify('node_modules/effect/dist/Schema.js', testConfig));
    expect({ tag: result.tag, kind: result.kind }).toEqual({
      tag: 'Outside',
      kind: 'installed_dependency',
    });
  });
});

describe('a directory name may not disarm the supersession guard either', () => {
  it('reports superseded_kind for a path carrying BOTH a retired kind and an outside segment', () => {
    expect(
      summarize(classify('bc_Billing/lang_typescript/src/l_domain/node_modules/x.ts', testConfig)).reason,
    ).toBe('superseded_kind');
  });

  it('CONTROL: with no superseded kind on the path, node_modules still terminates as Outside', () => {
    expect(summarize(classify('bc_a/lang_typescript/src/node_modules/x.ts', testConfig)).tag).toBe('Outside');
  });

  it('CONTROL: the two outcomes are DISTINCT for the same outside segment at the same depth', () => {
    expect([
      summarize(classify('bc_a/lang_typescript/src/node_modules/x.ts', testConfig)).tag,
      summarize(classify('bc_a/lang_typescript/src/l_domain/node_modules/x.ts', testConfig)).tag,
    ]).toEqual(['Outside', 'Malformed']);
  });
});

describe('an ANCHOR basename may not disarm the supersession guard either', () => {
  const ANCHOR_BASENAMES_UNDER_TEST = ['README.md', 'package.json', 'Cargo.toml'];

  for (const basename of ANCHOR_BASENAMES_UNDER_TEST) {
    it(`reports superseded_kind for a retired kind on a path ending in ${basename}`, () => {
      const result = summarize(classify(`bc_billing/lang_typescript/src/l_domain/${basename}`, testConfig));
      expect({ basename, tag: result.tag, reason: result.reason, segment: result.segment }).toEqual({
        basename,
        tag: 'Malformed',
        reason: 'superseded_kind',
        segment: 'l_domain',
      });
    });

    it(`CONTROL: with NO retired kind on the path, ${basename} still terminates as Anchor`, () => {
      expect(summarize(classify(`bc_billing/lang_typescript/src/${basename}`, testConfig)).tag).toBe(
        'Anchor',
      );
    });
  }

  it('CONTROL: the two outcomes are DISTINCT for the same anchor basename at the same depth', () => {
    expect([
      summarize(classify('bc_billing/lang_typescript/src/README.md', testConfig)).tag,
      summarize(classify('bc_billing/lang_typescript/src/l_domain/README.md', testConfig)).tag,
    ]).toEqual(['Anchor', 'Malformed']);
  });

  it('sweeps every anchor basename at once, so demoting the precedence for ONE of them cannot pass', () => {
    const suppressed = ANCHOR_BASENAMES_UNDER_TEST.filter(
      (basename) =>
        summarize(classify(`bc_billing/lang_typescript/src/l_domain/${basename}`, testConfig)).reason !==
        'superseded_kind',
    );
    expect({ candidates: ANCHOR_BASENAMES_UNDER_TEST.length, suppressed }).toEqual({
      candidates: 3,
      suppressed: [],
    });
  });

  it('holds when the retired kind sits ABOVE the shell as well as below it', () => {
    expect(summarize(classify('bc_billing/lang_typescript/l_domain/README.md', testConfig)).reason).toBe(
      'superseded_kind',
    );
  });
});

describe('unnormalized_path — a normalization mismatch is LOUD, never a silently green Ungraded', () => {
  it('refuses a LEADING separator rather than accepting it silently', () => {
    const result = summarize(classify('/packages/bc_a/lang_typescript/src/x.ts', testConfig));
    expect({ tag: result.tag, reason: result.reason }).toEqual({
      tag: 'Malformed',
      reason: 'unnormalized_path',
    });
  });

  it('refuses any .. component, because a repo-relative path containing .. is not repo-relative', () => {
    expect(summarize(classify('packages/bc_a/lang_typescript/src/../x.ts', testConfig)).reason).toBe(
      'unnormalized_path',
    );
  });

  it('refuses a BACKSLASH separator, closing the total silent disarm a Windows caller would hit', () => {
    expect(summarize(classify('packages\\bc_a\\lang_typescript\\src\\x.ts', testConfig)).reason).toBe(
      'unnormalized_path',
    );
  });

  it('never reports a Windows-separator path as the GREEN Ungraded terminal', () => {
    expect(summarize(classify('packages\\bc_a\\lang_typescript\\src\\x.ts', testConfig)).tag).not.toBe(
      'Ungraded',
    );
  });

  it('CONTROL: the equivalent NORMALIZED path grades, so the refusal is about the shape not the content', () => {
    expect(summarize(classify('packages/bc_a/lang_typescript/src/x.ts', testConfig))).toEqual({
      tag: 'Graded',
      context: 'a',
      language: 'typescript',
      shellRole: 'source',
    });
  });

  it('CONTROL: an interior doubled separator is deliberately tolerated — only the three named shapes refuse', () => {
    expect(summarize(classify('packages//bc_a//lang_typescript//src//x.ts', testConfig)).tag).toBe('Graded');
  });
});

describe('classification order — Outside and Anchor terminate before anything else', () => {
  it('exports ANCHOR_BASENAMES and OUTSIDE_SEGMENTS as NON-EMPTY ReadonlyMaps, per reference section 11', () => {
    expect({
      anchorIsMap: ANCHOR_BASENAMES instanceof Map,
      outsideIsMap: OUTSIDE_SEGMENTS instanceof Map,
      anchorPopulated: ANCHOR_BASENAMES.size > 0,
      outsidePopulated: OUTSIDE_SEGMENTS.size > 0,
    }).toEqual({
      anchorIsMap: true,
      outsideIsMap: true,
      anchorPopulated: true,
      outsidePopulated: true,
    });
  });

  it('returns undefined for an ABSENT key, which is the soundness a Map buys over a lying Record index', () => {
    expect({
      absentAnchorHas: ANCHOR_BASENAMES.has('definitely-not-an-anchor.txt'),
      absentAnchorGet: ANCHOR_BASENAMES.get('definitely-not-an-anchor.txt') === undefined,
      presentAnchor: ANCHOR_BASENAMES.get('package.json'),
      absentOutsideHas: OUTSIDE_SEGMENTS.has('definitely-not-outside'),
      absentOutsideGet: OUTSIDE_SEGMENTS.get('definitely-not-outside') === undefined,
      presentOutside: OUTSIDE_SEGMENTS.get('node_modules'),
    }).toEqual({
      absentAnchorHas: false,
      absentAnchorGet: true,
      presentAnchor: 'package_manifest',
      absentOutsideHas: false,
      absentOutsideGet: true,
      presentOutside: 'installed_dependency',
    });
  });

  it('gives every ANCHOR_BASENAMES value a kind drawn from the closed AnchorKind set', () => {
    const entries = tableEntries(ANCHOR_BASENAMES);
    const foreign = entries.filter(([, kind]) => !ANCHOR_KIND_SET.has(kind));
    expect({ populated: entries.length > 0, foreignKinds: foreign.map(([basename]) => basename) }).toEqual({
      populated: true,
      foreignKinds: [],
    });
  });

  it('gives every OUTSIDE_SEGMENTS value a kind drawn from the closed OutsideKind set', () => {
    const entries = tableEntries(OUTSIDE_SEGMENTS);
    const foreign = entries.filter(([, kind]) => !OUTSIDE_KIND_SET.has(kind));
    expect({ populated: entries.length > 0, foreignKinds: foreign.map(([segment]) => segment) }).toEqual({
      populated: true,
      foreignKinds: [],
    });
  });

  it('recognises the per-lang_-root manifests the reference section 6 enumerates, and the crate root', () => {
    const table = new Map(tableEntries(ANCHOR_BASENAMES));
    const wrong = DOC_ANCHOR_BASENAMES.filter(([basename, kind]) => table.get(String(basename)) !== kind);
    expect(wrong).toEqual([]);
  });

  it('recognises node_modules and vendor as outside segments, the two the reference names', () => {
    const table = new Map(tableEntries(OUTSIDE_SEGMENTS));
    const wrong = DOC_OUTSIDE_SEGMENTS.filter(([segment, kind]) => table.get(String(segment)) !== kind);
    expect(wrong).toEqual([]);
  });

  it('leaves sdk DELIBERATELY ABSENT from the outside table, so it cannot swallow first-party code', () => {
    const segments = tableEntries(OUTSIDE_SEGMENTS).map(([segment]) => segment);
    expect({ populated: segments.length > 0, hasSdk: segments.includes('sdk') }).toEqual({
      populated: true,
      hasSdk: false,
    });
  });

  it('classifies an installed dependency as Outside rather than Ungraded', () => {
    const result = summarize(classify('node_modules/effect/dist/Schema.js', testConfig));
    expect({ tag: result.tag, kind: result.kind }).toEqual({
      tag: 'Outside',
      kind: 'installed_dependency',
    });
  });

  it('classifies a manifest as an Anchor', () => {
    expect(summarize(classify('packages/bc_uuid_effect/lang_typescript/package.json', testConfig))).toEqual({
      tag: 'Anchor',
      kind: 'package_manifest',
    });
  });

  it('classifies every declared anchor basename as an Anchor carrying the kind the table declares', () => {
    const entries = tableEntries(ANCHOR_BASENAMES);
    const wrong = entries.filter(([basename, kind]) => {
      const result = summarize(classify(`packages/bc_x/lang_typescript/${basename}`, testConfig));
      return result.tag !== 'Anchor' || result.kind !== kind;
    });
    expect({ populated: entries.length > 0, wrong: wrong.map(([basename]) => basename) }).toEqual({
      populated: true,
      wrong: [],
    });
  });

  it('classifies every declared outside segment as Outside carrying the kind the table declares', () => {
    const entries = tableEntries(OUTSIDE_SEGMENTS);
    const wrong = entries.filter(([segment, kind]) => {
      const result = summarize(classify(`${segment}/nested/file.ts`, testConfig));
      return result.tag !== 'Outside' || result.kind !== kind;
    });
    expect({ populated: entries.length > 0, wrong: wrong.map(([segment]) => segment) }).toEqual({
      populated: true,
      wrong: [],
    });
  });
});

describe('classifyParsed — the two entry points are one decision', () => {
  it('classifies a ParsedPath identically to classify, over the corpus and the nonsense inputs', () => {
    const divergent = CLASSIFY_PARITY_INPUTS.filter(
      (input) => !Bun.deepEquals(classifyParsed(parsePath(input, testConfig)), classify(input, testConfig)),
    );
    expect({ inputs: CLASSIFY_PARITY_INPUTS.length > 0, divergent }).toEqual({
      inputs: true,
      divergent: [],
    });
  });

  it('never throws from classifyParsed either, for the same nonsense corpus', () => {
    const failures = NONSENSE_INPUTS.filter((input) => {
      try {
        classifyParsed(parsePath(input, testConfig));
        return false;
      } catch {
        return true;
      }
    });
    expect(failures).toEqual([]);
  });
});
