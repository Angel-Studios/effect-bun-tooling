import { describe, expect, it } from 'bun:test';
import { classify } from '../src/parse';
import type { CorpusRow } from './fixtures/corpus';
import { summarize, testConfig } from './fixtures/corpus';

const runRow = (row: CorpusRow): void => {
  it(`preserves the tail ${row.tailBelowShell} verbatim below the shell of ${row.real}`, () => {
    expect({
      real: row.real.endsWith(row.tailBelowShell),
      migrated: row.migrated.endsWith(row.tailBelowShell),
    }).toEqual({ real: true, migrated: true });
  });

  it(`classifies the migrated form of ${row.real} exactly as the reference section 5 records`, () => {
    expect(summarize(classify(row.migrated, testConfig))).toEqual(row.expected);
  });

  it(`leaves the UNMIGRATED ${row.real} on a GREEN terminal, never Malformed`, () => {
    const tag = summarize(classify(row.real, testConfig)).tag;
    expect({ path: row.real, tag, isGreen: ['Ungraded', 'Anchor', 'Outside'].includes(tag) }).toEqual({
      path: row.real,
      tag,
      isGreen: true,
    });
  });
};

describe('legality — project-xavier @ commit 444244199, read-only corpus, Rust', () => {
  const ROWS: readonly CorpusRow[] = [
    {
      real: 'packages/napi-avahi-client/src/lib.rs',
      migrated: 'packages/bc_napi_avahi_client/lang_rust/src/lib.rs',
      tailBelowShell: 'lib.rs',
      expected: { tag: 'Anchor', kind: 'crate_root' },
    },
    {
      real: 'tools/av1rt/crates/av1rt-quality/tests/vmaf_smoke.rs',
      migrated: 'tools/av1rt/crates/bc_av1rt_quality/lang_rust/tests/vmaf_smoke.rs',
      tailBelowShell: 'vmaf_smoke.rs',
      expected: { tag: 'Test', context: 'av1rt_quality', language: 'rust', kind: 'integration' },
    },
  ];

  for (const row of ROWS) runRow(row);

  it('mints no t_ segment for the Cargo-mandated unnestable tests/ root', () => {
    expect(
      summarize(classify('tools/av1rt/crates/bc_av1rt_quality/lang_rust/tests/vmaf_smoke.rs', testConfig))
        .kind,
    ).toBe('integration');
  });
});

describe('legality — project-xavier @ commit 444244199, Kotlin Gradle flavor source sets', () => {
  const ROWS: readonly CorpusRow[] = [
    {
      real: 'packages/nav-protocol-jetpack-compose-runtime/src/main/java/com/angel/xavier/api/NavCoord.kt',
      migrated:
        'packages/bc_nav_protocol_jetpack_compose_runtime/lang_kotlin/src/main/java/com/angel/xavier/api/NavCoord.kt',
      tailBelowShell: 'api/NavCoord.kt',
      expected: {
        tag: 'Graded',
        context: 'nav_protocol_jetpack_compose_runtime',
        language: 'kotlin',
        shellRole: 'source',
      },
    },
    {
      real: 'packages/nav-protocol-jetpack-compose-runtime/src/testXavierDebug/java/com/angel/xavier/end2end/CorpusEmitterTest.kt',
      migrated:
        'packages/bc_nav_protocol_jetpack_compose_runtime/lang_kotlin/src/testXavierDebug/java/com/angel/xavier/end2end/CorpusEmitterTest.kt',
      tailBelowShell: 'end2end/CorpusEmitterTest.kt',
      expected: {
        tag: 'Test',
        context: 'nav_protocol_jetpack_compose_runtime',
        language: 'kotlin',
        kind: 'unit',
      },
    },
  ];

  for (const row of ROWS) runRow(row);
});

describe('legality — project-xavier @ commit 444244199, BrightScript Roku channel', () => {
  const ROWS: readonly CorpusRow[] = [
    {
      real: 'tools/overlap-vision/roku-board-app/source/board_geom.brs',
      migrated: 'tools/overlap-vision/bc_roku_board_app/lang_brightscript/source/board_geom.brs',
      tailBelowShell: 'board_geom.brs',
      expected: {
        tag: 'Graded',
        context: 'roku_board_app',
        language: 'brightscript',
        shellRole: 'source',
      },
    },
    {
      real: 'tools/overlap-vision/roku-board-app/components/BoardScene.brs',
      migrated: 'tools/overlap-vision/bc_roku_board_app/lang_brightscript/components/BoardScene.brs',
      tailBelowShell: 'BoardScene.brs',
      expected: {
        tag: 'Graded',
        context: 'roku_board_app',
        language: 'brightscript',
        shellRole: 'source',
      },
    },
  ];

  for (const row of ROWS) runRow(row);

  it('attributes a language by the lang_ segment and NEVER by file extension', () => {
    expect(
      summarize(
        classify(
          'packages/bc_nav_protocol_roku_instrumentation/lang_typescript/src/__fixtures__/BoardScene.brs',
          testConfig,
        ),
      ).language,
    ).toBe('typescript');
  });
});

