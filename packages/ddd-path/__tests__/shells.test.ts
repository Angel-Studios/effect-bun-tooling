import { describe, expect, it } from 'bun:test';
import { Effect, Result, SchemaParser } from 'effect';
import {
  decodeGrammarConfig,
  emptyGrammarConfig,
  GRAMMAR_CONFIG_ERROR_REASONS,
  GrammarConfig,
  GrammarConfigError,
  LanguageShell,
  parseGrammarToml,
  ShellMatcher,
  ShellRun,
} from '../src/config';
import { TEST_KINDS } from '../src/grammar';
import { classify } from '../src/parse';
import {
  grammarTomlSource,
  KMP_SOURCE_SETS,
  kmpPath,
  resolvedSummary,
  summarize,
  testConfig,
  XAVIER_FLAVOR_SOURCE_SETS,
  xavierFlavorPath,
} from './fixtures/corpus';

const configErrorReason = (source: string): string | undefined => {
  const outcome = Effect.runSync(Effect.result(parseGrammarToml(source)));
  return Result.isFailure(outcome) ? String(outcome.failure.reason) : undefined;
};

const decodeErrorReason = (input: unknown): string | undefined => {
  const outcome = Effect.runSync(Effect.result(decodeGrammarConfig(input)));
  return Result.isFailure(outcome) ? String(outcome.failure.reason) : undefined;
};

const matcherDecodes = (input: unknown): boolean =>
  Result.isSuccess(SchemaParser.decodeUnknownResult(ShellMatcher)(input));

const runDecodes = (input: unknown): boolean =>
  Result.isSuccess(SchemaParser.decodeUnknownResult(ShellRun)(input));

const languageShellDecodes = (input: unknown): boolean =>
  Result.isSuccess(SchemaParser.decodeUnknownResult(LanguageShell)(input));

const isEffectSchema = (value: unknown): boolean =>
  (typeof value === 'object' || typeof value === 'function') && value !== null && 'ast' in value;

const PLAIN_CONFIG = {
  version: 1,
  shell: {
    typescript: { source: [{ literal: 'src' }], test: [] },
  },
};

const decodedLanguages = (input: unknown): readonly string[] => {
  const outcome = Effect.runSync(Effect.result(decodeGrammarConfig(input)));
  return Result.isSuccess(outcome) ? Object.keys(outcome.success.shell) : [];
};

const DOUBLED_BRACKET_TOML =
  '\nversion = 1\n\n[shell.brightscript]\nextra_source_roots = [[{ literal = "components" }]]\n';

const SPACED_BRACKET_TOML =
  '\nversion = 1\n\n[shell.brightscript]\nsource = [{ literal = "source" }]\nextra_source_roots = [ [{ literal = "components" }] ]\ntest = []\n';

