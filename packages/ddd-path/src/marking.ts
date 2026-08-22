import type { TacticalPattern } from './grammar.ts';

export type Falsifiability = 'falsifiable' | 'unfalsifiable';

export type MarkingHome = 'path' | 'front_matter' | 'ast_fact';

export type KindMarking = {
  readonly kind: string;
  readonly falsifiability: Falsifiability;
  readonly home: MarkingHome;
  readonly oracle: string;
  readonly partialRefutation?: string;
};

const PATH_KIND_MARKINGS: readonly KindMarking[] = [
  {
    kind: 'bc',
    falsifiability: 'unfalsifiable',
    home: 'path',
    oracle: 'a context boundary is a human decision; nothing in the code says where one ends',
  },
  {
    kind: 'lang',
    falsifiability: 'falsifiable',
    home: 'path',
    oracle: 'file extensions below the root contradict the declared language',
  },
  {
    kind: 't',
    falsifiability: 'unfalsifiable',
    home: 'path',
    oracle:
      'unit vs integration vs e2e is intent no AST distinguishes, and a t_support or t_fixture tree ' +
      'carries no test registration call by definition, so no refutation applies to those two',
    partialRefutation: 'a t_unit / t_integration / t_e2e tree containing no test registration call',
  },
];

const FRONT_MATTER_KIND_MARKINGS: readonly KindMarking[] = [
  {
    kind: 'l',
    falsifiability: 'unfalsifiable',
    home: 'front_matter',
    oracle: '`domain` vs `application` for two runtime-free modules is intent',
    partialRefutation:
      'a module in `domain` importing `node:*`, `bun:*` or a non-`effect` third-party runtime',
  },
  {
    kind: 'p',
    falsifiability: 'unfalsifiable',
    home: 'front_matter',
    oracle: 'a class with an id field is not thereby an Entity; a struct is not thereby a Value Object',
    partialRefutation: 'per-value, for the four structural literals only',
  },
  {
    kind: 'subdomain',
    falsifiability: 'unfalsifiable',
    home: 'front_matter',
    oracle: 'pure strategic judgment about what the business competes on',
  },
  {
    kind: 'tags',
    falsifiability: 'unfalsifiable',
    home: 'front_matter',
    oracle: 'arbitrary metadata by design',
  },
  {
    kind: 'owner',
    falsifiability: 'unfalsifiable',
    home: 'front_matter',
    oracle: 'organizational fact',
  },
  {
    kind: 'oncall',
    falsifiability: 'unfalsifiable',
    home: 'front_matter',
    oracle: 'organizational fact',
  },
  {
    kind: 'data_classification',
    falsifiability: 'unfalsifiable',
    home: 'front_matter',
    oracle: 'a legal and design judgment',
  },
  {
    kind: 'tier',
    falsifiability: 'unfalsifiable',
    home: 'front_matter',
    oracle: 'operational intent',
  },
  {
    kind: 'criticality',
    falsifiability: 'unfalsifiable',
    home: 'front_matter',
    oracle: 'operational intent',
  },
  {
    kind: 'deprecation',
    falsifiability: 'unfalsifiable',
    home: 'front_matter',
    oracle: 'intent plus a date',
  },
  {
    kind: 'external_links',
    falsifiability: 'unfalsifiable',
    home: 'front_matter',
    oracle: 'a pointer, not a property',
  },
  {
    kind: 'review_status',
    falsifiability: 'unfalsifiable',
    home: 'front_matter',
    oracle: 'process state',
  },
];

