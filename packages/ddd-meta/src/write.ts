import * as Result from 'effect/Result';
import { type CarrierName, carrierOf, HOST_COMMENT_END_SEQUENCES, payloadLine } from './carrier.ts';
import { type FrontMatterWriteError, payloadNotRenderable, unregisteredField } from './errors.ts';
import { locateFrontMatter, parseToml } from './parse.ts';
import { FIELD_REGISTRY, REGISTRY_KEYS } from './registry.ts';
import {
  decodeFrontMatter,
  type FrontMatter,
  type FrontMatterFieldValue,
  frontMatterEntries,
  isStringArray,
} from './schema.ts';
import { detectEol, type Eol, isBlankLine, joinLines, LF, preambleEnd, splitLines } from './sentinel.ts';

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
rendered VALUE necessarily passes, so loosening the shape of any other field cannot reopen the hole,
and its set is DERIVED from the carrier table, so a fifth block-comment carrier is covered the moment
it declares whether it nests.

It does NOT cover an inline-table KEY, which is interpolated into the payload rather than escaped. A
key carrying an end sequence is REFUSED instead, because a * is not legal in a TOML bare key and there
is nothing to preserve; see WRITE_TOTALITY_RULE.`;

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

export const WRITE_TOTALITY_RULE = `The writer never emits a payload its own reader would refuse, and it says so with a typed error.

Two refusals, and between them the write path is total over the value it is handed:

  UnregisteredField    the value declares a key the closed registry does not carry. Rendering used to
                       DROP it in silence, so a migrator handing over a field the derivability gate
                       exists to forbid got no word back. The gate binds decode; it must bind write.
  PayloadNotRenderable the rendered payload does not parse as TOML, or parses and fails field
                       validation. This is the check that covers the RENDERER rather than one helper:
                       inline-table KEYS are interpolated into the payload and never pass through
                       escapeTomlBasicString, so a links key carrying */ or /* or --> reached the file
                       verbatim and broke the host comment exactly as a value once did. A key is not
                       escapable — a * is not legal in a TOML bare key at all — so the honest answer is
                       refusal, not neutralisation.

The check is the round trip: render the payload, then parse and decode it back. That is the same
oracle the reader applies, which is why it cannot drift from the reader, and it catches classes nobody
enumerated — a control character in a links value is admitted by URI_PATTERN, is not in
TOML_STRING_ESCAPES, and is rejected by Bun.TOML both raw and escaped, so it can only be refused.

Round-tripping does NOT require the decoded value to equal the input. The writer canonicalises: an
unsorted tags list is emitted sorted and deduped, and that is the one spelling the reader accepts.

An EMPTY value is refused at the block level rather than the payload level. Rendering no payload lines
is a legitimate rendering result, but wrapping zero lines in the fences produces a block the reader
rejects as EmptyPayload, so renderFrontMatterLines is where that refusal belongs.`;

export const EMPTY_BLOCK_REFUSAL =
  'the block would declare no fields, and the reader refuses an empty block as EmptyPayload';

const payloadLinesOf = (value: FrontMatter): readonly string[] => {
  const present = new Map(frontMatterEntries(value));
  return FIELD_REGISTRY.flatMap((entry) => {
    const found = present.get(entry.key);
    return found === undefined ? [] : [`${entry.key} = ${renderTomlValue(found)}`];
  });
};

export const unregisteredKeysOf = (value: FrontMatter): readonly string[] =>
  frontMatterEntries(value)
    .map((entry) => entry[0])
    .filter((key) => !REGISTRY_KEYS.includes(key))
    .sort();

export const payloadRefusal = (lines: readonly string[]): FrontMatterWriteError | undefined => {
  const parsed = parseToml(lines.join(LF));
  if (Result.isFailure(parsed)) return payloadNotRenderable(parsed.failure);
  const decoded = decodeFrontMatter(parsed.success);
  return Result.isFailure(decoded) ? payloadNotRenderable(decoded.failure.message) : undefined;
};

export const renderPayloadLines = (
  value: FrontMatter,
): Result.Result<readonly string[], FrontMatterWriteError> => {
  const unregistered = unregisteredKeysOf(value);
  if (unregistered.length > 0) return Result.fail(unregisteredField(unregistered));
  const lines = payloadLinesOf(value);
  const refusal = payloadRefusal(lines);
  return refusal === undefined ? Result.succeed(lines) : Result.fail(refusal);
};

export const renderFrontMatterLines = (
  value: FrontMatter,
  carrierName: CarrierName,
): Result.Result<readonly string[], FrontMatterWriteError> => {
  const rendered = renderPayloadLines(value);
  if (Result.isFailure(rendered)) return Result.fail(rendered.failure);
  if (rendered.success.length === 0) return Result.fail(payloadNotRenderable(EMPTY_BLOCK_REFUSAL));
  const carrier = carrierOf(carrierName);
  return Result.succeed([
    carrier.open,
    ...rendered.success.map((line) => payloadLine(carrier, line)),
    carrier.close,
  ]);
};

export const renderFrontMatter = (
  value: FrontMatter,
  carrierName: CarrierName,
  eol: Eol,
): Result.Result<string, FrontMatterWriteError> => {
  const lines = renderFrontMatterLines(value, carrierName);
  return Result.isFailure(lines) ? Result.fail(lines.failure) : Result.succeed(joinLines(lines.success, eol));
};

const separatorFor = (lines: readonly string[], nextIndex: number): readonly string[] =>
  nextIndex < lines.length && !isBlankLine(lines[nextIndex]) ? [''] : [];

export const upsertFrontMatter = (
  text: string,
  carrierName: CarrierName,
  value: FrontMatter,
): Result.Result<string, FrontMatterWriteError> => {
  const rendered = renderFrontMatterLines(value, carrierName);
  if (Result.isFailure(rendered)) return Result.fail(rendered.failure);

  const located = locateFrontMatter(text, carrierName);
  if (Result.isFailure(located)) return Result.fail(located.failure);

  const eol = detectEol(text);
  const lines = [...splitLines(text)];
  const block = rendered.success;
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