describe('grammar.toml — the DECLARED per-repo shell table', () => {
  it('parses the committed fixture through parseGrammarToml without failing', () => {
    expect({ parsed: testConfig !== undefined, sourceIsNonEmpty: grammarTomlSource.length > 0 }).toEqual({
      parsed: true,
      sourceIsNonEmpty: true,
    });
  });

  it('exposes ShellMatcher, ShellRun, LanguageShell and GrammarConfig as Effect Schemas', () => {
    expect({
      shellMatcher: isEffectSchema(ShellMatcher),
      shellRun: isEffectSchema(ShellRun),
      languageShell: isEffectSchema(LanguageShell),
      grammarConfig: isEffectSchema(GrammarConfig),
    }).toEqual({ shellMatcher: true, shellRun: true, languageShell: true, grammarConfig: true });
  });

  it('decodes all four declared matcher forms and no fifth one', () => {
    expect({
      literal: matcherDecodes({ literal: 'src' }),
      anyOf: matcherDecodes({ any_of: ['main', 'commonMain'] }),
      optionalRun: matcherDecodes({ optional_run: ['com', 'angel', 'xavier'] }),
      context: matcherDecodes({ context: true }),
      contextWithSuffix: matcherDecodes({ context: true, suffix: 'Tests' }),
      undeclaredForm: matcherDecodes({ starts_with: 'src' }),
    }).toEqual({
      literal: true,
      anyOf: true,
      optionalRun: true,
      context: true,
      contextWithSuffix: true,
      undeclaredForm: false,
    });
  });

  it('decodes a ShellRun as an ORDERED list of matchers and a LanguageShell as its runs', () => {
    expect({
      run: runDecodes([{ literal: 'src' }, { any_of: ['main', 'test'] }]),
      notARun: runDecodes({ literal: 'src' }),
      shell: languageShellDecodes({ source: [{ literal: 'src' }], test: [] }),
      badShell: languageShellDecodes({ source: 'src' }),
    }).toEqual({ run: true, notARun: false, shell: true, badShell: false });
  });

  it('decodes an equivalent plain object through decodeGrammarConfig', () => {
    const decoded = Effect.runSync(decodeGrammarConfig(PLAIN_CONFIG));
    expect(decoded !== undefined).toBe(true);
  });

  it('refuses a malformed TOML source with a GrammarConfigError carrying a non-empty reason', () => {
    const reason = configErrorReason('version = \n[shell.typescript\n');
    expect({ failed: reason !== undefined, reasonIsNonEmpty: (reason ?? '').length > 0 }).toEqual({
      failed: true,
      reasonIsNonEmpty: true,
    });
  });

  it('refuses a structurally invalid config with a GrammarConfigError rather than decoding leniently', () => {
    const reason = decodeErrorReason({ version: 1, shell: { typescript: { source: [{ nope: 'src' }] } } });
    expect({ failed: reason !== undefined }).toEqual({ failed: true });
  });

  it('refuses an unknown language key rather than silently widening the closed Language set', () => {
    const reason = decodeErrorReason({ version: 1, shell: { klingon: { source: [{ literal: 'src' }] } } });
    expect({ failed: reason !== undefined }).toEqual({ failed: true });
  });

  it('pins GRAMMAR_CONFIG_ERROR_REASONS to exactly the two reasons reference section 11 declares', () => {
    expect([...GRAMMAR_CONFIG_ERROR_REASONS]).toEqual(['toml_parse_failed', 'schema_violation']);
  });

  it('reaches BOTH declared reasons, so neither is a literal nothing can produce', () => {
    expect({
      tomlParseFailed: configErrorReason('version = \n[shell.typescript\n'),
      schemaViolation: decodeErrorReason({ version: 'one' }),
    }).toEqual({ tomlParseFailed: 'toml_parse_failed', schemaViolation: 'schema_violation' });
  });

  it('surfaces a malformed table as a typed toml_parse_failed rather than a throw', () => {
    const attempt = (): string | undefined => configErrorReason(DOUBLED_BRACKET_TOML);
    expect(attempt).not.toThrow();
    expect(attempt()).toBe('toml_parse_failed');
  });

  it('parses the SPACED bracket form the reference section 4 mandates for extra_source_roots', () => {
    expect(configErrorReason(SPACED_BRACKET_TOML)).toBe(undefined);
  });

  it('refuses an unrecognised FIELD inside a language entry, so a mistyped sources cannot decode green', () => {
    expect(decodeErrorReason({ version: 1, shell: { typescript: { sources: [{ literal: 'src' }] } } })).toBe(
      'schema_violation',
    );
  });

  it('refuses an unrecognised TOP-LEVEL field on the same strict-decode ground', () => {
    expect(decodeErrorReason({ version: 1, shell: {}, shels: {} })).toBe('schema_violation');
  });

  it('requires version, because every worked table in reference section 4 carries it', () => {
    expect(decodeErrorReason({ shell: { typescript: { source: [{ literal: 'src' }] } } })).toBe(
      'schema_violation',
    );
  });

  it('decodes a PARTIAL shell table naming one language, since each language entry is optional', () => {
    expect(decodedLanguages({ version: 1, shell: { rust: { source: [{ literal: 'src' }] } } })).toEqual([
      'rust',
    ]);
  });

  it('decodes an EMPTY shell table, the partial-adoption floor', () => {
    expect(decodedLanguages({ version: 1, shell: {} })).toEqual([]);
  });

  it('ships emptyGrammarConfig as a decodable GrammarConfig declaring no shell at all', () => {
    expect({
      shellKeys: Object.keys(emptyGrammarConfig.shell),
      versionIsInt: Number.isInteger(emptyGrammarConfig.version),
      redecodes: decodeErrorReason(emptyGrammarConfig),
    }).toEqual({ shellKeys: [], versionIsInt: true, redecodes: undefined });
  });

  it('leaves a lang_ root with NO declared shell Malformed file_outside_shell under emptyGrammarConfig', () => {
    expect(summarize(classify('packages/bc_x/lang_typescript/src/tag.ts', emptyGrammarConfig)).reason).toBe(
      'file_outside_shell',
    );
  });

  it('exports GrammarConfigError as the single typed failure of both config entry points', () => {
    const fromToml = Effect.runSync(Effect.result(parseGrammarToml('[[[')));
    const fromDecode = Effect.runSync(Effect.result(decodeGrammarConfig({ version: 'one' })));
    expect({
      tomlFailed: Result.isFailure(fromToml),
      tomlIsConfigError: Result.isFailure(fromToml) && fromToml.failure instanceof GrammarConfigError,
      decodeFailed: Result.isFailure(fromDecode),
      decodeIsConfigError: Result.isFailure(fromDecode) && fromDecode.failure instanceof GrammarConfigError,
    }).toEqual({
      tomlFailed: true,
      tomlIsConfigError: true,
      decodeFailed: true,
      decodeIsConfigError: true,
    });
  });
});

