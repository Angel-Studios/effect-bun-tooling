import * as Result from 'effect/Result';
import { type CarrierName, carrierOf, HOST_COMMENT_END_SEQUENCES, payloadLine } from './carrier.ts';
import type { FrontMatterError } from './errors.ts';
import { locateFrontMatter } from './parse.ts';
import { FIELD_REGISTRY } from './registry.ts';
import { type FrontMatter, type FrontMatterFieldValue, frontMatterEntries, isStringArray } from './schema.ts';
import { detectEol, type Eol, isBlankLine, joinLines, preambleEnd, splitLines } from './sentinel.ts';

const TOML_STRING_ESCAPES: Readonly<Record<string, string>> = {
  '\\': '\\\\',
  '"': '\\"',
  '\b': '\\b',
  '\t': '\\t',
  '\n': '\\n',
  '\f': '\\f',
  '\r': '\\r',
};

export const HOST_COMMENT_NEUTRALISATION_RULE = `A rendered payload must never change WHERE THE HOST COMMENT ENDS.

That, and not "a comment terminator", is the set. A sequence qualifies when its presence in the payload
relocates the end of the comment the front matter is carried in, in either direction:

  */    ends the block comment EARLY. The rest of the file is then parsed as code.
  -->   ends the xml comment EARLY, the same defect in the other block carrier.
  /*    delays the end INDEFINITELY wherever the host language NESTS block comments. Rust, Swift and
        Kotlin all nest, and .rs, .swift, .kt and .kts are all block-carrier extensions, so an
        unbalanced open makes the file's own close fence terminate the INNER comment and swallows
        every declaration below it. This is the worse direction: an early close leaves a syntax error
        at a visible point, while an unterminated nest silently eats the file.

The boundary is deliberate. <!-- is NOT neutralised: an xml comment ends at its first -->, so an inner
open cannot move that end, and the xml carrier is therefore marked as not nesting. Nor is a bare --
chased, though it is strictly invalid inside an XML comment: the ratified fences ---uv and --- --> carry
-- by design, so banning it in the payload would contradict the format's own spelling.

The first character of each occurrence is rendered as its TOML \\uXXXX escape, which Bun.TOML decodes
back to that same character, so the value is PRESERVED rather than refused or mangled. Escaping the
first character alone is also what settles the overlapping inputs: **/, ---> and /*/ each decode
byte-identical, the last one because index 0 opens /* and index 1 opens */ and both are escaped.

The neutralisation is UNCONDITIONAL in all four carriers and is never keyed on the active one, because
the ratified format is one payload behind four delimiter sets: a carrier-conditional escape would make
the payload bytes differ between them. It lives inside escapeTomlBasicString, through which every
rendered string necessarily passes, so loosening the shape of any other field cannot reopen the hole,
and its set is DERIVED from the carrier table, so a fifth block-comment carrier is covered the moment
it declares whether it nests.`;

export const tomlUnicodeEscape = (character: string): string =>
  `\\u${character.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`;

export const opensHostCommentEndSequence = (value: string, index: number): boolean =>
  HOST_COMMENT_END_SEQUENCES.some((sequence) => value.startsWith(sequence, index));

const escapedCharacterAt = (value: string, index: number): string => {
  const character = value.charAt(index);
  const direct = TOML_STRING_ESCAPES[character];
  if (direct !== undefined) return direct;
  return opensHostCommentEndSequence(value, index) ? tomlUnicodeEscape(character) : character;
};

export const escapeTomlBasicString = (value: string): string => {
  let escaped = '';
  for (let index = 0; index < value.length; index += 1) escaped += escapedCharacterAt(value, index);
  return escaped;
};

export const renderTomlString = (value: string): string => `"${escapeTomlBasicString(value)}"`;

export const canonicalIdentList = (values: readonly string[]): readonly string[] =>
  [...new Set(values)].sort();

export const renderTomlArray = (values: readonly string[]): string =>
  `[${canonicalIdentList(values).map(renderTomlString).join(', ')}]`;

export const renderTomlInlineTable = (table: Readonly<Record<string, string>>): string => {
  const entries = Object.keys(table)
    .sort()
    .map((key) => `${key} = ${renderTomlString(table[key])}`);
  return `{ ${entries.join(', ')} }`;
};

export const renderTomlValue = (value: FrontMatterFieldValue): string => {
  if (typeof value === 'string') return renderTomlString(value);
  return isStringArray(value) ? renderTomlArray(value) : renderTomlInlineTable(value);
};

export const renderPayloadLines = (value: FrontMatter): readonly string[] => {
  const present = new Map(frontMatterEntries(value));
  return FIELD_REGISTRY.flatMap((entry) => {
    const found = present.get(entry.key);
    return found === undefined ? [] : [`${entry.key} = ${renderTomlValue(found)}`];
  });
};

export const renderFrontMatterLines = (value: FrontMatter, carrierName: CarrierName): readonly string[] => {
  const carrier = carrierOf(carrierName);
  return [
    carrier.open,
    ...renderPayloadLines(value).map((line) => payloadLine(carrier, line)),
    carrier.close,
  ];
};

export const renderFrontMatter = (value: FrontMatter, carrierName: CarrierName, eol: Eol): string =>
  joinLines(renderFrontMatterLines(value, carrierName), eol);

const separatorFor = (lines: readonly string[], nextIndex: number): readonly string[] =>
  nextIndex < lines.length && !isBlankLine(lines[nextIndex]) ? [''] : [];

export const upsertFrontMatter = (
  text: string,
  carrierName: CarrierName,
  value: FrontMatter,
): Result.Result<string, FrontMatterError> => {
  const located = locateFrontMatter(text, carrierName);
  if (Result.isFailure(located)) return Result.fail(located.failure);

  const eol = detectEol(text);
  const lines = [...splitLines(text)];
  const block = renderFrontMatterLines(value, carrierName);
  const span = located.success;

  if (span === undefined) {
    const insertAt = preambleEnd(lines, carrierName);
    lines.splice(insertAt, 0, ...block, ...separatorFor(lines, insertAt));
    return Result.succeed(joinLines(lines, eol));
  }

  const replaced = span.closeIndex - span.openIndex + 1;
  lines.splice(span.openIndex, replaced, ...block, ...separatorFor(lines, span.closeIndex + 1));
  return Result.succeed(joinLines(lines, eol));
};
