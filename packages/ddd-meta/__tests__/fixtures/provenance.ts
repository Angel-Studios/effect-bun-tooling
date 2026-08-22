import type { CarrierName } from '../../src/carrier.ts';
import type { ExclusionReason } from '../../src/exclude.ts';

export const FIXTURE_SUFFIX = '.fixture';

export type FixtureProvenance = {
  readonly fixture: string;
  readonly carrier: CarrierName;
  readonly classifierPath: string;
  readonly origin: string;
  readonly originRepository: string;
  readonly derivedLines: number;
  readonly carriesFrontMatter: boolean;
};

export const REAL_FIXTURES: readonly FixtureProvenance[] = [
  {
    fixture: 'block/sweep.ts.fixture',
    carrier: 'block',
    classifierPath: 'packages/fixture-residue/src/sweep.ts',
    origin: '/Users/ai/Documents/effect-bun-tooling/packages/fixture-residue/src/sweep.ts',
    originRepository: 'effect-bun-tooling',
    derivedLines: 13,
    carriesFrontMatter: false,
  },
  {
    fixture: 'block/protocol.rs.fixture',
    carrier: 'block',
    classifierPath: 'apps/sofa-bt-hid/crates/sofa-bt-hid/src/protocol.rs',
    origin: '/Users/ai/Documents/project-xavier/apps/sofa-bt-hid/crates/sofa-bt-hid/src/protocol.rs',
    originRepository: 'project-xavier',
    derivedLines: 13,
    carriesFrontMatter: false,
  },
  {
    fixture: 'block/AdminApplication.kt.fixture',
    carrier: 'block',
    classifierPath: 'apps/adminServer/src/main/kotlin/day/harvest/admin/AdminApplication.kt',
    origin:
      '/Users/ai/Documents/harvest/kmp/apps/adminServer/src/main/kotlin/day/harvest/admin/AdminApplication.kt',
    originRepository: 'harvest/kmp',
    derivedLines: 12,
    carriesFrontMatter: false,
  },
  {
    fixture: 'block/iOSApp.swift.fixture',
    carrier: 'block',
    classifierPath: 'apps/iosApp/iosApp/iOSApp.swift',
    origin: '/Users/ai/Documents/harvest/kmp/apps/iosApp/iosApp/iOSApp.swift',
    originRepository: 'harvest/kmp',
    derivedLines: 9,
    carriesFrontMatter: false,
  },
  {
    fixture: 'block/global.css.fixture',
    carrier: 'block',
    classifierPath: 'apps/rectilinear-calibrator/src/global.css',
    origin: '/Users/ai/Documents/project-xavier/apps/rectilinear-calibrator/src/global.css',
    originRepository: 'project-xavier',
    derivedLines: 13,
    carriesFrontMatter: false,
  },
  {
    fixture: 'hash/cli.ex.fixture',
    carrier: 'hash',
    classifierPath: 'tools/nvenc-lab/direct-sdk/elixir/lib/nvenc_lab/cli.ex',
    origin: '/Users/ai/Documents/project-xavier/tools/nvenc-lab/direct-sdk/elixir/lib/nvenc_lab/cli.ex',
    originRepository: 'project-xavier',
    derivedLines: 12,
    carriesFrontMatter: false,
  },
  {
    fixture: 'hash/scenedetect-wrapper.py.fixture',
    carrier: 'hash',
    classifierPath: 'apps/cerebro/python/scenedetect-wrapper.py',
    origin: '/Users/ai/Documents/project-xavier/apps/cerebro/python/scenedetect-wrapper.py',
    originRepository: 'project-xavier',
    derivedLines: 11,
    carriesFrontMatter: false,
  },
  {
    fixture: 'hash/_lib-tokenize.sh.fixture',
    carrier: 'hash',
    classifierPath: '.claude/hooks/_lib-tokenize.sh',
    origin: '/Users/ai/Documents/project-xavier/.claude/hooks/_lib-tokenize.sh',
    originRepository: 'project-xavier',
    derivedLines: 14,
    carriesFrontMatter: false,
  },
  {
    fixture: 'hash/bunfig.toml.fixture',
    carrier: 'hash',
    classifierPath: 'bunfig.toml',
    origin: '/Users/ai/Documents/effect-bun-tooling/bunfig.toml',
    originRepository: 'effect-bun-tooling',
    derivedLines: 12,
    carriesFrontMatter: false,
  },
  {
    fixture: 'apostrophe/AttachButton.brs.fixture',
    carrier: 'apostrophe',
    classifierPath: 'packages/nav-protocol-roku-instrumentation/src/__fixtures__/AttachButton.brs',
    origin:
      '/Users/ai/Documents/project-xavier/packages/nav-protocol-roku-instrumentation/src/__fixtures__/AttachButton.brs',
    originRepository: 'project-xavier',
    derivedLines: 12,
    carriesFrontMatter: false,
  },
  {
    fixture: 'xml/LoginModalComponent.xml.fixture',
    carrier: 'xml',
    classifierPath:
      'apps/xavier/src/nav-protocol/exploration/frontier-store/__test__/__fixtures__/angel-roku/components/modals/LoginModalComponent.xml',
    origin:
      '/Users/ai/Documents/project-xavier/apps/xavier/src/nav-protocol/exploration/frontier-store/__test__/__fixtures__/angel-roku/components/modals/LoginModalComponent.xml',
    originRepository: 'project-xavier',
    derivedLines: 8,
    carriesFrontMatter: false,
  },
  {
    fixture: 'xml/Counter.svelte.fixture',
    carrier: 'xml',
    classifierPath: 'packages/bun-svelte-test/__test__/fixtures/Counter.svelte',
    origin:
      '/Users/ai/Documents/effect-bun-tooling/packages/bun-svelte-test/__test__/fixtures/Counter.svelte',
    originRepository: 'effect-bun-tooling',
    derivedLines: 12,
    carriesFrontMatter: false,
  },
  {
    fixture: 'xml/README.md.fixture',
    carrier: 'xml',
    classifierPath: 'README.md',
    origin: '/Users/ai/Documents/effect-bun-tooling/README.md',
    originRepository: 'effect-bun-tooling',
    derivedLines: 12,
    carriesFrontMatter: false,
  },
];