const AST_FACT_KIND_MARKINGS: readonly KindMarking[] = [
  {
    kind: 'exports',
    falsifiability: 'falsifiable',
    home: 'ast_fact',
    oracle: 'the exported declarations the module actually carries',
  },
  {
    kind: 'imports',
    falsifiability: 'falsifiable',
    home: 'ast_fact',
    oracle: 'the import specifiers the module actually resolves',
  },
  {
    kind: 'dependencies',
    falsifiability: 'falsifiable',
    home: 'ast_fact',
    oracle: 'the manifest read against the resolved import graph',
  },
  {
    kind: 'effect_service',
    falsifiability: 'falsifiable',
    home: 'ast_fact',
    oracle: 'a `Context.Service` declaration in the module',
  },
  {
    kind: 'effect_layer',
    falsifiability: 'falsifiable',
    home: 'ast_fact',
    oracle: 'a `Layer` construction in the module',
  },
  {
    kind: 'loc',
    falsifiability: 'falsifiable',
    home: 'ast_fact',
    oracle: 'a line count over the file',
  },
  {
    kind: 'language',
    falsifiability: 'falsifiable',
    home: 'ast_fact',
    oracle: 'the file extensions below the root and the parser that accepts them',
  },
  {
    kind: 'complexity',
    falsifiability: 'falsifiable',
    home: 'ast_fact',
    oracle: 'a control-flow measure over the parsed body',
  },
  {
    kind: 'coverage',
    falsifiability: 'falsifiable',
    home: 'ast_fact',
    oracle: 'an instrumented test run over the file',
  },
  {
    kind: 'type_signatures',
    falsifiability: 'falsifiable',
    home: 'ast_fact',
    oracle: 'the checker types of the exported declarations',
  },
  {
    kind: 'error_types',
    falsifiability: 'falsifiable',
    home: 'ast_fact',
    oracle: 'the error channel of every exported Effect signature',
  },
  {
    kind: 'call_edges',
    falsifiability: 'falsifiable',
    home: 'ast_fact',
    oracle: 'the resolved call sites in the parsed body',
  },
  {
    kind: 'service_unit',
    falsifiability: 'falsifiable',
    home: 'ast_fact',
    oracle: 'a `Context.Service` or `Tag` declaration with a `Layer` provided for it',
  },
];

export const KIND_MARKINGS: readonly KindMarking[] = [
  ...PATH_KIND_MARKINGS,
  ...FRONT_MATTER_KIND_MARKINGS,
  ...AST_FACT_KIND_MARKINGS,
];

const BY_KIND: ReadonlyMap<string, KindMarking> = new Map(
  KIND_MARKINGS.map((marking) => [marking.kind, marking]),
);

export const markingOf = (kind: string): KindMarking | undefined => BY_KIND.get(kind);

export type FrontMatterEligibility = 'legitimate' | 'forbidden' | 'unmarked';

export const frontMatterEligibility = (kind: string): FrontMatterEligibility => {
  const marking = markingOf(kind);
  if (marking === undefined) return 'unmarked';
  return marking.home === 'front_matter' ? 'legitimate' : 'forbidden';
};

export const isForbiddenInFrontMatter = (kind: string): boolean =>
  frontMatterEligibility(kind) !== 'legitimate';

export const FRONT_MATTER_LEGITIMATE_KINDS: readonly string[] = KIND_MARKINGS.filter(
  (marking) => marking.home === 'front_matter',
).map((marking) => marking.kind);

export const PATTERN_REFUTATIONS: Readonly<Record<TacticalPattern, string | undefined>> = {
  entity: undefined,
  value_object: undefined,
  aggregate: undefined,
  aggregate_root: undefined,
  domain_event: undefined,
  domain_service: undefined,
  application_service: undefined,
  repository: undefined,
  factory: undefined,
  specification: undefined,
  policy: undefined,
  saga: undefined,
  module: undefined,
  read_model: undefined,
  port: 'an exported runtime binding that is neither a `Context.Service`/`Tag` declaration nor a `Schema` — an implementation living in the port module',
  adapter: 'importing nothing external',
  test_double: 'exporting no `Layer` and no stand-in',
  barrel: 'any non-re-export declaration in the module',
  unassigned: undefined,
};

export type Abstention = { readonly path: string; readonly reason: string };

export const ABSTENTION_FLOOR: readonly Abstention[] = [
  {
    path: 'packages/bun-svelte-test/src/checked-pseudo.ts',
    reason: "monkey-patches happy-dom's `QuerySelector`/`SelectorItem` internals; a patch is not an adapter",
  },
  {
    path: 'packages/effect-bun-test/src/utils.ts',
    reason: 'twenty wrappers over `node:assert`',
  },
  {
    path: 'packages/bun-svelte-test/src/mount.ts',
    reason: "twenty-six lines of thin call-through around svelte's `mount`/`unmount`",
  },
  {
    path: 'packages/fixture-residue/src/sweep.ts',
    reason: 'spans four layers in one 180-line file',
  },
  {
    path: 'packages/effect-test-kit/src/tagged.ts',
    reason: 'pure functions over `Cause`/`Exit`/`Result`/`Option`; nothing to layer',
  },
  {
    path: 'packages/effect-bun-test/src/fixture-root-suite.ts',
    reason: 'a suite wrapper; it is what it is',
  },
];
