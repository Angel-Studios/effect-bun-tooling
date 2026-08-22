import { Option } from 'effect';
import type { GrammarConfig, LanguageShell, ShellMatcher, ShellRun } from './config.ts';
import type {
  AnchorKind,
  Language,
  MalformedReason,
  OutsideKind,
  Provenance,
  StructuralKind,
  SupersededKind,
  TestKind,
  UngradedReason,
} from './grammar.ts';
import {
  checkValue,
  isLanguage,
  isStructuralKind,
  isSupersededKind,
  isTestKind,
  SUPERSEDED_KIND_DESTINATION,
  splitKind,
} from './grammar.ts';

export type ShellRole = 'source' | 'test';

export type Shell = { readonly _tag: 'Shell'; readonly segment: string; readonly role: ShellRole };

export type Context = { readonly _tag: 'Context'; readonly segment: string; readonly name: string };

export type LanguageRoot = {
  readonly _tag: 'LanguageRoot';
  readonly segment: string;
  readonly language: Language;
};

export type TestTree = { readonly _tag: 'TestTree'; readonly segment: string; readonly kind: TestKind };

export type Reserved = {
  readonly _tag: 'Reserved';
  readonly segment: string;
  readonly kind: SupersededKind;
  readonly destination: string;
};

export type Untyped = { readonly _tag: 'Untyped'; readonly segment: string };

export type MalformedSegment = {
  readonly _tag: 'MalformedSegment';
  readonly segment: string;
  readonly reason: MalformedReason;
};

export type Segment = Shell | Context | LanguageRoot | TestTree | Reserved | Untyped | MalformedSegment;

export type ParsedPath = {
  readonly path: string;
  readonly basename: string;
  readonly segments: readonly Segment[];
  readonly context: string | undefined;
  readonly language: Language | undefined;
  readonly adopted: boolean;
  readonly testKind: TestKind | undefined;
  readonly shellRole: ShellRole | undefined;
  readonly shellSegments: readonly string[];
  readonly anchor: AnchorKind | undefined;
  readonly outside: OutsideKind | undefined;
  readonly reservedBasename: string | undefined;
  readonly unnormalized: string | undefined;
  readonly malformed: MalformedSegment | undefined;
};

export type Graded = {
  readonly _tag: 'Graded';
  readonly context?: string;
  readonly language: Language;
  readonly shellRole: ShellRole;
  readonly provenance: Provenance;
};

export type Test = {
  readonly _tag: 'Test';
  readonly context?: string;
  readonly language?: Language;
  readonly kind: TestKind;
  readonly provenance: Provenance;
};

export type Anchor = { readonly _tag: 'Anchor'; readonly kind: AnchorKind };

export type Outside = { readonly _tag: 'Outside'; readonly kind: OutsideKind };

export type Ungraded = {
  readonly _tag: 'Ungraded';
  readonly reason: UngradedReason;
  readonly context?: string;
  readonly provenance: Provenance;
};

export type Malformed = {
  readonly _tag: 'Malformed';
  readonly reason: MalformedReason;
  readonly segment: string;
};

export type PathClass = Graded | Test | Anchor | Outside | Ungraded | Malformed;

export const ANCHOR_BASENAMES: ReadonlyMap<string, AnchorKind> = new Map<string, AnchorKind>([
  ['package.json', 'package_manifest'],
  ['tsconfig.json', 'typescript_config'],
  ['bunfig.toml', 'bun_config'],
  ['biome.json', 'formatter_config'],
  ['biome.jsonc', 'formatter_config'],
  ['.prettierrc', 'formatter_config'],
  ['rustfmt.toml', 'formatter_config'],
  ['.editorconfig', 'formatter_config'],
  ['bun.lock', 'lockfile'],
  ['bun.lockb', 'lockfile'],
  ['package-lock.json', 'lockfile'],
  ['pnpm-lock.yaml', 'lockfile'],
  ['yarn.lock', 'lockfile'],
  ['Cargo.lock', 'lockfile'],
  ['mix.lock', 'lockfile'],
  ['Package.resolved', 'lockfile'],
  ['gradle.lockfile', 'lockfile'],
  ['.gitignore', 'vcs_ignore'],
  ['.gitattributes', 'vcs_ignore'],
  ['README', 'readme'],
  ['README.md', 'readme'],
  ['LICENSE', 'license'],
  ['LICENSE.md', 'license'],
  ['LICENCE', 'license'],
  ['lib.rs', 'crate_root'],
  ['main.rs', 'crate_root'],
  ['Cargo.toml', 'cargo_manifest'],
  ['build.gradle', 'gradle_manifest'],
  ['build.gradle.kts', 'gradle_manifest'],
  ['settings.gradle', 'gradle_manifest'],
  ['settings.gradle.kts', 'gradle_manifest'],
  ['mix.exs', 'mix_manifest'],
  ['Package.swift', 'swiftpm_manifest'],
  ['manifest', 'roku_manifest'],
]);

