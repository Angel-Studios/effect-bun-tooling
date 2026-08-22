import { afterAll, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as Schema from 'effect/Schema';
import { messageOfThrown } from '../src/parse.ts';
import { LF } from '../src/sentinel.ts';
import { renderFrontMatter, upsertFrontMatter } from '../src/write.ts';
import { CANONICAL_PAYLOAD, fixtureText, PACKAGE_ROOT, repoRoot, successOf } from './support.ts';

const ROOT = repoRoot();

const SCRATCH_BASE = join(PACKAGE_ROOT, '.test-fixtures');

const TSC_ENTRY = join(ROOT, 'node_modules', '.bin', 'tsc');

const TSC_FLAGS: readonly string[] = [
  '--ignoreConfig',
  '--noEmit',
  '--strict',
  '--skipLibCheck',
  '--target',
  'es2022',
  '--module',
  'esnext',
  '--moduleResolution',
  'bundler',
  '--types',
  'node',
];

const RUST_HOST = 'pub fn answer() -> u8 {\n    42\n}\n\npub struct Frame {\n    pub id: u32,\n}\n';

const DIRECTIVE_HOST = '// @ts-expect-error deliberate\nexport const bad: number = "nope";\n';

const HostLanesSchema = Schema.Struct({
  rustc: Schema.Struct({
    waived: Schema.Boolean,
    reason: Schema.String,
  }),
});

const HOST_LANES = successOf(
  Schema.decodeUnknownResult(HostLanesSchema, { errors: 'all', onExcessProperty: 'error' })(
    Bun.TOML.parse(readFileSync(join(PACKAGE_ROOT, 'host-lanes.toml'), 'utf8')),
  ),
);

const CORRUPT_BLOCK = '/* ---uv\nlinks = { adr = "https://x.test/a*/b" }\n--- */\n\n';

const NESTING_CORRUPT_BLOCK = '/* ---uv\nlinks = { adr = "https://x.test/a/*b" }\n--- */\n\n';

type ToolRun = {
  readonly ok: boolean;
  readonly output: string;
};

const created: string[] = [];

afterAll(() => {
  for (const directory of created.splice(0)) rmSync(directory, { recursive: true, force: true });
  rmSync(SCRATCH_BASE, { recursive: true, force: true });
});

const scratchDir = (label: string): string => {
  mkdirSync(SCRATCH_BASE, { recursive: true });
  const directory = mkdtempSync(join(SCRATCH_BASE, `${label}-`));
  created.push(directory);
  return directory;
};

const attempt = (command: readonly string[]): ToolRun => {
  try {
    const spawned = Bun.spawnSync([...command], { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' });
    return {
      ok: spawned.success,
      output: `${spawned.stdout.toString()}${spawned.stderr.toString()}`.trim(),
    };
  } catch (thrown) {
    return { ok: false, output: `could not launch ${command[0]}: ${messageOfThrown(thrown)}` };
  }
};

const fileAt = (directory: string, name: string, text: string): string => {
  const path = join(directory, name);
  writeFileSync(path, text);
  return path;
};

const typeCheck = (path: string): ToolRun => attempt([process.execPath, TSC_ENTRY, ...TSC_FLAGS, path]);

const rustCheck = (directory: string, path: string): ToolRun =>
  attempt([
    'rustc',
    '--edition',
    '2021',
    '--crate-type',
    'lib',
    '--emit=metadata',
    '-o',
    join(directory, 'out.rmeta'),
    path,
  ]);

const RUSTC_PRESENT = attempt(['rustc', '--version']).ok;

const announceAbsentLane = (): void => {
  process.stderr.write(
    [
      '',
      '  ############################################################################',
      '  # ddd-meta host-validity: the rustc ARM DID NOT RUN. rustc is not on PATH. #',
      `  # waived in host-lanes.toml: ${String(HOST_LANES.rustc.waived)}`.padEnd(77) + '#',
      '  # The nesting-host property was NOT asserted on this machine.              #',
      '  ############################################################################',
      '',
    ].join('\n'),
  );
};

const writtenTypeScript = (): string =>
  successOf(upsertFrontMatter(fixtureText('block/sweep.ts.fixture'), 'block', CANONICAL_PAYLOAD));

const writtenRust = (): string => successOf(upsertFrontMatter(RUST_HOST, 'block', CANONICAL_PAYLOAD));

describe('the TypeScript artifact this writer produces is asked of a real TypeScript compiler', () => {
  it('finds the repo compiler, so this lane can never pass by being skipped', () => {
    expect(existsSync(TSC_ENTRY)).toBe(true);
    const version = attempt([process.execPath, TSC_ENTRY, '--version']);
    expect(`tsc launched: ${version.ok}`).toBe('tsc launched: true');
  });

  it('type-checks the fixture clean before anything is written into it', () => {
    const directory = scratchDir('host-ts-control');
    const result = typeCheck(fileAt(directory, 'sweep.ts', fixtureText('block/sweep.ts.fixture')));
    expect(`control: ${result.ok ? 'clean' : result.output}`).toBe('control: clean');
  });

  it('type-checks the fixture clean after the canonical payload is written into it', () => {
    const directory = scratchDir('host-ts-written');
    const result = typeCheck(fileAt(directory, 'sweep.ts', writtenTypeScript()));
    expect(`written: ${result.ok ? 'clean' : result.output}`).toBe('written: clean');
  });

  it('is armed: a hand-authored block closing the comment early makes the same lane go red', () => {
    const directory = scratchDir('host-ts-armed');
    const corrupt = `${CORRUPT_BLOCK}${fixtureText('block/sweep.ts.fixture')}`;
    expect(typeCheck(fileAt(directory, 'sweep.ts', corrupt)).ok).toBe(false);
  });
});

describe('the artifact the preamble-scope fix produces is asked of a real TypeScript compiler', () => {
  it('type-checks the directive host clean before anything is written into it', () => {
    const directory = scratchDir('host-ts-directive-control');
    const result = typeCheck(fileAt(directory, 'directive.ts', DIRECTIVE_HOST));
    expect(`control: ${result.ok ? 'clean' : result.output}`).toBe('control: clean');
  });

  it('type-checks a next-line-directive host clean once the block is written ABOVE the directive', () => {
    const directory = scratchDir('host-ts-directive');
    const written = successOf(upsertFrontMatter(DIRECTIVE_HOST, 'block', CANONICAL_PAYLOAD));
    expect(written.startsWith('/* ---uv')).toBe(true);
    const result = typeCheck(fileAt(directory, 'directive.ts', written));
    expect(`written: ${result.ok ? 'clean' : result.output}`).toBe('written: clean');
  });

  it('is armed: the pre-fix placement below the directive produces TS2578 from the same lane', () => {
    const directory = scratchDir('host-ts-detached');
    const block = successOf(renderFrontMatter(CANONICAL_PAYLOAD, 'block', LF));
    const detached = `// @ts-expect-error deliberate\n${block}\n\nexport const bad: number = "nope";\n`;
    const result = typeCheck(fileAt(directory, 'detached.ts', detached));
    expect(result.ok).toBe(false);
    expect(result.output).toContain('TS2578');
  });
});

describe('the Rust artifact this writer produces is asked of a real Rust compiler', () => {
  it('runs the rustc arm, or refuses to pass unless the repository has WAIVED it in writing', () => {
    if (!RUSTC_PRESENT) announceAbsentLane();
    const waived = HOST_LANES.rustc.waived;
    const verdict = RUSTC_PRESENT ? 'rustc present, arm runs' : `rustc absent, waived=${waived}`;
    const required = RUSTC_PRESENT ? 'rustc present, arm runs' : 'rustc absent, waived=true';
    expect(verdict).toBe(required);
  });

  it('carries a substantive reason for any waiver it declares, never a bare flag', () => {
    if (!HOST_LANES.rustc.waived) return;
    expect(HOST_LANES.rustc.reason.length).toBeGreaterThan(120);
    expect(HOST_LANES.rustc.reason).toContain('waived = false');
  });

  if (RUSTC_PRESENT) {
    it('compiles the written Rust artifact, whose block comments nest', () => {
      const directory = scratchDir('host-rs-written');
      const result = rustCheck(directory, fileAt(directory, 'lib.rs', writtenRust()));
      expect(`written: ${result.ok ? 'clean' : result.output}`).toBe('written: clean');
    });

    it('is armed: a hand-authored unbalanced open makes the same lane go red', () => {
      const directory = scratchDir('host-rs-armed');
      const corrupt = `${NESTING_CORRUPT_BLOCK}${RUST_HOST}`;
      const result = rustCheck(directory, fileAt(directory, 'lib.rs', corrupt));
      expect(result.ok).toBe(false);
      expect(result.output).toContain('unterminated block comment');
    });
  }
});