export const NOT_EXPRESSIBLE_EXTENSIONS: readonly string[] = ['.xml', '.svg'];

export const CARRIED_REAL_FIXTURES: readonly FixtureProvenance[] = REAL_FIXTURES.filter(
  (provenance) => !NOT_EXPRESSIBLE_EXTENSIONS.some((ext) => provenance.classifierPath.endsWith(ext)),
);

export type CaseOutcome =
  | 'FrontMatter'
  | 'NoFrontMatter'
  | 'UnterminatedBlock'
  | 'CarrierLinePrefixMissing'
  | 'EmptyPayload'
  | 'TomlSyntax'
  | 'SchemaDecode'
  | 'PayloadMovesHostCommentEnd'
  | 'MisplacedFrontMatter'
  | 'DuplicateFrontMatter';

export type CaseFixture = {
  readonly fixture: string;
  readonly carrier: CarrierName;
  readonly classifierPath: string;
  readonly expected: CaseOutcome;
  readonly expectedLine: number;
};

export const CASE_FIXTURES: readonly CaseFixture[] = [
  {
    fixture: 'cases/misplaced.rs.fixture',
    carrier: 'block',
    classifierPath: 'crates/thing/src/misplaced.rs',
    expected: 'MisplacedFrontMatter',
    expectedLine: 5,
  },
  {
    fixture: 'cases/duplicate.sh.fixture',
    carrier: 'hash',
    classifierPath: 'hooks/duplicate.sh',
    expected: 'DuplicateFrontMatter',
    expectedLine: 6,
  },
  {
    fixture: 'cases/unterminated.ts.fixture',
    carrier: 'block',
    classifierPath: 'src/unterminated.ts',
    expected: 'UnterminatedBlock',
    expectedLine: 1,
  },
  {
    fixture: 'cases/prefix-missing.py.fixture',
    carrier: 'hash',
    classifierPath: 'python/prefix-missing.py',
    expected: 'CarrierLinePrefixMissing',
    expectedLine: 4,
  },
  {
    fixture: 'cases/empty-payload.css.fixture',
    carrier: 'block',
    classifierPath: 'src/empty-payload.css',
    expected: 'EmptyPayload',
    expectedLine: 1,
  },
  {
    fixture: 'cases/toml-syntax.kt.fixture',
    carrier: 'block',
    classifierPath: 'src/main/kotlin/TomlSyntax.kt',
    expected: 'TomlSyntax',
    expectedLine: 1,
  },
  {
    fixture: 'cases/forbidden-key.ts.fixture',
    carrier: 'block',
    classifierPath: 'src/forbidden-key.ts',
    expected: 'SchemaDecode',
    expectedLine: 1,
  },
  {
    fixture: 'cases/unsorted-tags.brs.fixture',
    carrier: 'apostrophe',
    classifierPath: 'components/unsorted-tags.brs',
    expected: 'SchemaDecode',
    expectedLine: 1,
  },
  {
    fixture: 'cases/host-comment-close.ts.fixture',
    carrier: 'block',
    classifierPath: 'src/host-comment-close.ts',
    expected: 'PayloadMovesHostCommentEnd',
    expectedLine: 3,
  },
  {
    fixture: 'cases/carried.xml.fixture',
    carrier: 'xml',
    classifierPath: 'components/carried.xml',
    expected: 'FrontMatter',
    expectedLine: 2,
  },
  {
    fixture: 'cases/machine-read-preamble.ts.fixture',
    carrier: 'block',
    classifierPath: 'src/machine-read-preamble.ts',
    expected: 'FrontMatter',
    expectedLine: 2,
  },
  {
    fixture: 'cases/yaml-block-scalar.md.fixture',
    carrier: 'xml',
    classifierPath: 'docs/yaml-block-scalar.md',
    expected: 'NoFrontMatter',
    expectedLine: 0,
  },
  {
    fixture: 'cases/no-front-matter.md.fixture',
    carrier: 'xml',
    classifierPath: 'docs/no-front-matter.md',
    expected: 'NoFrontMatter',
    expectedLine: 0,
  },
  {
    fixture: 'cases/crlf.toml.fixture',
    carrier: 'hash',
    classifierPath: 'crlf.toml',
    expected: 'FrontMatter',
    expectedLine: 1,
  },
];