const TSCONFIG_VARIANT = /^tsconfig\..+\.json$/;

export const OUTSIDE_SEGMENTS: ReadonlyMap<string, OutsideKind> = new Map<string, OutsideKind>([
  ['node_modules', 'installed_dependency'],
  ['vendor', 'vendored'],
  ['vendored', 'vendored'],
  ['third_party', 'vendored'],
  ['dist', 'build_output'],
  ['.github', 'ci_config'],
  ['.circleci', 'ci_config'],
  ['.gitlab', 'ci_config'],
  ['.claude', 'agent_state'],
  ['.hypervisor', 'agent_state'],
  ['.toolplane', 'build_plane'],
  ['.ast-grep', 'build_plane'],
]);

const unnormalizedOf = (path: string): string | undefined => {
  if (path.includes('\\')) return '\\';
  if (path.startsWith('/')) return '/';
  return path.split('/').find((component) => component === '..');
};

const componentsOf = (path: string): readonly string[] =>
  path.split('/').filter((component) => component.length > 0 && component !== '.');

const anchorOf = (basename: string): AnchorKind | undefined => {
  const named = ANCHOR_BASENAMES.get(basename);
  if (named !== undefined) return named;
  return TSCONFIG_VARIANT.test(basename) ? 'typescript_config' : undefined;
};

const outsideOf = (components: readonly string[]): OutsideKind | undefined => {
  for (const component of components) {
    const kind = OUTSIDE_SEGMENTS.get(component);
    if (kind !== undefined) return kind;
  }
  return undefined;
};

const reservedBasenameOf = (basename: string): string | undefined => {
  const at = basename.indexOf('_');
  if (at <= 0) return undefined;
  const token = basename.slice(0, at);
  return isStructuralKind(token) || isSupersededKind(token) ? token : undefined;
};

const contextNameOf = (dirs: readonly string[]): string | undefined => {
  for (const segment of dirs) {
    const split = splitKind(segment);
    if (split === undefined || split.kind !== 'bc') continue;
    if (Option.isNone(checkValue(split.value))) return split.value;
  }
  return undefined;
};

type LanguageRootSite = { readonly index: number; readonly language: Language };

const languageRootOf = (dirs: readonly string[]): LanguageRootSite | undefined => {
  for (const [index, segment] of dirs.entries()) {
    const split = splitKind(segment);
    if (split === undefined || split.kind !== 'lang') continue;
    if (Option.isSome(checkValue(split.value))) continue;
    if (isLanguage(split.value)) return { index, language: split.value };
  }
  return undefined;
};

const declaresAdoption = (dirs: readonly string[]): boolean =>
  dirs.some((segment) => splitKind(segment)?.kind === 'lang');

type DeclaredRun = { readonly run: ShellRun; readonly role: ShellRole };

const declaredRuns = (shell: LanguageShell | undefined): readonly DeclaredRun[] => {
  if (shell === undefined) return [];
  const runs: DeclaredRun[] = [];
  const test = shell.test;
  if (test !== undefined && test.length > 0) runs.push({ run: test, role: 'test' });
  const source = shell.source;
  if (source !== undefined && source.length > 0) runs.push({ run: source, role: 'source' });
  for (const extra of shell.extra_source_roots ?? []) {
    if (extra.length > 0) runs.push({ run: extra, role: 'source' });
  }
  return runs;
};

const matchMatcher = (
  matcher: ShellMatcher,
  dirs: readonly string[],
  cursor: number,
  contextName: string | undefined,
): number | undefined => {
  if ('optional_run' in matcher) {
    const run = matcher.optional_run;
    if (run.length === 0 || cursor + run.length > dirs.length) return cursor;
    const matched = run.every((expected, offset) => dirs[cursor + offset] === expected);
    return matched ? cursor + run.length : cursor;
  }
  const segment = cursor < dirs.length ? dirs[cursor] : undefined;
  if (segment === undefined) return undefined;
  if ('literal' in matcher) return segment === matcher.literal ? cursor + 1 : undefined;
  if ('any_of' in matcher) return matcher.any_of.includes(segment) ? cursor + 1 : undefined;
  if (contextName === undefined) return undefined;
  return segment === `${contextName}${matcher.suffix ?? ''}` ? cursor + 1 : undefined;
};