const PLATFORM_SEGMENTS = [
  'src',
  'lib',
  'source',
  'components',
  'Sources',
  'Tests',
  'tests',
  'test',
  'main',
  'java',
  'kotlin',
  'com',
  'angel',
  'xavier',
  'day',
  'harvest',
  ...KMP_SOURCE_SETS,
];

const KIND_PREFIXED_SEGMENTS = [
  'bc_thing',
  'lang_rust',
  't_unit',
  'l_domain',
  'p_port',
  's_uuid',
  'tag_owner',
];

const shellDeclaring = (run: readonly unknown[]): unknown => ({
  version: 1,
  shell: { kotlin: { source: run } },
});

describe('a guard a configuration file can switch off is not a guard — reference section 2', () => {
  it('refuses a kind-prefixed segment named via { literal }, at DECODE time rather than per path', () => {
    expect(decodeErrorReason(shellDeclaring([{ literal: 'l_domain' }]))).toBe('schema_violation');
  });

  it('refuses a kind-prefixed segment named via an ENTRY of { any_of }, not only via { literal }', () => {
    expect(decodeErrorReason(shellDeclaring([{ any_of: ['main', 'p_port'] }]))).toBe('schema_violation');
  });

  it('refuses a kind-prefixed segment named via an ENTRY of { optional_run }, the third naming form', () => {
    expect(decodeErrorReason(shellDeclaring([{ optional_run: ['com', 'tag_owner'] }]))).toBe(
      'schema_violation',
    );
  });

  it('refuses one in a TEST run, so the hole is not left open on the other declared run', () => {
    expect(decodeErrorReason({ version: 1, shell: { kotlin: { test: [{ literal: 'l_domain' }] } } })).toBe(
      'schema_violation',
    );
  });

  it('refuses one in extra_source_roots, so the hole is not left open on the third run slot', () => {
    expect(
      decodeErrorReason({
        version: 1,
        shell: { brightscript: { extra_source_roots: [[{ literal: 's_uuid' }]] } },
      }),
    ).toBe('schema_violation');
  });

  it('refuses EVERY structural and superseded prefix, so declaring l_domain and p_port cannot disarm §0', () => {
    const accepted = KIND_PREFIXED_SEGMENTS.filter(
      (segment) => decodeErrorReason(shellDeclaring([{ literal: segment }])) !== 'schema_violation',
    );
    expect({ candidates: KIND_PREFIXED_SEGMENTS.length, accepted }).toEqual({
      candidates: 7,
      accepted: [],
    });
  });

  it('CONTROL: the committed grammar.toml fixture still decodes, so the refusal broke nothing real', () => {
    expect(configErrorReason(grammarTomlSource)).toBe(undefined);
  });

  it('CONTROL: every real platform directory in either corpus stays legal as a { literal }', () => {
    const refused = PLATFORM_SEGMENTS.filter(
      (segment) => decodeErrorReason(shellDeclaring([{ literal: segment }])) !== undefined,
    );
    expect({ candidates: PLATFORM_SEGMENTS.length, refused }).toEqual({ candidates: 31, refused: [] });
  });

  it('CONTROL: the same platform directories stay legal inside any_of and optional_run', () => {
    expect({
      anyOf: decodeErrorReason(shellDeclaring([{ any_of: [...PLATFORM_SEGMENTS] }])),
      optionalRun: decodeErrorReason(shellDeclaring([{ optional_run: ['com', 'angel', 'xavier'] }])),
      orgPathTwo: decodeErrorReason(shellDeclaring([{ optional_run: ['day', 'harvest'] }])),
    }).toEqual({ anyOf: undefined, optionalRun: undefined, orgPathTwo: undefined });
  });

  it('CONTROL: a segment with no underscore at all is never a kind attempt', () => {
    const refused = ['testXavierDebug', 'commonMain', 'wasmJsMain', 'bcx', 'langs', 'tests'].filter(
      (segment) => decodeErrorReason(shellDeclaring([{ literal: segment }])) !== undefined,
    );
    expect(refused).toEqual([]);
  });

  it('CONTROL: a segment whose prefix is merely UNKNOWN is still legal in a shell run', () => {
    expect(decodeErrorReason(shellDeclaring([{ literal: 'q_foo' }]))).toBe(undefined);
  });
});

