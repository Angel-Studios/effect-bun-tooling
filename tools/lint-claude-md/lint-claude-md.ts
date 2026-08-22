#!/usr/bin/env bun

import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { Schema } from 'effect';
import type { Code, Heading, Nodes, Root, Text } from 'mdast';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { visit } from 'unist-util-visit';

export type Severity = 'error' | 'warning';
export type Violation = {
  file: string;
  line: number;
  checkId: string;
  message: string;
  severity: Severity;
};

const AudienceSchema = Schema.Literals(['every-session', 'inside-this-directory']);
const CadenceSchema = Schema.Literals(['quarterly', 'on-architectural-change', 'never']);
const EnforcedBySchema = Schema.Literals(['lint', 'ast-grep', 'hook', 'test', 'advisory']);

const SCOPE_LITERAL = 'monorepo';
const SCOPE_PATH_PREFIXES = ['apps/', 'packages/', 'devices/'];
const isValidScope = (scope: string): boolean => {
  if (scope === SCOPE_LITERAL) return true;
  return SCOPE_PATH_PREFIXES.some((prefix) => scope.startsWith(prefix) && scope.length > prefix.length);
};

const ScopeSchema = Schema.String.check(Schema.makeFilter((s: string) => isValidScope(s.trim())));
const ISODateSchema = Schema.String.check(Schema.makeFilter((s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s)));
const LengthExceptionSchema = Schema.String.check(
  Schema.makeFilter((s: string) => /(?:≤|<=|ceiling\s+raised\s+to|ceiling)\s*(\d+)/i.test(s)),
);

type Frontmatter = {
  scope?: string;
  audience?: string;
  verified?: string;
  'verified-against'?: string[];
  'review-cadence'?: string;
  'length-exception'?: string;
  'enforced-by'?: string;
};

type FileData = {
  path: string;
  relPath: string;
  content: string;
  lineCount: number;
  frontmatter: Frontmatter | null;
  body: string;
  bodyStartLine: number;
  kind: 'claude-md' | 'skill-md' | 'doc';

  ast: Root;
};

const TUNABLES = {
  DEFAULT_LENGTH_CEILING: 150,

  DUPLICATE_MIN_LEN: 100,

  SHAPE1_DETECTION_WINDOW: 7,

  MARKER_PROXIMITY_WINDOW: 5,

  MARKER_MIN_CONTENT_CHARS: 5,

  VERIFIED_AGAINST_DRIFT_DAYS: 30,

  QUARTERLY_MAX_AGE_DAYS: 90,

  ON_ARCH_CHANGE_MAX_AGE_DAYS: 180,
} as const;

const HELP_TEXT = `Usage: bun tools/lint-claude-md/lint-claude-md.ts [paths...] [options]
       pnpm lint:claude-md [-- paths...] [-- options]

Arguments:
  paths       Optional list of CLAUDE.md / SKILL.md / governance .md paths to
              scan. If omitted, scans the entire repo for CLAUDE.md plus every
              SKILL.md under .claude/skills/ and plugins/<plugin>/skills/ plus
              the Constitution and Style Guide.

Options:
  --json              Emit results as JSON instead of human-readable output.
  --today=YYYY-MM-DD  Override "today" for deterministic FM08 staleness tests.
                      May also be set via env var CLAUDE_MD_LINT_TODAY.
  --help              Print usage and exit 0.

Exit codes:
  0  All scanned files pass (warnings allowed, errors disallowed).
  1  One or more error-severity violations.
  2  Script error (repo root not found, IO failure, etc.).
  3  Empty scan set: nothing was discovered to lint. Refused fail-closed rather than
     reported as a pass, and given its OWN code so a consumer gate that sees only an
     exit status can tell it apart from a crash.
`;

const ALWAYS_INCLUDE_SCAN = ['docs/claude-md-constitution.md', 'docs/claude-md-style.md'];

const EXCLUDE_DIRS = [
  'node_modules',
  'dist',
  'build',
  '.git',
  '.claude/worktrees',

  'devices/cyclops/work',

  'devices/cyclops/rpi-image-gen/work',

  'tools/overlap-vision',

  '.test-fixtures',
];

const VALID_AUDIENCES = AudienceSchema.literals;
const VALID_CADENCES = CadenceSchema.literals;
const VALID_ENFORCED_BY = EnforcedBySchema.literals;

function parseArgs(argv: string[]): {
  paths: string[];
  json: boolean;
  help: boolean;
  today: string | null;
} {
  const out = { paths: [] as string[], json: false, help: false, today: null as string | null };
  for (const a of argv) {
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--json') out.json = true;
    else if (a.startsWith('--today=')) out.today = a.slice('--today='.length);
    else if (a.startsWith('--')) {
      process.stderr.write(`Unknown option: ${a}\n`);
      process.exit(2);
    } else out.paths.push(a);
  }
  return out;
}

function resolveToday(cliToday: string | null): Date {
  const envToday = process.env['CLAUDE_MD_LINT_TODAY'] ?? null;
  const explicit = cliToday ?? envToday;
  if (explicit != null && explicit !== '') {
    const parsed = parseIsoDate(explicit);
    if (parsed == null) {
      process.stderr.write(`Invalid --today/CLAUDE_MD_LINT_TODAY value: ${explicit} (expected YYYY-MM-DD)\n`);
      process.exit(2);
    }
    return parsed;
  }
  return new Date();
}

// A repo root holds a package.json AND a marker that the directory is the TOP of a
// workspace rather than one member of it. The upstream copy of this tool accepted only
// `pnpm-workspace.yaml`, which is a pnpm-specific spelling: this repo declares its
// workspaces inside package.json and locks with bun, so that check walked past the real
// root and exited as a script error. Any of the markers below settles it, and `.git` is
// last because a submodule or a nested checkout can carry one without being a workspace.
const WORKSPACE_ROOT_MARKERS = ['pnpm-workspace.yaml', 'bun.lock', 'bun.lockb', '.git'] as const;

function findRepoRoot(start: string): string {
  let dir = resolve(start);
  while (true) {
    if (
      existsSync(join(dir, 'package.json')) &&
      WORKSPACE_ROOT_MARKERS.some((marker) => existsSync(join(dir, marker)))
    ) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      process.stderr.write(
        `Could not find repo root (looking for a directory holding package.json plus one of ${WORKSPACE_ROOT_MARKERS.join(', ')})\n`,
      );
      process.exit(SCRIPT_ERROR_EXIT_CODE);
    }
    dir = parent;
  }
}

function isExcluded(relPath: string): boolean {
  if (relPath === '') return false;
  const segments = relPath.split('/');
  for (const exc of EXCLUDE_DIRS) {
    if (exc.includes('/')) {
      if (relPath === exc || relPath.startsWith(`${exc}/`)) return true;
    } else {
      if (segments.includes(exc)) return true;
    }
  }
  return false;
}

type WalkContext = {
  dirsVisited: number;
  log: (msg: string) => void;
  debug: boolean;
  visited: Set<string>;
};

