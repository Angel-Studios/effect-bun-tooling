import {
  type Carrier,
  type CarrierName,
  carrierOf,
  isFrontMatterCloseLine,
  isFrontMatterOpenLine,
} from './carrier.ts';

export { SENTINEL, SENTINEL_TERMINATOR } from './carrier.ts';

export type Eol = '\n' | '\r\n';

export const LF: Eol = '\n';

export const CRLF: Eol = '\r\n';

export const splitLines = (text: string): readonly string[] => text.split(/\r\n|\n/);

export const joinLines = (lines: readonly string[], eol: Eol): string => lines.join(eol);

export const countOccurrences = (text: string, needle: string): number => text.split(needle).length - 1;

export const detectEol = (text: string): Eol => {
  const carriageReturnLineFeeds = countOccurrences(text, CRLF);
  const bareLineFeeds = countOccurrences(text, LF) - carriageReturnLineFeeds;
  return carriageReturnLineFeeds > bareLineFeeds ? CRLF : LF;
};

export const hasFinalNewline = (text: string): boolean => text.endsWith(LF);

export const MACHINE_READ_DIRECTIVES: readonly string[] = [
  'biome-ignore',
  'ast-grep-ignore',
  '@ts-expect-error',
  '@ts-ignore',
  '@ts-nocheck',
  'eslint-disable',
  'eslint-enable',
  'svelte-ignore',
  'prettier-ignore',
  '/// <reference',
  '@license',
  'SPDX-License-Identifier',
  'shellcheck',
  'ruff:',
  'noqa',
  '-*- coding',
  'type: ignore',
  'mypy:',
  'pylint:',
  'rustfmt::skip',
  'clippy::',
  '@flow',
  '@jsx',
];

export const containsMachineReadDirective = (text: string): boolean =>
  MACHINE_READ_DIRECTIVES.some((directive) => text.includes(directive));

export type DirectiveScope = 'file' | 'next_line';

export const PREAMBLE_SCOPE_RULE = `A machine-read directive is preamble only when consuming it cannot DETACH it from what it governs.

A file-scoped directive governs the whole file, so the block may be written below it. A next-line
directive governs the line that FOLLOWS it, so consuming it puts the block between the suppression and
its target: the suppressed diagnostic returns, and for @ts-expect-error a second error appears because
the now-pointless directive is itself TS2578. A next-line directive therefore STOPS the preamble and
the block is written ABOVE it.

Scope is read by LONGEST MATCHING TOKEN, not by first match, because two spellings are extensions of
their opposite: biome-ignore-all is file-scoped and contains the next-line token biome-ignore, while
eslint-disable-next-line is next-line-scoped and contains the file-scoped token eslint-disable. First
match would misclassify both, and biome-ignore-all is the live population — 47 real files across the
migration targets open with it.

A directive that governs its OWN line, such as noqa or a Python type: ignore, is file-scoped for this
purpose: nothing is written between it and itself, so consuming it detaches nothing.

The table is held in LEXICOGRAPHIC order, deliberately, so that its ORDER carries no protection. Both
prefix pairs therefore sit with the shorter token FIRST, which is the order in which a first-match
classifier gets both of them WRONG. Longest match is consequently load-bearing rather than merely
correct, and a test can tell the two rules apart. An ordering that happened to put the extensions first
would protect the live population by accident and leave the rule untested.`;

export const DIRECTIVE_SCOPES: readonly (readonly [string, DirectiveScope])[] = [
  ['-*- coding', 'file'],
  ['/// <reference', 'file'],
  ['@flow', 'file'],
  ['@jsx', 'file'],
  ['@license', 'file'],
  ['@ts-expect-error', 'next_line'],
  ['@ts-ignore', 'next_line'],
  ['@ts-nocheck', 'file'],
  ['SPDX-License-Identifier', 'file'],
  ['ast-grep-ignore', 'next_line'],
  ['biome-ignore', 'next_line'],
  ['biome-ignore-all', 'file'],
  ['clippy::', 'file'],
  ['eslint-disable', 'file'],
  ['eslint-disable-next-line', 'next_line'],
  ['eslint-enable', 'file'],
  ['mypy:', 'file'],
  ['noqa', 'file'],
  ['prettier-ignore', 'next_line'],
  ['pylint:', 'file'],
  ['ruff:', 'file'],
  ['rustfmt::skip', 'next_line'],
  ['shellcheck', 'file'],
  ['svelte-ignore', 'next_line'],
  ['type: ignore', 'file'],
];

export const directiveScopeOf = (text: string): DirectiveScope | undefined => {
  let matched: readonly [string, DirectiveScope] | undefined;
  for (const entry of DIRECTIVE_SCOPES) {
    const longer = matched === undefined || entry[0].length > matched[0].length;
    if (longer && text.includes(entry[0])) matched = entry;
  }
  return matched === undefined ? undefined : matched[1];
};

export const YAML_FENCE = '---';

export const YAML_FENCE_RULE = `A Markdown YAML front-matter fence is preamble, and the block goes BELOW it.

Every consumer of YAML front matter requires the fence to be the first thing in the file. Writing
above it does not break any parser and produces no syntax error anywhere; the file simply stops
having front matter. Measured at 840 real files across the two migration targets, including every
.claude/agents/**/*.md in both, whose name and model keys are how the harness registers an agent.

The fence is only a fence when it CLOSES. A leading --- with no closing --- below it is ordinary
content, so it does not open a preamble and the previous behaviour stands. That guard is what keeps
a document that merely starts with a horizontal rule from silently acquiring a preamble it has not
got.

The CLOSING fence must sit at column 0, which is what YAML requires of it. An INDENTED --- is content
inside a block scalar, and accepting one ends the scan early: the block is then spliced into the middle
of the front matter, where its column-0 open terminates the scalar and destroys the YAML. The opening
line keeps the looser trim, because a document whose first line is an indented --- is not front matter
under any reading and the scan declines it anyway.`;