const configOf = (input: unknown): GrammarConfig => Effect.runSync(decodeGrammarConfig(input));

describe('TestKind abstains rather than guessing — reference section 9', () => {
  const UNDECLARED_KIND = configOf({
    version: 1,
    shell: { rust: { source: [{ literal: 'src' }], test: [{ literal: 'tests' }] } },
  });

  const DECLARED_KIND = configOf({
    version: 1,
    shell: {
      rust: { source: [{ literal: 'src' }], test: [{ literal: 'tests' }], test_kind: 'integration' },
    },
  });

  it('carries unassigned in the closed TestKind set, so the terminal is DECLARED rather than invented', () => {
    expect([...TEST_KINDS].includes('unassigned')).toBe(true);
  });

  it('yields Test { kind: unassigned } where a test run is declared with NO test_kind', () => {
    expect(summarize(classify('bc_a/lang_rust/tests/foo.rs', UNDECLARED_KIND))).toEqual({
      tag: 'Test',
      context: 'a',
      language: 'rust',
      kind: 'unassigned',
    });
  });

  it('never silently defaults a Cargo integration-test root to unit, which nobody declared', () => {
    expect(summarize(classify('bc_a/lang_rust/tests/foo.rs', UNDECLARED_KIND)).kind).not.toBe('unit');
  });

  it('CONTROL: a DECLARED test_kind is still honoured, so abstention did not replace the declaration', () => {
    expect(summarize(classify('bc_a/lang_rust/tests/foo.rs', DECLARED_KIND)).kind).toBe('integration');
  });

  it('CONTROL: the committed fixture declares test_kind for rust, so its corpus rows stay integration', () => {
    expect(
      summarize(classify('tools/av1rt/crates/bc_av1rt_quality/lang_rust/tests/vmaf_smoke.rs', testConfig))
        .kind,
    ).toBe('integration');
  });
});