function newWalkContext(log: (msg: string) => void): WalkContext {
  return {
    dirsVisited: 0,
    log,
    debug: process.env['CLAUDE_MD_LINT_DEBUG'] === '1',
    visited: new Set(),
  };
}

const CARGO_MANIFEST = 'Cargo.toml';
const CARGO_BUILD_OUTPUT_DIR = 'target';

export function isCargoBuildOutput(absDir: string): boolean {
  if (basename(absDir) !== CARGO_BUILD_OUTPUT_DIR) return false;
  return existsSync(join(dirname(absDir), CARGO_MANIFEST));
}

function walkCM(root: string, out: string[], ctx: WalkContext, baseDir = root): void {
  const relDir = relative(root, baseDir);
  if (isExcluded(relDir)) return;
  if (isCargoBuildOutput(baseDir)) return;

  let canonical: string;
  try {
    canonical = realpathSync(baseDir);
  } catch {
    return;
  }
  if (ctx.visited.has(canonical)) {
    if (ctx.debug) ctx.log(`  skip (already visited): ${relDir} → ${canonical}`);
    return;
  }
  ctx.visited.add(canonical);
  ctx.dirsVisited++;
  if (ctx.debug) ctx.log(`  walkCM: ${relDir || '.'}`);
  else if (ctx.dirsVisited % 500 === 0)
    ctx.log(`  walkCM: ${ctx.dirsVisited} dirs scanned (current: ${relDir || '.'})`);
  let entries: string[];
  try {
    entries = readdirSync(baseDir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(baseDir, entry);
    let s: ReturnType<typeof statSync>;
    try {
      s = statSync(full);
    } catch {
      continue;
    }
    if (s.isDirectory()) walkCM(root, out, ctx, full);
    else if (s.isFile() && entry === 'CLAUDE.md') out.push(full);
  }
}

function discoverSkillFiles(repoRoot: string, ctx: WalkContext): string[] {
  const out: string[] = [];
  const visited = new Set<string>();
  const walk = (dir: string): void => {
    let canonical: string;
    try {
      canonical = realpathSync(dir);
    } catch {
      return;
    }
    if (visited.has(canonical)) return;
    visited.add(canonical);
    ctx.dirsVisited++;
    if (ctx.debug) ctx.log(`  skills: ${relative(repoRoot, dir) || '.'}`);
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      let s: ReturnType<typeof statSync>;
      try {
        s = statSync(full);
      } catch {
        continue;
      }
      if (s.isDirectory()) walk(full);
      else if (s.isFile() && entry === 'SKILL.md') out.push(full);
    }
  };
  for (const root of skillSearchRoots(repoRoot)) walk(root);
  return out;
}

function isSkillFile(absPath: string, repoRoot: string): boolean {
  if (!absPath.endsWith('/SKILL.md')) return false;
  return skillSearchRoots(repoRoot).some((root) => absPath.startsWith(`${root}/`));
}

export function classifyFile(absPath: string, repoRoot: string): FileData['kind'] {
  const rel = relative(repoRoot, absPath);
  if (rel === 'docs/claude-md-constitution.md' || rel === 'docs/claude-md-style.md') return 'doc';
  if (isSkillFile(absPath, repoRoot)) return 'skill-md';
  return 'claude-md';
}

export function discoverScanFiles(
  repoRoot: string,
  explicitPaths: string[],
  log: (msg: string) => void,
): string[] {
  if (explicitPaths.length > 0) return explicitPaths.map((p) => resolve(p));
  const found: string[] = [];
  const ctx = newWalkContext(log);
  const t0 = Date.now();
  walkCM(repoRoot, found, ctx);
  log(`walkCM done: ${ctx.dirsVisited} dirs in ${Date.now() - t0}ms, ${found.length} CLAUDE.md found`);
  const t1 = Date.now();
  for (const skill of discoverSkillFiles(repoRoot, ctx)) {
    if (!found.includes(skill)) found.push(skill);
  }
  log(`discoverSkillFiles done in ${Date.now() - t1}ms (running total: ${ctx.dirsVisited} dirs)`);
  for (const extra of ALWAYS_INCLUDE_SCAN) {
    const abs = join(repoRoot, extra);
    if (existsSync(abs) && !found.includes(abs)) found.push(abs);
  }
  return found.sort();
}

const LIST_FIELDS = new Set<keyof Frontmatter>(['verified-against']);

function parseFrontmatter(content: string): {
  fm: Frontmatter;
  endLine: number;
  bodyStartLine: number;
  warnings: { key: string; line: number; reason: string }[];
} | null {
  const lines = content.split('\n');
  if (lines[0] !== '---') return null;
  let endIdx = -1;
  for (let i = 1; i < lines.length; i++)
    if (lines[i] === '---') {
      endIdx = i;
      break;
    }
  if (endIdx === -1) return null;
  const fm: Frontmatter = {};
  const warnings: { key: string; line: number; reason: string }[] = [];
  let currentListKey: keyof Frontmatter | null = null;
  for (let li = 1; li < endIdx; li++) {
    const line = lines[li];
    const listMatch = line.match(/^\s+-\s+(.*)$/);
    if (listMatch != null && currentListKey != null) {
      const list = fm[currentListKey] as string[] | undefined;
      if (list != null) list.push(listMatch[1].trim());
      continue;
    }
    const kvMatch = line.match(/^([a-z][a-z-]*)\s*:\s*(.*)$/);
    if (kvMatch == null) continue;
    const key = kvMatch[1] as keyof Frontmatter;
    const val = kvMatch[2].trim();
    if (LIST_FIELDS.has(key)) {
      if (val === '') {
        fm[key] = [] as never;
        currentListKey = key;
      } else {
        fm[key] = [val] as never;
        warnings.push({
          key: String(key),
          line: li + 1,
          reason: `field "${String(key)}" is list-typed; convert to dash-prefix block form (- ${val})`,
        });
        currentListKey = null;
      }
    } else {
      (fm as Record<string, unknown>)[key] = val;
      currentListKey = null;
    }
  }
  return { fm, endLine: endIdx, bodyStartLine: endIdx + 2, warnings };
}

function loadFile(absPath: string, repoRoot: string): FileData {
  const text = readFileSync(absPath, 'utf8');
  const parsed = parseFrontmatter(text);
  const lines = text.split('\n');
  const lineCount = lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
  const kind = classifyFile(absPath, repoRoot);
  const body = parsed != null ? lines.slice(parsed.endLine + 1).join('\n') : text;
  const bodyStartLine = parsed != null ? parsed.bodyStartLine : 1;
  const ast = fromMarkdown(body) as Root;
  return {
    path: absPath,
    relPath: relative(repoRoot, absPath),
    content: text,
    lineCount,
    frontmatter: parsed != null ? parsed.fm : null,
    body,
    bodyStartLine,
    kind,
    ast,
  };
}