describe('legality — project-xavier @ commit 444244199, Elixir', () => {
  const ROWS: readonly CorpusRow[] = [
    {
      real: 'tools/nvenc-lab/direct-sdk/elixir/lib/nvenc_lab/cli.ex',
      migrated: 'tools/nvenc-lab/direct-sdk/bc_nvenc_lab/lang_elixir/lib/nvenc_lab/cli.ex',
      tailBelowShell: 'nvenc_lab/cli.ex',
      expected: { tag: 'Graded', context: 'nvenc_lab', language: 'elixir', shellRole: 'source' },
    },
    {
      real: 'tools/nvenc-lab/direct-sdk/elixir/test/nvenc_lab_test.exs',
      migrated: 'tools/nvenc-lab/direct-sdk/bc_nvenc_lab/lang_elixir/test/nvenc_lab_test.exs',
      tailBelowShell: 'nvenc_lab_test.exs',
      expected: { tag: 'Test', context: 'nvenc_lab', language: 'elixir', kind: 'unit' },
    },
  ];

  for (const row of ROWS) runRow(row);
});

describe('legality — project-xavier @ commit 444244199, the two vendored C/C++ roots differ', () => {
  it('classifies the Axera headers Outside vendored ON THEIR vendor SEGMENT', () => {
    const result = summarize(classify('packages/napi-axcl-venc/vendor/include/ax_venc_api.h', testConfig));
    expect({ tag: result.tag, kind: result.kind }).toEqual({ tag: 'Outside', kind: 'vendored' });
  });

  it('classifies the NVIDIA SDK samples Ungraded, because sdk is deliberately absent from the table', () => {
    expect(summarize(classify('tools/nvenc-lab/sdk/Samples/NvCodec/NvEncoder.cpp', testConfig))).toEqual({
      tag: 'Ungraded',
      reason: 'no_grammar_tokens',
    });
  });

  it('keeps BOTH outcomes green, so neither vendored root is a gap in the grammar', () => {
    const outcomes = [
      'packages/napi-axcl-venc/vendor/include/ax_venc_api.h',
      'tools/nvenc-lab/sdk/Samples/NvCodec/NvEncoder.cpp',
      'tools/nvenc-lab/sdk/Samples/NvCodec/NvDecoder.h',
    ].map((path) => summarize(classify(path, testConfig)).tag);
    expect(outcomes).toEqual(['Outside', 'Ungraded', 'Ungraded']);
  });

  it('mints neither lang_c nor lang_cpp, so a language nobody writes is never a permanent literal', () => {
    expect([
      summarize(classify('packages/bc_x/lang_c/src/x.c', testConfig)).reason,
      summarize(classify('packages/bc_x/lang_cpp/src/x.cpp', testConfig)).reason,
    ]).toEqual(['unknown_language', 'unknown_language']);
  });
});

describe('legality — harvest/kmp @ commit 1e7d64f, Kotlin Multiplatform', () => {
  const ROWS: readonly CorpusRow[] = [
    {
      real: 'modules/shared/src/wasmJsMain/kotlin/day/harvest/traditions/MapHost.wasmJs.kt',
      migrated:
        'modules/bc_shared/lang_kotlin/src/wasmJsMain/kotlin/day/harvest/traditions/MapHost.wasmJs.kt',
      tailBelowShell: 'traditions/MapHost.wasmJs.kt',
      expected: { tag: 'Graded', context: 'shared', language: 'kotlin', shellRole: 'source' },
    },
    {
      real: 'modules/domain/sdui/src/commonMain/kotlin/day/harvest/sdui/model/SurfaceId.kt',
      migrated:
        'modules/domain/bc_sdui/lang_kotlin/src/commonMain/kotlin/day/harvest/sdui/model/SurfaceId.kt',
      tailBelowShell: 'sdui/model/SurfaceId.kt',
      expected: { tag: 'Graded', context: 'sdui', language: 'kotlin', shellRole: 'source' },
    },
    {
      real: 'build-logic/src/test/kotlin/DomainBoundaryGuardTest.kt',
      migrated: 'bc_build_logic/lang_kotlin/src/test/kotlin/DomainBoundaryGuardTest.kt',
      tailBelowShell: 'DomainBoundaryGuardTest.kt',
      expected: { tag: 'Test', context: 'build_logic', language: 'kotlin', kind: 'unit' },
    },
  ];

  for (const row of ROWS) runRow(row);
});