describe('shell resolution — harvest/kmp @ 1e7d64f, fifteen Kotlin Multiplatform source sets', () => {
  it('declares exactly the fifteen source sets the reference measured, so a dropped entry reddens', () => {
    expect([...KMP_SOURCE_SETS]).toEqual([
      'commonMain',
      'commonTest',
      'androidMain',
      'androidHostTest',
      'iosMain',
      'iosTest',
      'iosArm64Main',
      'iosSimulatorArm64Main',
      'jsMain',
      'jsTest',
      'jvmMain',
      'jvmTest',
      'wasmJsMain',
      'wasmJsTest',
      'webMain',
    ]);
  });

  for (const sourceSet of KMP_SOURCE_SETS) {
    it(`resolves the declared kotlin shell over the ${sourceSet} source set`, () => {
      expect({ sourceSet, ...resolvedSummary(classify(kmpPath(sourceSet), testConfig)) }).toEqual({
        sourceSet,
        resolved: true,
        context: 'shared',
        language: 'kotlin',
      });
    });
  }

  it('resolves ALL fifteen and counts fifteen, so a silently-dropped source set reddens twice', () => {
    const resolved = KMP_SOURCE_SETS.filter(
      (sourceSet) => resolvedSummary(classify(kmpPath(sourceSet), testConfig)).resolved,
    );
    expect([...resolved]).toEqual([...KMP_SOURCE_SETS]);
    expect(resolved.length).toBe(15);
  });
});

describe('shell resolution — project-xavier @ 444244199, Gradle flavor source sets', () => {
  it('declares exactly the five flavor source sets the reference measured', () => {
    expect([...XAVIER_FLAVOR_SOURCE_SETS]).toEqual([
      'main',
      'test',
      'xavierDebug',
      'xavierRelease',
      'testXavierDebug',
    ]);
  });

  for (const sourceSet of XAVIER_FLAVOR_SOURCE_SETS) {
    it(`resolves the declared kotlin shell over the ${sourceSet} flavor source set`, () => {
      expect({ sourceSet, ...resolvedSummary(classify(xavierFlavorPath(sourceSet), testConfig)) }).toEqual({
        sourceSet,
        resolved: true,
        context: 'nav_protocol',
        language: 'kotlin',
      });
    });
  }

  it('resolves ALL five and counts five', () => {
    const resolved = XAVIER_FLAVOR_SOURCE_SETS.filter(
      (sourceSet) => resolvedSummary(classify(xavierFlavorPath(sourceSet), testConfig)).resolved,
    );
    expect([...resolved]).toEqual([...XAVIER_FLAVOR_SOURCE_SETS]);
    expect(resolved.length).toBe(5);
  });

  it('refuses a source set the table never declared, rather than guessing a shell', () => {
    expect(resolvedSummary(classify(xavierFlavorPath('flavorNobodyDeclared'), testConfig)).resolved).toBe(
      false,
    );
  });
});

