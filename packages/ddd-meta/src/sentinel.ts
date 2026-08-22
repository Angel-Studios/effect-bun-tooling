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
  if (isFrontMatterOpenLine(carrier, line)) return { ...scan, stopped: true };
  const spanEnd = commentSpanEnd(carrier, lines, scan.index);
  if (spanEnd === -1) return { ...scan, stopped: true };
  const spanText = joinLines(lines.slice(scan.index, spanEnd + 1), LF);
  if (!containsMachineReadDirective(spanText)) return { ...scan, stopped: true };
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