describe('legality — harvest/kmp @ commit 1e7d64f, Swift, corpus-validated for path legality ONLY', () => {
  const REAL_SWIFT = ['apps/iosApp/iosApp/ContentView.swift', 'apps/iosApp/iosApp/iOSApp.swift'];

  for (const real of REAL_SWIFT) {
    it(`parses the real unmigrated ${real} as Ungraded, never as an error`, () => {
      expect(summarize(classify(real, testConfig))).toEqual({
        tag: 'Ungraded',
        reason: 'no_grammar_tokens',
      });
    });
  }

  it('grades the migrated Swift form whose target directory is the CONTEXT NAME, per reference section 4', () => {
    expect(
      summarize(classify('apps/bc_ios_app/lang_swift/Sources/ios_app/ContentView.swift', testConfig)),
    ).toEqual({ tag: 'Graded', context: 'ios_app', language: 'swift', shellRole: 'source' });
  });

  it('preserves the Swift tail verbatim across the migration of both real files', () => {
    expect({
      contentView: 'apps/bc_ios_app/lang_swift/Sources/ios_app/ContentView.swift'.endsWith(
        'ContentView.swift',
      ),
      iosApp: 'apps/bc_ios_app/lang_swift/Sources/ios_app/iOSApp.swift'.endsWith('iOSApp.swift'),
    }).toEqual({ contentView: true, iosApp: true });
  });

  it('REFUSES the whole-bc_-segment Swift spelling, since the matcher accepts exactly one spelling', () => {
    const result = summarize(
      classify('apps/bc_ios_app/lang_swift/Sources/bc_ios_app/ContentView.swift', testConfig),
    );
    expect({ tag: result.tag, reason: result.reason, segment: result.segment }).toEqual({
      tag: 'Malformed',
      reason: 'duplicate_kind',
      segment: 'bc_ios_app',
    });
  });

  it('refuses it via the outer bc_ token rather than via the matcher, which is worth recording', () => {
    expect(
      summarize(classify('apps/bc_ios_app/lang_swift/Sources/bc_ios_app/ContentView.swift', testConfig))
        .reason,
    ).not.toBe('file_outside_shell');
  });

  it('refuses a NEAR-MISS target directory through the matcher itself, with no duplicate token in play', () => {
    const result = summarize(
      classify('apps/bc_ios_app/lang_swift/Sources/iosapp/ContentView.swift', testConfig),
    );
    expect({ tag: result.tag, reason: result.reason }).toEqual({
      tag: 'Malformed',
      reason: 'file_outside_shell',
    });
  });
});

describe('legality — effect-bun-tooling @ commit 4d431c6, TypeScript, this repository', () => {
  const ROWS: readonly CorpusRow[] = [
    {
      real: 'packages/uuid-effect/src/tag.ts',
      migrated: 'packages/bc_uuid_effect/lang_typescript/src/tag.ts',
      tailBelowShell: 'tag.ts',
      expected: { tag: 'Graded', context: 'uuid_effect', language: 'typescript', shellRole: 'source' },
    },
  ];

  for (const row of ROWS) runRow(row);

  it('grades a lang_typescript root under a still-flat package with an ABSENT context, honestly', () => {
    expect(summarize(classify('packages/uuid-effect/lang_typescript/src/tag.ts', testConfig))).toEqual({
      tag: 'Graded',
      language: 'typescript',
      shellRole: 'source',
      context: undefined,
    });
  });

  it('lets the two halves of a polyglot package adopt independently', () => {
    expect([
      summarize(classify('packages/bc_napi_ultravisor_store/lang_rust/src/lib.rs', testConfig)).tag,
      summarize(classify('packages/bc_napi_ultravisor_store/lang_typescript/src/index.ts', testConfig)).tag,
    ]).toEqual(['Anchor', 'Graded']);
  });
});