describe('the four matcher forms', () => {
  it('literal consumes exactly its own segment (typescript src)', () => {
    expect(summarize(classify('packages/bc_uuid_effect/lang_typescript/src/tag.ts', testConfig))).toEqual({
      tag: 'Graded',
      context: 'uuid_effect',
      language: 'typescript',
      shellRole: 'source',
    });
  });

  it('any_of consumes one segment from the declared set and no other', () => {
    expect(resolvedSummary(classify(kmpPath('commonMain'), testConfig)).resolved).toBe(true);
    expect(resolvedSummary(classify(kmpPath('commonMainish'), testConfig)).resolved).toBe(false);
  });

  it('optional_run consumes the whole org package path when it is PRESENT (day/harvest)', () => {
    expect(
      resolvedSummary(
        classify(
          'modules/domain/bc_sdui/lang_kotlin/src/commonMain/kotlin/day/harvest/sdui/model/SurfaceId.kt',
          testConfig,
        ),
      ),
    ).toEqual({ resolved: true, context: 'sdui', language: 'kotlin' });
  });

  it('optional_run consumes nothing when the org package path is ABSENT (build-logic)', () => {
    expect(
      resolvedSummary(
        classify('bc_build_logic/lang_kotlin/src/test/kotlin/DomainBoundaryGuardTest.kt', testConfig),
      ),
    ).toEqual({ resolved: true, context: 'build_logic', language: 'kotlin' });
  });

  it('optional_run is all-or-nothing: a PARTIAL prefix of the run still resolves rather than half-consuming', () => {
    expect(
      resolvedSummary(
        classify('modules/bc_shared/lang_kotlin/src/main/kotlin/com/angel/Thing.kt', testConfig),
      ),
    ).toEqual({ resolved: true, context: 'shared', language: 'kotlin' });
  });

  it('{ context = true } expands to the enclosing bc_ segment NAME, per reference section 4', () => {
    expect(
      summarize(classify('apps/bc_ios_app/lang_swift/Sources/ios_app/ContentView.swift', testConfig)),
    ).toEqual({ tag: 'Graded', context: 'ios_app', language: 'swift', shellRole: 'source' });
  });

  it('{ context = true, suffix = "Tests" } expands to the context name plus the declared suffix', () => {
    expect(
      summarize(classify('apps/bc_ios_app/lang_swift/Tests/ios_appTests/ContentViewTests.swift', testConfig)),
    ).toEqual({ tag: 'Test', context: 'ios_app', language: 'swift', kind: 'unit' });
  });

  it('binds no LCD rule to a SHELL segment — Sources, commonMain and testXavierDebug all carry capitals', () => {
    const capitalised = [
      'apps/bc_ios_app/lang_swift/Sources/ios_app/ContentView.swift',
      'modules/bc_shared/lang_kotlin/src/commonMain/kotlin/day/harvest/x.kt',
      'packages/bc_nav_protocol/lang_kotlin/src/testXavierDebug/java/com/angel/xavier/x.kt',
    ];
    const refused = capitalised.filter((path) => summarize(classify(path, testConfig)).tag === 'Malformed');
    expect({ candidates: capitalised.length, refused }).toEqual({ candidates: 3, refused: [] });
  });

  it('{ context = true } refuses a target directory that is not the context name', () => {
    expect(
      resolvedSummary(
        classify('apps/bc_ios_app/lang_swift/Sources/SomeOtherTarget/ContentView.swift', testConfig),
      ).resolved,
    ).toBe(false);
  });

  it('extra_source_roots declares a second source run (Roku components/ beside source/)', () => {
    expect(
      summarize(
        classify(
          'tools/overlap-vision/bc_roku_board_app/lang_brightscript/components/BoardScene.brs',
          testConfig,
        ),
      ),
    ).toEqual({
      tag: 'Graded',
      context: 'roku_board_app',
      language: 'brightscript',
      shellRole: 'source',
    });
  });

  it('a declared test shell supplies its implied kind where the platform mandates an unnestable root', () => {
    expect(
      summarize(classify('tools/av1rt/crates/bc_av1rt_quality/lang_rust/tests/vmaf_smoke.rs', testConfig)),
    ).toEqual({ tag: 'Test', context: 'av1rt_quality', language: 'rust', kind: 'integration' });
  });

  it('a grammar token found BELOW a consumed shell is Malformed token_below_shell', () => {
    expect(summarize(classify('packages/bc_x/lang_typescript/src/t_unit/helper.ts', testConfig)).reason).toBe(
      'token_below_shell',
    );
  });

  it('a lang_ segment with no consumed shell and no anchor is Malformed file_outside_shell', () => {
    expect(summarize(classify('packages/bc_x/lang_typescript/nowhere/helper.ts', testConfig)).reason).toBe(
      'file_outside_shell',
    );
  });
});