export type ExcludedPathExpectation = {
  readonly path: string;
  readonly reason: ExclusionReason;
};

export const EXCLUDED_PATHS: readonly ExcludedPathExpectation[] = [
  { path: 'packages/ddd-meta/dist/parse.js', reason: 'generated' },
  { path: 'node_modules/effect/dist/Schema.js', reason: 'generated' },
  { path: 'bun.lock', reason: 'generated' },
  { path: 'apps/iosApp/Pods/Alamofire/Source/Alamofire.swift', reason: 'vendored' },
  { path: 'third_party/zlib/zlib.c', reason: 'vendored' },
  { path: 'vendor/dist/thing.ts', reason: 'vendored' },
  { path: '.gitignore', reason: 'unowned' },
  { path: '.editorconfig', reason: 'unowned' },
  { path: 'package.json', reason: 'comment_incapable' },
  { path: 'LICENSE', reason: 'comment_incapable' },
  { path: 'assets/logo.png', reason: 'comment_incapable' },
  { path: 'components/LoginModal.xml', reason: 'carrier_not_expressible' },
  { path: 'assets/icon.svg', reason: 'carrier_not_expressible' },
  { path: 'Makefile', reason: 'no_carrier_declared' },
  { path: 'docs/notes', reason: 'no_carrier_declared' },
];

export type CarriedPathExpectation = {
  readonly path: string;
  readonly carrier: CarrierName;
};

export const CARRIED_PATHS: readonly CarriedPathExpectation[] = [
  { path: 'distribution/release.ts', carrier: 'block' },
  { path: 'packages/outer/src/build-tools.rs', carrier: 'block' },
  { path: 'scripts/deploy.sh', carrier: 'hash' },
  { path: 'Cargo.toml', carrier: 'hash' },
  { path: 'components/Button.brs', carrier: 'apostrophe' },
  { path: 'README.md', carrier: 'xml' },
  { path: 'src/App.svelte', carrier: 'xml' },
];