const matchRunAt = (
  run: ShellRun,
  dirs: readonly string[],
  start: number,
  contextName: string | undefined,
): number | undefined => {
  if (run.length === 0) return undefined;
  let cursor = start;
  for (const matcher of run) {
    const next = matchMatcher(matcher, dirs, cursor, contextName);
    if (next === undefined) return undefined;
    cursor = next;
  }
  return cursor;
};

type ResolvedShell = { readonly start: number; readonly end: number; readonly role: ShellRole };

const resolveShell = (
  dirs: readonly string[],
  armedAt: number,
  runs: readonly DeclaredRun[],
  contextName: string | undefined,
): ResolvedShell | undefined => {
  for (let start = armedAt + 1; start < dirs.length; start += 1) {
    for (const declared of runs) {
      const end = matchRunAt(declared.run, dirs, start, contextName);
      if (end !== undefined && end > start) return { start, end, role: declared.role };
    }
  }
  return undefined;
};

const structuralSegment = (kind: StructuralKind, value: string, segment: string): Segment => {
  const refusal = checkValue(value);
  if (Option.isSome(refusal)) return { _tag: 'MalformedSegment', segment, reason: refusal.value };
  if (kind === 'bc') return { _tag: 'Context', segment, name: value };
  if (kind === 'lang') {
    return isLanguage(value)
      ? { _tag: 'LanguageRoot', segment, language: value }
      : { _tag: 'MalformedSegment', segment, reason: 'unknown_language' };
  }
  return isTestKind(value)
    ? { _tag: 'TestTree', segment, kind: value }
    : { _tag: 'MalformedSegment', segment, reason: 'unknown_test_kind' };
};

type SegmentPosition = {
  readonly inShell: boolean;
  readonly belowShell: boolean;
  readonly shellRole: ShellRole | undefined;
  readonly adopted: boolean;
};

const segmentAt = (segment: string, position: SegmentPosition): Segment => {
  if (position.inShell && position.shellRole !== undefined) {
    return { _tag: 'Shell', segment, role: position.shellRole };
  }
  const split = splitKind(segment);
  if (split === undefined) return { _tag: 'Untyped', segment };
  if (isSupersededKind(split.kind)) {
    return {
      _tag: 'Reserved',
      segment,
      kind: split.kind,
      destination: SUPERSEDED_KIND_DESTINATION[split.kind],
    };
  }
  if (isStructuralKind(split.kind)) {
    return position.belowShell
      ? { _tag: 'MalformedSegment', segment, reason: 'token_below_shell' }
      : structuralSegment(split.kind, split.value, segment);
  }
  if (position.belowShell || !position.adopted) return { _tag: 'Untyped', segment };
  return { _tag: 'MalformedSegment', segment, reason: 'unknown_structural_kind' };
};

const positionOf = (index: number, shell: ResolvedShell | undefined, adopted: boolean): SegmentPosition => ({
  inShell: shell !== undefined && index >= shell.start && index < shell.end,
  belowShell: shell !== undefined && index >= shell.end,
  shellRole: shell?.role,
  adopted,
});

type Finding = { readonly index: number; readonly malformed: MalformedSegment };

const duplicateKindIndices = (dirs: readonly string[], segments: readonly Segment[]): ReadonlySet<number> => {
  const seen = new Set<string>();
  const duplicates = new Set<number>();
  for (const [index, built] of segments.entries()) {
    if (built._tag === 'Shell' || built._tag === 'Untyped') continue;
    const split = splitKind(dirs[index] ?? '');
    if (split === undefined || !isStructuralKind(split.kind)) continue;
    if (seen.has(split.kind)) duplicates.add(index);
    else seen.add(split.kind);
  }
  return duplicates;
};

const findingsOf = (dirs: readonly string[], segments: readonly Segment[]): readonly Finding[] => {
  const duplicates = duplicateKindIndices(dirs, segments);
  const findings: Finding[] = [];
  for (const [index, built] of segments.entries()) {
    if (built._tag === 'MalformedSegment') findings.push({ index, malformed: built });
    else if (built._tag === 'Reserved') {
      findings.push({
        index,
        malformed: { _tag: 'MalformedSegment', segment: built.segment, reason: 'superseded_kind' },
      });
    }
    if (duplicates.has(index)) {
      findings.push({
        index,
        malformed: {
          _tag: 'MalformedSegment',
          segment: built.segment,
          reason: 'duplicate_kind',
        },
      });
    }
  }
  return findings;
};