function stripFencedCodeBlocks(body: string): string {
  let inFence = false;
  const out: string[] = [];
  for (const line of body.split('\n')) {
    if (/^```/.test(line)) {
      inFence = !inFence;
      out.push('');
    } else out.push(inFence ? '' : line);
  }
  return out.join('\n');
}

function stripIndentedCodeBlocks(body: string): string {
  const lines = body.split('\n');
  const out: string[] = new Array(lines.length);
  let lastNonEmpty = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    out[i] = /^ {4,}\S/.test(line) && lastNonEmpty === '' ? '' : line;
    if (line.trim() !== '') lastNonEmpty = line;
  }
  return out.join('\n');
}

function stripInlineCode(text: string): string {
  return text.replace(/`[^`\n]+`/g, (m) => ' '.repeat(m.length));
}

function stripDoubleQuoted(text: string): string {
  return text.replace(/"[^"\n]*"/g, (m) => ' '.repeat(m.length));
}

function prepareProseLines(body: string): string[] {
  return stripIndentedCodeBlocks(stripFencedCodeBlocks(body)).split('\n').map(stripInlineCode);
}

function prepareLinesPreservingInlineCode(body: string): string[] {
  return stripIndentedCodeBlocks(stripFencedCodeBlocks(body)).split('\n');
}

const mk = (file: FileData, line: number, checkId: string, message: string): Violation => ({
  file: file.relPath,
  line,
  checkId,
  message,
  severity: 'error',
});

const mkWarn = (file: FileData, line: number, checkId: string, message: string): Violation => ({
  file: file.relPath,
  line,
  checkId,
  message,
  severity: 'warning',
});

function daysBetween(later: Date, earlier: Date): number {
  return Math.floor((later.getTime() - earlier.getTime()) / 86_400_000);
}

function parseIsoDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

type FieldRule = {
  key: keyof Frontmatter;

  isValid: (value: unknown) => boolean;
  required: boolean;
  checkId: string;
  missingMsg: string;
  invalidMsg: (value: string) => string;
};

const FIELD_RULES: FieldRule[] = [
  {
    key: 'scope',
    isValid: Schema.is(ScopeSchema),
    required: true,
    checkId: 'FM02',
    missingMsg: 'scope field is required',
    invalidMsg: (v) =>
      `scope must be "monorepo" or start with "apps/", "packages/", or "devices/" (got ${v})`,
  },
  {
    key: 'audience',
    isValid: Schema.is(AudienceSchema),
    required: true,
    checkId: 'FM03',
    missingMsg: 'audience field is required',
    invalidMsg: (v) => `audience must be one of ${VALID_AUDIENCES.join(', ')} (got ${v})`,
  },
  {
    key: 'verified',
    isValid: Schema.is(ISODateSchema),
    required: true,
    checkId: 'FM04',
    missingMsg: 'verified field is required',
    invalidMsg: (v) => `verified must be ISO-8601 (YYYY-MM-DD); got ${v}`,
  },
  {
    key: 'review-cadence',
    isValid: Schema.is(CadenceSchema),
    required: true,
    checkId: 'FM06',
    missingMsg: 'review-cadence field is required',
    invalidMsg: (v) => `review-cadence must be one of ${VALID_CADENCES.join(', ')} (got ${v})`,
  },
  {
    key: 'enforced-by',
    isValid: Schema.is(EnforcedBySchema),
    required: false,
    checkId: 'FM09',
    missingMsg: '',
    invalidMsg: (v) => `enforced-by must be one of ${VALID_ENFORCED_BY.join(', ')} (got ${v})`,
  },
  {
    key: 'length-exception',
    isValid: Schema.is(LengthExceptionSchema),
    required: false,
    checkId: 'FM10',
    missingMsg: '',
    invalidMsg: (v) =>
      `length-exception value must include a parseable integer ceiling (patterns: "≤N", "<=N", "ceiling N", "ceiling raised to N"); got: ${v}`,
  },
];

function checkFmFieldRules(file: FileData, fm: Frontmatter): Violation[] {
  const v: Violation[] = [];
  for (const rule of FIELD_RULES) {
    const raw = fm[rule.key];
    const present = typeof raw === 'string' && raw.trim() !== '';
    if (!present) {
      if (rule.required) v.push(mk(file, 1, rule.checkId, rule.missingMsg));
      continue;
    }
    const candidate = rule.key === 'enforced-by' ? (raw as string).trim() : (raw as string);
    if (!rule.isValid(candidate)) {
      v.push(mk(file, 1, rule.checkId, rule.invalidMsg(candidate)));
    }
  }
  return v;
}

function checkFmVerifiedAgainst(file: FileData, fm: Frontmatter, repoRoot: string): Violation[] {
  const va = fm['verified-against'];
  if (va == null) return [mk(file, 1, 'FM05', 'verified-against field is required')];
  if (va.length === 0)
    return [mk(file, 1, 'FM05', 'verified-against must list at least one path or rule-id')];
  const v: Violation[] = [];
  for (const p of va) {
    if (/^#\d+$/.test(p.trim())) continue;
    if (!existsSync(join(repoRoot, p.replace(/\/$/, ''))))
      v.push(mk(file, 1, 'FM07', `verified-against path does not exist: ${p}`));
  }
  return v;
}

function cadenceAgeLimit(cadence: string): number {
  if (cadence === 'quarterly') return TUNABLES.QUARTERLY_MAX_AGE_DAYS;
  if (cadence === 'on-architectural-change') return TUNABLES.ON_ARCH_CHANGE_MAX_AGE_DAYS;
  return -1;
}

function checkFmVerifiedAge(file: FileData, fm: Frontmatter, today: Date): Violation[] {
  if (
    !(
      fm.verified != null &&
      fm.verified !== '' &&
      fm['review-cadence'] != null &&
      fm['review-cadence'] !== ''
    )
  )
    return [];
  const verifiedDate = parseIsoDate(fm.verified);
  if (verifiedDate == null) return [];
  const age = daysBetween(today, verifiedDate);
  const cadence = fm['review-cadence'];
  const limit = cadenceAgeLimit(cadence);
  if (limit <= 0 || age <= limit) return [];
  return [
    mkWarn(
      file,
      1,
      'FM08',
      `verified date ${fm.verified} is ${age} days old; review-cadence: ${cadence} limit is ${limit} days`,
    ),
  ];
}

function checkFrontmatter(file: FileData, repoRoot: string, today: Date): Violation[] {
  const fm = file.frontmatter;
  if (fm == null) {
    return [mk(file, 1, 'FM01', 'YAML frontmatter is required; file must start with --- delimiter')];
  }
  return [
    ...checkFmFieldRules(file, fm),
    ...checkFmVerifiedAgainst(file, fm, repoRoot),
    ...checkFmVerifiedAge(file, fm, today),
  ];
}

function lengthCeiling(file: FileData): number {
  const exc = file.frontmatter?.['length-exception'];
  if (exc == null || exc === '') return TUNABLES.DEFAULT_LENGTH_CEILING;
  const m = exc.match(/(?:≤|<=|ceiling\s+raised\s+to|ceiling)\s*(\d+)/i);
  return m != null ? Number(m[1]) : TUNABLES.DEFAULT_LENGTH_CEILING;
}

function checkLength(file: FileData): Violation[] {
  const ceiling = lengthCeiling(file);
  if (file.lineCount <= ceiling) return [];
  const tag = (file.frontmatter?.['length-exception'] ?? '') !== '' ? ' (length-exception declared)' : '';
  return [mk(file, file.lineCount, 'LN01', `file is ${file.lineCount} lines; ceiling is ${ceiling}${tag}`)];
}

const PHASE_JOURNAL_REGEX =
  /\bPhase\s+\d+\s+(done|complete|in\s+progress|in\s+flight|next|shipped|merged|finished)\b|\bcurrently\s+working\s+on\b|\bnext\s+sub[- ]phase\b|\bwave\s+[A-Z]\s+(complete|in\s+progress|merged|shipped|finished)\b|\bWave\s+\d+\s+(in\s+flight|shipped|merged|finished|complete|in\s+progress)\b|\bWave\s+\d+\s+is\s+complete\b|\(Phase\s+\d+\)|^##\s+Phase\s+(status|history)\b/im;

const PHASE_LITERAL_REGEX = /\bPhase\s+[A-Z0-9][A-Za-z0-9]*\+?(?=\W|$)|\bphase-[a-z][a-z0-9-]*\b/;
const MOTIVATIONAL_REGEX =
  /\b(be\s+simple|don'?t\s+over[- ]engineer|think\s+before\s+coding|keep\s+it\s+clean|surface\s+tradeoffs|simplicity\s+first)\b/i;
const EM_DASH_REGEX = /—|(?<=\w)--(?=\w)/;
const PR_REGEX = /(?<![A-Za-z0-9])#\d+(?!\w)/;
const ISO_DATE_REGEX = /\b\d{4}-\d{2}-\d{2}\b/;
const LONG_DATE_REGEX = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}\b/;
const SECOND_PERSON_REGEX = /\b(you\s+(?:should|must|can|will|need|may|might|could)|if\s+you)\b/i;

const EMOJI_REGEX =
  /[\u{1F300}-\u{1F9FF}\u{1FA00}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}\u{2300}-\u{23FF}\u{2700}-\u{27BF}\u{2B00}-\u{2BFF}\u{1F100}-\u{1F1FF}\u{1F680}-\u{1F6FF}]/u;

function snippet(s: string): string {
  return s.trim().slice(0, 80);
}

function nodeStartLine(node: Nodes): number {
  return node.position?.start.line ?? 1;
}

function fileLine(file: FileData, mdastLine: number): number {
  return file.bodyStartLine + mdastLine - 1;
}

function lineOffsetInText(text: string, offset: number): number {
  let count = 0;
  const end = Math.min(offset, text.length);
  for (let i = 0; i < end; i++) if (text.charCodeAt(i) === 10) count++;
  return count;
}

function findAllMatches(text: string, re: RegExp): Array<{ index: number; match: string }> {
  const flags = re.flags.includes('g') ? re.flags : `${re.flags}g`;
  const r = new RegExp(re.source, flags);
  const out: Array<{ index: number; match: string }> = [];
  for (let m = r.exec(text); m !== null; m = r.exec(text)) {
    out.push({ index: m.index, match: m[0] });
    if (m.index === r.lastIndex) r.lastIndex++;
  }
  return out;
}

function headingText(h: Heading): string {
  let out = '';
  for (const child of h.children) {
    if ('value' in child && typeof child.value === 'string') out += child.value;
  }
  return out;
}

function checkBodyContent(file: FileData): Violation[] {
  const v: Violation[] = [];

  const ap01Lines = new Set<number>();
  visit(file.ast, 'text', (node: Text) => {
    const text = node.value;
    const baseLine = fileLine(file, nodeStartLine(node));
    const lineFor = (idx: number): number => baseLine + lineOffsetInText(text, idx);
    for (const m of findAllMatches(text, PHASE_JOURNAL_REGEX)) {
      const ln = lineFor(m.index);
      ap01Lines.add(ln);
      v.push(mk(file, ln, 'AP01', `phase-journal pattern detected: ${snippet(m.match)}`));
    }
    for (const m of findAllMatches(text, MOTIVATIONAL_REGEX))
      v.push(mk(file, lineFor(m.index), 'AP02', `motivational-prose pattern detected: ${snippet(m.match)}`));
    for (const m of findAllMatches(text, EM_DASH_REGEX))
      v.push(
        mk(
          file,
          lineFor(m.index),
          'AP03',
          'em dash or double-hyphen in body content; use comma, colon, or restructure',
        ),
      );
    for (const m of findAllMatches(text, PHASE_LITERAL_REGEX)) {
      const ln = lineFor(m.index);
      if (ap01Lines.has(ln)) continue;
      v.push(
        mkWarn(
          file,
          ln,
          'AP04',
          `bare "Phase N" reference; confirm it is procedure ordering, not status: ${snippet(m.match)}`,
        ),
      );
    }

    const textNoQuotes = stripDoubleQuoted(text);
    for (const m of findAllMatches(textNoQuotes, SECOND_PERSON_REGEX))
      v.push(
        mkWarn(
          file,
          lineFor(m.index),
          'AP05',
          `second-person address; use "must" or describe the rule impersonally: ${snippet(m.match)}`,
        ),
      );
    for (const m of findAllMatches(text, PR_REGEX))
      v.push(
        mk(
          file,
          lineFor(m.index),
          'BD01',
          `PR reference in body; allowed only in verified-against: ${snippet(m.match)}`,
        ),
      );
    for (const m of findAllMatches(text, ISO_DATE_REGEX))
      v.push(
        mk(
          file,
          lineFor(m.index),
          'BD02',
          'absolute date in body content; dates belong in verified frontmatter',
        ),
      );
    for (const m of findAllMatches(text, LONG_DATE_REGEX))
      v.push(
        mk(
          file,
          lineFor(m.index),
          'BD02',
          'absolute date in body content; dates belong in verified frontmatter',
        ),
      );
  });
  return v;
}

function checkHeadingDepth(file: FileData): Violation[] {
  const v: Violation[] = [];
  visit(file.ast, 'heading', (node: Heading) => {
    if (node.depth >= 4) {
      v.push(
        mkWarn(
          file,
          fileLine(file, nodeStartLine(node)),
          'SH08',
          `heading depth ≥H4 is banned (style line 89: "Never deeper than H3"): ${snippet(headingText(node))}`,
        ),
      );
    }
  });
  return v;
}

function checkEmoji(file: FileData): Violation[] {
  const v: Violation[] = [];
  visit(file.ast, 'text', (node: Text) => {
    const text = node.value;
    const baseLine = fileLine(file, nodeStartLine(node));
    for (const m of findAllMatches(text, EMOJI_REGEX)) {
      v.push(
        mkWarn(
          file,
          baseLine + lineOffsetInText(text, m.index),
          'EM01',
          `emoji in body content is banned (style line 141): ${snippet(m.match)}`,
        ),
      );
    }
  });
  return v;
}

function checkSkillSection(file: FileData): Violation[] {
  if (file.kind !== 'skill-md') return [];
  let found = false;
  for (const node of file.ast.children) {
    if (node.type === 'heading' && node.depth === 2) {
      if (/^When\s+NOT\s+to\s+use\b/.test(headingText(node))) {
        found = true;
        break;
      }
    }
  }
  if (found) return [];
  return [
    mkWarn(
      file,
      1,
      'SK01',
      'SKILL.md is missing the mandatory "## When NOT to use" section (Constitution §Skill Lifecycle)',
    ),
  ];
}

const SKILL_PATH_REF_REGEX = /[\w./-]+\.(?:ts|tsx|svelte|rs|md|sh|yml|toml|json)/g;

function skillBodyCitesPaths(file: FileData, repoRoot: string): boolean {
  const text = stripFencedCodeBlocks(file.body);
  SKILL_PATH_REF_REGEX.lastIndex = 0;
  for (let m = SKILL_PATH_REF_REGEX.exec(text); m !== null; m = SKILL_PATH_REF_REGEX.exec(text)) {
    const candidate = m[0].replace(/[`,.;:)\]]+$/, '').replace(/^[`([]+/, '');
    if (candidate === '') continue;

    if (candidate.endsWith('SKILL.md') || candidate === 'CLAUDE.md') continue;
    if (existsSync(join(repoRoot, candidate))) return true;
  }
  return false;
}

function checkSkillFrontmatterDrift(file: FileData, repoRoot: string): Violation[] {
  if (file.kind !== 'skill-md') return [];
  const fm = file.frontmatter;
  if (fm == null) return [];
  const v: Violation[] = [];
  const va = fm['verified-against'];
  if (va === undefined) {
    if (skillBodyCitesPaths(file, repoRoot)) {
      v.push(
        mkWarn(
          file,
          1,
          'FM05',
          'SKILL.md cites code paths in its body but is missing verified-against; add a list so lint can detect drift',
        ),
      );
    }
    return v;
  }
  for (const rawRef of va) {
    const ref = rawRef.trim();
    if (/^#\d+$/.test(ref)) continue;
    if (!existsSync(join(repoRoot, ref.replace(/\/$/, ''))))
      v.push(mkWarn(file, 1, 'FM07', `verified-against path does not exist: ${ref}`));
  }
  return v;
}

const SHAPE1_REQUIRED_FIELDS: ReadonlyArray<{ key: string; id: string }> = [
  { key: '**Why:**', id: 'SH02' },
  { key: '**How to apply:**', id: 'SH03' },
  { key: '**Enforced by:**', id: 'SH04' },
];
const SHAPE1_COMPACT_HEADING = 'Hard Constraints (DO NOT)';

const SHAPE1_COMPACT_HEADING_REGEX = /^hard constraints \(do not\)(\s*:\s*\S.*)?$/i;

function markerHasContent(sectionText: string, marker: string): boolean {
  const idx = sectionText.indexOf(marker);
  if (idx === -1) return true;
  const tail = sectionText.slice(idx + marker.length);

  const sameLineEnd = tail.indexOf('\n');
  const sameLineSegment = sameLineEnd === -1 ? tail : tail.slice(0, sameLineEnd);
  const sameLineVisible = sameLineSegment.replace(/\s+/g, '').length;
  if (sameLineVisible >= TUNABLES.MARKER_MIN_CONTENT_CHARS) return true;

  const window = tail.slice(0, TUNABLES.MARKER_PROXIMITY_WINDOW);
  if (window.replace(/\s+/g, '').length > 0) {
    const lookahead = tail.slice(0, 100).replace(/\s+/g, '');
    if (lookahead.length >= TUNABLES.MARKER_MIN_CONTENT_CHARS) return true;
  }
  return false;
}

function checkShape1Structure(file: FileData): Violation[] {
  const v: Violation[] = [];

  const proseLines = prepareProseLines(file.body);
  const h2Indices: number[] = [];
  for (let i = 0; i < proseLines.length; i++) {
    if (/^## /.test(proseLines[i])) h2Indices.push(i);
  }
  for (let hi = 0; hi < h2Indices.length; hi++) {
    const start = h2Indices[hi];
    const end = hi + 1 < h2Indices.length ? h2Indices[hi + 1] : proseLines.length;
    const sectionLines = proseLines.slice(start, end);
    const detection = sectionLines.slice(0, TUNABLES.SHAPE1_DETECTION_WINDOW).join('\n');
    if (!detection.includes('**Rule:**')) continue;
    const sectionText = sectionLines.join('\n');
    const heading = (sectionLines[0] ?? '').replace(/^## /, '').trim();
    for (const { key, id } of SHAPE1_REQUIRED_FIELDS) {
      if (!sectionText.includes(key)) {
        v.push(
          mk(
            file,
            file.bodyStartLine + start,
            id,
            `Shape 1 (Hard Constraint) section "${heading}" is missing required field ${key}; see docs/claude-md-constitution.md §The Three Shapes`,
          ),
        );
      } else if (!markerHasContent(sectionText, key)) {
        v.push(
          mk(
            file,
            file.bodyStartLine + start,
            'SH07',
            `Shape 1 (Hard Constraint) section "${heading}" has empty ${key} marker (need ≥${TUNABLES.MARKER_MIN_CONTENT_CHARS} visible chars of content adjacent to the marker)`,
          ),
        );
      }
    }
  }
  return v;
}

const SHAPE1_COMPACT_BULLET_REGEX = /^- \*\*(NO|MUST NOT|MUST)\b/;

function checkShape1Compact(file: FileData): Violation[] {
  const v: Violation[] = [];

  const lines = stripFencedCodeBlocks(file.body).split('\n');
  let inSection = false;
  let sectionStartLine = 0;
  let bullets = 0;

  let currentBullet: string[] | null = null;
  let currentBulletStartLine = 0;
  const flush = (): void => {
    if (currentBullet === null) return;
    const text = currentBullet.join('\n');
    if (!text.includes('Enforced by:')) {
      v.push(
        mk(
          file,
          file.bodyStartLine + currentBulletStartLine,
          'SH05',
          `Shape 1 Compact bullet under "${SHAPE1_COMPACT_HEADING}" is missing "Enforced by:"; ${snippet(text)}`,
        ),
      );
    }
    currentBullet = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^## /.test(line)) {
      if (inSection) {
        flush();
        if (bullets === 0)
          v.push(
            mk(
              file,
              file.bodyStartLine + sectionStartLine,
              'SH06',
              `Section "## ${SHAPE1_COMPACT_HEADING}" has zero bullets; either add Shape 1 Compact bullets or rename the heading`,
            ),
          );
      }
      const heading = line.replace(/^## /, '').trim();
      if (SHAPE1_COMPACT_HEADING_REGEX.test(heading)) {
        inSection = true;
        sectionStartLine = i;
        bullets = 0;
        currentBullet = null;
      } else {
        inSection = false;
      }
      continue;
    }
    if (!inSection) continue;
    if (SHAPE1_COMPACT_BULLET_REGEX.test(line)) {
      flush();
      bullets++;
      currentBullet = [line];
      currentBulletStartLine = i;
    } else if (currentBullet !== null) {
      if (line.trim() === '') {
        flush();
      } else if (/^- /.test(line)) {
        flush();
      } else {
        currentBullet.push(line);
      }
    }
  }
  if (inSection) {
    flush();
    if (bullets === 0)
      v.push(
        mk(
          file,
          file.bodyStartLine + sectionStartLine,
          'SH06',
          `Section "## ${SHAPE1_COMPACT_HEADING}" has zero bullets; either add Shape 1 Compact bullets or rename the heading`,
        ),
      );
  }
  return v;
}

function checkCodeBlocks(file: FileData): Violation[] {
  const v: Violation[] = [];
  visit(file.ast, 'code', (node: Code) => {
    const innerLines = node.value === '' ? 0 : node.value.split('\n').length;
    if (innerLines > 5) {
      v.push(
        mk(
          file,
          fileLine(file, nodeStartLine(node)),
          'BD03',
          `fenced code block is ${innerLines} lines (limit 5); point to the canonical file instead`,
        ),
      );
    }
  });
  return v;
}

const SKILL_REF_REGEX = /`([a-z][a-z0-9-]*)`\s+(skill|hook)\b/g;
const ROADMAP_REF_REGEX = /`(roadmap\/[a-zA-Z0-9_./-]+)`/g;
const AST_GREP_REF_REGEX = /`(\.?ast-grep\/rules\/[a-zA-Z0-9_./-]+\.yml)`/g;
const CLAUDE_MD_REF_REGEX = /`([a-zA-Z0-9_./-]+CLAUDE\.md)`/g;
const SKILL_REF_SKIP = new Set(['it', 'the', 'a', 'an', 'this', 'that']);

const KEBAB_IDENT_REGEX = /`([a-z]+(?:-[a-z0-9]+)+)`/g;

const XR05_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.svelte',
  '.css',
  '.scss',
  '.rs',
  '.brs',
  '.py',
  '.sql',
  '.yml',
  '.toml',
];
const XR05_EXTENSIONS_REGEX = new RegExp(
  `(${XR05_EXTENSIONS.map((e) => e.replace(/\./g, '\\.')).join('|')})$`,
);

function resolveRelativeToFileOrRoot(ref: string, file: FileData, repoRoot: string): boolean {
  const cleaned = ref.replace(/\/$/, '');
  if (existsSync(join(dirname(file.path), cleaned))) return true;
  if (existsSync(join(repoRoot, cleaned))) return true;
  return false;
}

function execAll(re: RegExp, line: string): RegExpExecArray[] {
  re.lastIndex = 0;
  const out: RegExpExecArray[] = [];
  for (let m = re.exec(line); m !== null; m = re.exec(line)) out.push(m);
  return out;
}

function skillSearchRoots(repoRoot: string): string[] {
  const roots = [join(repoRoot, '.claude/skills')];
  const pluginsDir = join(repoRoot, 'plugins');
  let pluginEntries: string[];
  try {
    pluginEntries = readdirSync(pluginsDir);
  } catch {
    return roots;
  }
  for (const entry of pluginEntries) {
    const skillsDir = join(pluginsDir, entry, 'skills');
    try {
      if (statSync(skillsDir).isDirectory()) roots.push(skillsDir);
    } catch {}
  }
  return roots;
}

function skillDirResolves(repoRoot: string, skill: string): boolean {
  return skillSearchRoots(repoRoot).some((root) => existsSync(join(root, skill)));
}

function loadKnownSkillNames(repoRoot: string): Set<string> {
  const out = new Set<string>();
  for (const skillsDir of skillSearchRoots(repoRoot)) {
    let entries: string[];
    try {
      entries = readdirSync(skillsDir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(skillsDir, entry);
      let s: ReturnType<typeof statSync>;
      try {
        s = statSync(full);
      } catch {
        continue;
      }
      if (!s.isDirectory()) continue;

      out.add(entry);

      const skillMd = join(full, 'SKILL.md');
      try {
        const text = readFileSync(skillMd, 'utf8');
        const parsed = parseFrontmatter(text);
        if (parsed != null) {
          const fm = parsed.fm as unknown as Record<string, string>;
          if (fm['name'] != null && fm['name'] !== '') out.add(fm['name'].trim());
        }
      } catch {}
    }
  }
  return out;
}

const KEBAB_IDENT_SKIP = new Set<string>([
  'package-lock',
  'pnpm-lock',
  'pnpm-workspace',
  'pre-commit',
  'pre-edit',
  'pre-push',
  'post-merge',
  'pre-edit-claude-md-lint',
  'tsconfig-base',
  'tsconfig-build',

  'min-content',
  'max-content',

  'effect-language-service',

  'phase-journal',
  'motivational-prose',

  'fail-fast',
  'one-way',
  'rule-of-three',
  'opt-in',
  'opt-out',
  'on-demand',
  'on-call',
  'long-form',
  'on-architectural-change',
  'every-session',
  'inside-this-directory',
  'verified-against',
  'review-cadence',
  'length-exception',
  'enforced-by',

  'add-claude-md',
  'claude-md-audit',
  'claude-md-constitution',
  'claude-md-style',
  'lint-claude-md',

  'cargo-audit',
  'cargo-deny',
  'cargo-nextest',
]);

const SKILL_SUFFIX_REGEX = /-(?:author|expertise|audit|map|debugging|completion|comments|commit|singleton)$/;
const CODE_IDENT_PREFIX_REGEX = /\b(function|class|const|let|var|interface|type)\s*$/;

function checkSkillRefsOnLine(file: FileData, line: string, lineNo: number, repoRoot: string): Violation[] {
  const v: Violation[] = [];
  for (const m of execAll(SKILL_REF_REGEX, line)) {
    const skill = m[1];
    if (SKILL_REF_SKIP.has(skill.toLowerCase())) continue;
    if (!skillDirResolves(repoRoot, skill))
      v.push(
        mk(
          file,
          lineNo,
          'XR01',
          `skill reference does not resolve: ${skill} (expected .claude/skills/${skill}/ or a plugin's skills/${skill}/)`,
        ),
      );
  }
  return v;
}

function isLikelyKebabSkillTypo(
  tok: string,
  line: string,
  matchIndex: number,
  knownSkills: Set<string>,
): boolean {
  if (tok.includes('/') || tok.includes('@') || tok.includes('.')) return false;
  if (KEBAB_IDENT_SKIP.has(tok)) return false;
  if (knownSkills.has(tok)) return false;

  const before = line.slice(0, matchIndex).trimEnd();
  if (CODE_IDENT_PREFIX_REGEX.test(before)) return false;
  return SKILL_SUFFIX_REGEX.test(tok);
}

function checkKebabSkillTyposOnLine(
  file: FileData,
  line: string,
  lineNo: number,
  knownSkills: Set<string>,
): Violation[] {
  const v: Violation[] = [];
  for (const m of execAll(KEBAB_IDENT_REGEX, line)) {
    const tok = m[1];
    if (!isLikelyKebabSkillTypo(tok, line, m.index ?? 0, knownSkills)) continue;
    v.push(
      mk(
        file,
        lineNo,
        'XR01',
        `kebab-case identifier "${tok}" looks like a skill name but does not resolve to .claude/skills/${tok}/ or a plugin's skills/${tok}/`,
      ),
    );
  }
  return v;
}

function checkRoadmapRefsOnLine(file: FileData, line: string, lineNo: number, repoRoot: string): Violation[] {
  const v: Violation[] = [];
  for (const m of execAll(ROADMAP_REF_REGEX, line)) {
    const ref = m[1];
    if (ref.includes('<') || ref.includes('>')) continue;
    if (!existsSync(join(repoRoot, ref.replace(/\/$/, ''))))
      v.push(mk(file, lineNo, 'XR02', `roadmap reference does not resolve: ${ref}`));
  }
  return v;
}

function checkClaudeMdRefsOnLine(
  file: FileData,
  line: string,
  lineNo: number,
  repoRoot: string,
): Violation[] {
  const v: Violation[] = [];
  for (const m of execAll(CLAUDE_MD_REF_REGEX, line)) {
    const ref = m[1];
    if (ref.includes('<') || ref.includes('>') || ref === 'CLAUDE.md') continue;
    if (!resolveRelativeToFileOrRoot(ref, file, repoRoot))
      v.push(mk(file, lineNo, 'XR03', `CLAUDE.md reference does not resolve: ${ref}`));
  }
  return v;
}

function checkAstGrepRefsOnLine(file: FileData, line: string, lineNo: number, repoRoot: string): Violation[] {
  const v: Violation[] = [];
  for (const m of execAll(AST_GREP_REF_REGEX, line)) {
    const ref = m[1].startsWith('.') ? m[1] : `.${m[1]}`;
    if (!existsSync(join(repoRoot, ref)))
      v.push(mk(file, lineNo, 'XR04', `ast-grep rule reference does not resolve: ${m[1]}`));
  }
  return v;
}

function checkCrossReferences(file: FileData, repoRoot: string, knownSkills: Set<string>): Violation[] {
  const v: Violation[] = [];
  const prose = prepareLinesPreservingInlineCode(file.body);
  for (let i = 0; i < prose.length; i++) {
    const line = prose[i];
    const lineNo = file.bodyStartLine + i;
    v.push(...checkSkillRefsOnLine(file, line, lineNo, repoRoot));
    v.push(...checkKebabSkillTyposOnLine(file, line, lineNo, knownSkills));
    v.push(...checkRoadmapRefsOnLine(file, line, lineNo, repoRoot));
    v.push(...checkClaudeMdRefsOnLine(file, line, lineNo, repoRoot));
    v.push(...checkAstGrepRefsOnLine(file, line, lineNo, repoRoot));
  }
  return v;
}

type MtimeCache = Map<string, Date | null>;

function checkVerifiedAgainstDrift(file: FileData, repoRoot: string, mtimeCache: MtimeCache): Violation[] {
  const v: Violation[] = [];
  const fm = file.frontmatter;
  if (fm == null) return v;
  const verifiedDate = fm.verified != null && fm.verified !== '' ? parseIsoDate(fm.verified) : null;
  if (verifiedDate == null) return v;
  const va = fm['verified-against'];
  if (va == null || va.length === 0) return v;
  for (const rawRef of va) {
    const ref = rawRef.trim();
    if (/^#\d+$/.test(ref)) continue;
    const abs = join(repoRoot, ref.replace(/\/$/, ''));
    let s: ReturnType<typeof statSync>;
    try {
      s = statSync(abs);
    } catch {
      continue;
    }
    if (!s.isDirectory()) continue;
    let newest: Date | null;
    if (mtimeCache.has(abs)) {
      newest = mtimeCache.get(abs) ?? null;
    } else {
      newest = newestSourceMtime(abs, repoRoot);
      mtimeCache.set(abs, newest);
    }
    if (newest === null) continue;
    const drift = daysBetween(newest, verifiedDate);
    if (drift > TUNABLES.VERIFIED_AGAINST_DRIFT_DAYS) {
      v.push(
        mkWarn(
          file,
          1,
          'XR05',
          `verified-against directory ${ref} has source-file mtime ${drift} days newer than verified: ${fm.verified} (drift threshold ${TUNABLES.VERIFIED_AGAINST_DRIFT_DAYS} days)`,
        ),
      );
    }
  }
  return v;
}

function newestSourceMtime(dir: string, repoRoot: string): Date | null {
  let newest: Date | null = null;
  const walk = (current: string): void => {
    const relCurrent = relative(repoRoot, current);
    if (isExcluded(relCurrent)) return;
    if (isCargoBuildOutput(current)) return;
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(current, entry);
      let s: ReturnType<typeof statSync>;
      try {
        s = statSync(full);
      } catch {
        continue;
      }
      if (s.isDirectory()) {
        walk(full);
      } else if (s.isFile() && XR05_EXTENSIONS_REGEX.test(entry)) {
        if (newest === null || s.mtime > newest) newest = s.mtime;
      }
    }
  };
  walk(dir);
  return newest;
}

function buildWindowMap(body: string, minLen: number): Map<string, number> {
  const m = new Map<string, number>();
  if (body.length < minLen) return m;
  for (let i = 0; i + minLen <= body.length; i++) {
    const w = body.slice(i, i + minLen);
    if (!m.has(w)) m.set(w, i);
  }
  return m;
}

function findFirstDuplicateWithMap(
  a: string,
  aWindows: Map<string, number>,
  b: string,
  minLen: number,
): { aIdx: number; bIdx: number; len: number } | null {
  if (a.length < minLen || b.length < minLen) return null;
  for (let j = 0; j + minLen <= b.length; j++) {
    const aIdx = aWindows.get(b.slice(j, j + minLen));
    if (aIdx !== undefined) {
      let len = minLen;
      while (aIdx + len < a.length && j + len < b.length && a[aIdx + len] === b[j + len]) len++;
      return { aIdx, bIdx: j, len };
    }
  }
  return null;
}

function indexToLine(body: string, idx: number, bodyStartLine: number): number {
  let line = bodyStartLine;
  for (let i = 0; i < idx && i < body.length; i++) if (body[i] === '\n') line++;
  return line;
}

function checkDuplication(files: FileData[]): Violation[] {
  const v: Violation[] = [];

  const windowMaps: Map<string, number>[] = files.map((f) =>
    buildWindowMap(f.body, TUNABLES.DUPLICATE_MIN_LEN),
  );
  for (let i = 0; i < files.length; i++) {
    for (let j = i + 1; j < files.length; j++) {
      const dup = findFirstDuplicateWithMap(
        files[i].body,
        windowMaps[i],
        files[j].body,
        TUNABLES.DUPLICATE_MIN_LEN,
      );
      if (dup == null) continue;
      const lineI = indexToLine(files[i].body, dup.aIdx, files[i].bodyStartLine);
      const lineJ = indexToLine(files[j].body, dup.bIdx, files[j].bodyStartLine);

      const severity: Severity =
        files[i].kind === 'skill-md' || files[j].kind === 'skill-md' ? 'warning' : 'error';
      v.push({
        file: files[i].relPath,
        line: lineI,
        checkId: 'DU01',
        message: `${dup.len}-char duplicate block also appears at ${files[j].relPath}:${lineJ}`,
        severity,
      });
    }
  }
  return v;
}

export function lintFile(absPath: string, repoRoot: string, today: Date = new Date()): Violation[] {
  const file = loadFile(absPath, repoRoot);
  const knownSkills = loadKnownSkillNames(repoRoot);
  const mtimeCache: MtimeCache = new Map();
  return lintLoadedFile(file, repoRoot, today, knownSkills, mtimeCache);
}

export function lintFiles(
  absPaths: string[],
  repoRoot: string,
  today: Date = new Date(),
  onProgress?: (msg: string) => void,
): Violation[] {
  const log = onProgress ?? ((): void => {});
  log(`Loading ${absPaths.length} file(s)...`);
  const files = absPaths.map((p) => loadFile(p, repoRoot));
  log('Loading known skill names...');
  const knownSkills = loadKnownSkillNames(repoRoot);

  const mtimeCache: MtimeCache = new Map();
  const out: Violation[] = [];
  const total = files.length;
  const width = String(total).length;
  for (let i = 0; i < total; i++) {
    const file = files[i];
    log(`[${String(i + 1).padStart(width)}/${total}] linting ${file.relPath}`);
    out.push(...lintLoadedFile(file, repoRoot, today, knownSkills, mtimeCache));
  }
  log(`Cross-file duplication scan across ${total} file(s)...`);
  out.push(...checkDuplication(files));
  log(`Done: ${out.length} violation(s).`);
  return out;
}

function lintLoadedFile(
  file: FileData,
  repoRoot: string,
  today: Date,
  knownSkills: Set<string>,
  mtimeCache: MtimeCache,
): Violation[] {
  const collected: Violation[] = [];
  if (file.kind !== 'skill-md') {
    collected.push(...checkFrontmatter(file, repoRoot, today));
    collected.push(...checkShape1Structure(file));
    collected.push(...checkShape1Compact(file));
    collected.push(...checkVerifiedAgainstDrift(file, repoRoot, mtimeCache));
  } else {
    collected.push(...checkSkillFrontmatterDrift(file, repoRoot));
  }
  collected.push(...checkLength(file));
  collected.push(...checkBodyContent(file));
  collected.push(...checkCodeBlocks(file));
  collected.push(...checkCrossReferences(file, repoRoot, knownSkills));
  collected.push(...checkHeadingDepth(file));
  collected.push(...checkEmoji(file));
  collected.push(...checkSkillSection(file));

  if (file.kind === 'skill-md') {
    for (const v of collected) v.severity = 'warning';
  }
  return collected;
}

function formatHuman(violations: Violation[], scannedCount: number): string {
  if (violations.length === 0) return `OK: ${scannedCount} file(s) scanned, 0 violations.\n`;
  const byFile = new Map<string, Violation[]>();
  for (const v of violations) {
    if (!byFile.has(v.file)) byFile.set(v.file, []);
    (byFile.get(v.file) as Violation[]).push(v);
  }
  const out: string[] = [];
  for (const [file, vs] of [...byFile.entries()].sort()) {
    out.push(`${file}:`);
    for (const v of vs.sort((a, b) => a.line - b.line))
      out.push(`  ${file}:${v.line} [${v.checkId}] (${v.severity}) ${v.message}`);
  }
  out.push('');
  const errors = violations.filter((v) => v.severity === 'error').length;
  const warnings = violations.length - errors;
  out.push(
    `${errors} error(s), ${warnings} warning(s) across ${byFile.size} file(s); ${scannedCount} file(s) scanned.`,
  );
  return `${out.join('\n')}\n`;
}

function formatJson(violations: Violation[], scannedCount: number): string {
  return `${JSON.stringify({ scanned: scannedCount, violations }, null, 2)}\n`;
}

export const CLEAN_EXIT_CODE = 0;
export const VIOLATIONS_EXIT_CODE = 1;
export const SCRIPT_ERROR_EXIT_CODE = 2;
export const EMPTY_SCAN_SET_EXIT_CODE = 3;

export type EmptyScanSetRefusal = { readonly exitCode: number; readonly message: string };

const EMPTY_SCAN_SET_MESSAGE = [
  'No CLAUDE.md files found to scan.',
  'This is a FAIL-CLOSED refusal, not a pass: a walker that silently stopped finding files is',
  'indistinguishable from a repo that genuinely has none, so an empty scan set is never green.',
  'Author a root CLAUDE.md, or pass explicit paths to scope the run.',
  '',
].join('\n');

export const emptyScanSetRefusal = (targets: readonly string[]): EmptyScanSetRefusal | null =>
  targets.length === 0 ? { exitCode: EMPTY_SCAN_SET_EXIT_CODE, message: EMPTY_SCAN_SET_MESSAGE } : null;

export function runLint(argv: readonly string[], cwd: string): number {
  const args = parseArgs([...argv]);
  if (args.help) {
    process.stdout.write(HELP_TEXT);
    return CLEAN_EXIT_CODE;
  }
  const today = resolveToday(args.today);
  const repoRoot = findRepoRoot(cwd);
  const log = (msg: string): void => {
    process.stderr.write(`${msg}\n`);
  };
  log(`Discovering scan targets under ${repoRoot}... (set CLAUDE_MD_LINT_DEBUG=1 for per-directory logging)`);
  const targets = discoverScanFiles(repoRoot, args.paths, log);
  const emptyScanSet = emptyScanSetRefusal(targets);
  if (emptyScanSet !== null) {
    process.stderr.write(emptyScanSet.message);
    return emptyScanSet.exitCode;
  }
  log(`Found ${targets.length} target(s).`);
  const violations = lintFiles(targets, repoRoot, today, log);
  process.stdout.write(
    args.json ? formatJson(violations, targets.length) : formatHuman(violations, targets.length),
  );
  const errors = violations.filter((v) => v.severity === 'error').length;
  return errors > 0 ? VIOLATIONS_EXIT_CODE : CLEAN_EXIT_CODE;
}

const main = (): number => runLint(process.argv.slice(2), process.cwd());

if (import.meta.main) {
  try {
    process.exit(main());
  } catch (err) {
    process.stderr.write(`lint-claude-md crashed: ${err instanceof Error ? err.stack : String(err)}\n`);
    process.exit(2);
  }
}