export const isYamlFenceLine = (line: string): boolean => line.trim() === YAML_FENCE;

export const isYamlCloseFenceLine = (line: string): boolean => line.trimEnd() === YAML_FENCE;

export const yamlFrontMatterEnd = (lines: readonly string[]): number => {
  if (lines.length === 0 || !isYamlFenceLine(lines[0])) return -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (isYamlCloseFenceLine(lines[index])) return index;
  }
  return -1;
};

export const SHEBANG_PREFIX = '#!';

export const RUST_INNER_ATTRIBUTE_PREFIX = '#![';

export const XML_PROLOG_PREFIX = '<?';

export const XML_DOCTYPE_PREFIX = '<!DOCTYPE';

export const isBlankLine = (line: string): boolean => line.trim() === '';

export const isShebangLine = (line: string): boolean => line.startsWith(SHEBANG_PREFIX);

export const isRustInnerAttributeLine = (line: string): boolean =>
  line.trimStart().startsWith(RUST_INNER_ATTRIBUTE_PREFIX);

export const isXmlPreambleLine = (line: string): boolean => {
  const trimmed = line.trimStart();
  return trimmed.startsWith(XML_PROLOG_PREFIX) || trimmed.startsWith(XML_DOCTYPE_PREFIX);
};

const lineCommentSpanEnd = (carrier: Carrier, lines: readonly string[], index: number): number => {
  const trimmed = lines[index].trimStart();
  return carrier.lineCommentLeaders.some((leader) => trimmed.startsWith(leader)) ? index : -1;
};

const blockCommentSpanEnd = (carrier: Carrier, lines: readonly string[], index: number): number => {
  const delimiters = carrier.blockComment;
  if (delimiters === undefined) return -1;
  const trimmed = lines[index].trimStart();
  if (!trimmed.startsWith(delimiters.open)) return -1;
  if (trimmed.slice(delimiters.open.length).includes(delimiters.close)) return index;
  for (let scan = index + 1; scan < lines.length; scan += 1) {
    if (lines[scan].includes(delimiters.close)) return scan;
  }
  return lines.length - 1;
};

export const commentSpanEnd = (carrier: Carrier, lines: readonly string[], index: number): number => {
  const asBlock = blockCommentSpanEnd(carrier, lines, index);
  return asBlock === -1 ? lineCommentSpanEnd(carrier, lines, index) : asBlock;
};

type PreambleScan = {
  readonly index: number;
  readonly blankRunStart: number;
  readonly stopped: boolean;
};

const advancePreamble = (carrier: Carrier, lines: readonly string[], scan: PreambleScan): PreambleScan => {
  const line = lines[scan.index];
  if (isBlankLine(line)) {
    const blankRunStart = scan.blankRunStart === -1 ? scan.index : scan.blankRunStart;
    return { index: scan.index + 1, blankRunStart, stopped: false };
  }
  const consumed = { index: scan.index + 1, blankRunStart: -1, stopped: false };
  if (scan.index === 0 && isShebangLine(line)) return consumed;
  if (isRustInnerAttributeLine(line)) return consumed;
  if (carrier.name === 'xml' && isXmlPreambleLine(line)) return consumed;
  if (carrier.name === 'xml' && scan.index === 0) {
    const fenceEnd = yamlFrontMatterEnd(lines);
    if (fenceEnd !== -1) return { index: fenceEnd + 1, blankRunStart: -1, stopped: false };
  }
  if (isFrontMatterOpenLine(carrier, line)) return { ...scan, stopped: true };
  const spanEnd = commentSpanEnd(carrier, lines, scan.index);
  if (spanEnd === -1) return { ...scan, stopped: true };
  const spanText = joinLines(lines.slice(scan.index, spanEnd + 1), LF);
  if (directiveScopeOf(spanText) !== 'file') return { ...scan, stopped: true };
  return { index: spanEnd + 1, blankRunStart: -1, stopped: false };
};

export const preambleEnd = (lines: readonly string[], carrierName: CarrierName): number => {
  const carrier = carrierOf(carrierName);
  let scan: PreambleScan = { index: 0, blankRunStart: -1, stopped: false };
  while (!scan.stopped && scan.index < lines.length) scan = advancePreamble(carrier, lines, scan);
  if (scan.stopped) return scan.index;
  return scan.blankRunStart === -1 ? scan.index : scan.blankRunStart;
};

export const frontMatterOpenIndices = (
  lines: readonly string[],
  carrierName: CarrierName,
): readonly number[] => {
  const carrier = carrierOf(carrierName);
  const found: number[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (isFrontMatterOpenLine(carrier, lines[index])) found.push(index);
  }
  return found;
};

export const frontMatterCloseIndex = (
  lines: readonly string[],
  carrierName: CarrierName,
  from: number,
): number => {
  const carrier = carrierOf(carrierName);
  for (let index = from; index < lines.length; index += 1) {
    if (isFrontMatterCloseLine(carrier, lines[index])) return index;
  }
  return -1;
};