const winningFinding = (findings: readonly Finding[]): Finding | undefined =>
  findings.find((finding) => finding.malformed.reason === 'superseded_kind') ?? findings[0];

const testKindOf = (
  segments: readonly Segment[],
  shell: ResolvedShell | undefined,
  languageShell: LanguageShell | undefined,
): TestKind | undefined => {
  for (const built of segments) {
    if (built._tag === 'TestTree') return built.kind;
  }
  if (shell?.role !== 'test') return undefined;
  return languageShell?.test_kind ?? 'unassigned';
};

export const parsePath = (repoRelativeFilePath: string, config: GrammarConfig): ParsedPath => {
  const components = componentsOf(repoRelativeFilePath);
  const basename = components[components.length - 1] ?? '';
  const dirs = components.slice(0, -1);

  const contextName = contextNameOf(dirs);
  const root = languageRootOf(dirs);
  const adopted = declaresAdoption(dirs);
  const languageShell = root === undefined ? undefined : config.shell[root.language];
  const shell =
    root === undefined ? undefined : resolveShell(dirs, root.index, declaredRuns(languageShell), contextName);

  const segments = dirs.map((segment, index) => segmentAt(segment, positionOf(index, shell, adopted)));
  const findings = findingsOf(dirs, segments);

  return {
    path: repoRelativeFilePath,
    basename,
    segments,
    context: contextName,
    language: root?.language,
    adopted,
    testKind: testKindOf(segments, shell, languageShell),
    shellRole: shell?.role,
    shellSegments: shell === undefined ? [] : dirs.slice(shell.start, shell.end),
    anchor: anchorOf(basename),
    outside: outsideOf(components),
    reservedBasename: reservedBasenameOf(basename),
    unnormalized: unnormalizedOf(repoRelativeFilePath),
    malformed: winningFinding(findings)?.malformed,
  };
};

const withContext = (context: string | undefined): { readonly context?: string } =>
  context === undefined ? {} : { context };

const testClassOf = (parsed: ParsedPath): PathClass => ({
  _tag: 'Test',
  ...withContext(parsed.context),
  ...(parsed.language === undefined ? {} : { language: parsed.language }),
  kind: parsed.testKind ?? 'unassigned',
  provenance: 'path_grammar',
});

const ungradedClassOf = (parsed: ParsedPath): PathClass =>
  parsed.context === undefined
    ? { _tag: 'Ungraded', reason: 'no_grammar_tokens', provenance: 'unassigned' }
    : {
        _tag: 'Ungraded',
        reason: 'no_language_root',
        context: parsed.context,
        provenance: 'path_grammar',
      };

export const classifyParsed = (parsed: ParsedPath): PathClass => {
  if (parsed.unnormalized !== undefined) {
    return { _tag: 'Malformed', reason: 'unnormalized_path', segment: parsed.unnormalized };
  }
  const malformed = parsed.malformed;
  if (malformed !== undefined && malformed.reason === 'superseded_kind') {
    return { _tag: 'Malformed', reason: 'superseded_kind', segment: malformed.segment };
  }
  if (parsed.outside !== undefined) return { _tag: 'Outside', kind: parsed.outside };
  if (parsed.anchor !== undefined) return { _tag: 'Anchor', kind: parsed.anchor };
  if (malformed !== undefined) {
    return { _tag: 'Malformed', reason: malformed.reason, segment: malformed.segment };
  }
  if (parsed.adopted && parsed.reservedBasename !== undefined) {
    return { _tag: 'Malformed', reason: 'reserved_basename', segment: parsed.basename };
  }
  if (parsed.testKind !== undefined) return testClassOf(parsed);
  if (parsed.language === undefined) return ungradedClassOf(parsed);
  if (parsed.shellRole === 'source') {
    return {
      _tag: 'Graded',
      ...withContext(parsed.context),
      language: parsed.language,
      shellRole: 'source',
      provenance: 'path_grammar',
    };
  }
  return { _tag: 'Malformed', reason: 'file_outside_shell', segment: parsed.basename };
};

export const classify = (repoRelativeFilePath: string, config: GrammarConfig): PathClass =>
  classifyParsed(parsePath(repoRelativeFilePath, config));
