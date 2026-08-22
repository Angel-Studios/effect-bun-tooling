import * as Result from 'effect/Result';
import { type CarrierName, carrierOf, hostCommentEndSequenceIn, stripPayloadPrefix } from './carrier.ts';
import {
  carrierLinePrefixMissing,
  duplicateFrontMatter,
  emptyPayload,
  type FrontMatterError,
  misplacedFrontMatter,
  payloadMovesHostCommentEnd,
  schemaDecode,
  tomlSyntax,
  unterminatedBlock,
} from './errors.ts';
import { classifyPath, DEFAULT_EXCLUSION_POLICY, type Excluded, type ExclusionPolicy } from './exclude.ts';
import { decodeFrontMatter, type FrontMatter } from './schema.ts';
import {
  detectEol,
  frontMatterCloseIndex,
  frontMatterOpenIndices,
  joinLines,
  preambleEnd,
  splitLines,
} from './sentinel.ts';

export type FrontMatterBlock = {
  readonly _tag: 'FrontMatter';
  readonly value: FrontMatter;
  readonly carrier: CarrierName;
  readonly startLine: number;
  readonly endLine: number;
  readonly raw: string;
};

export type NoFrontMatter = {
  readonly _tag: 'NoFrontMatter';
};

export type ParseOutcome = FrontMatterBlock | NoFrontMatter;

export const NO_FRONT_MATTER: NoFrontMatter = { _tag: 'NoFrontMatter' };

export type BlockSpan = {
  readonly openIndex: number;
  readonly closeIndex: number;
};

export const locateFrontMatter = (
  text: string,
  carrierName: CarrierName,
): Result.Result<BlockSpan | undefined, FrontMatterError> => {
  const lines = splitLines(text);
  const opens = frontMatterOpenIndices(lines, carrierName);
  if (opens.length > 1) return Result.fail(duplicateFrontMatter(opens[1] + 1));
  if (opens.length === 0) return Result.succeed(undefined);

  const openIndex = opens[0];
  if (openIndex !== preambleEnd(lines, carrierName)) {
    return Result.fail(misplacedFrontMatter(openIndex + 1));
  }

  const closeIndex = frontMatterCloseIndex(lines, carrierName, openIndex + 1);
  return closeIndex === -1
    ? Result.fail(unterminatedBlock(carrierName, openIndex + 1))
    : Result.succeed({ openIndex, closeIndex });
};

export const messageOfThrown = (thrown: unknown): string => {
  if (thrown instanceof Error) return thrown.message;
  if (typeof thrown === 'object' && thrown !== null && 'message' in thrown) {
    return String(thrown.message);
  }
  return String(thrown);
};

export const parseToml = (payload: string): Result.Result<object, string> => {
  try {
    return Result.succeed(Bun.TOML.parse(payload));
  } catch (thrown) {
    return Result.fail(messageOfThrown(thrown));
  }
};

export const extractPayload = (
  lines: readonly string[],
  span: BlockSpan,
  carrierName: CarrierName,
): Result.Result<string, FrontMatterError> => {
  const carrier = carrierOf(carrierName);
  const payload: string[] = [];
  for (let index = span.openIndex + 1; index < span.closeIndex; index += 1) {
    const sequence = hostCommentEndSequenceIn(carrier, lines[index]);
    if (sequence !== undefined) {
      return Result.fail(payloadMovesHostCommentEnd(carrierName, index + 1, sequence));
    }
    const stripped = stripPayloadPrefix(carrier, lines[index]);
    if (stripped === undefined) return Result.fail(carrierLinePrefixMissing(carrierName, index + 1));
    payload.push(stripped);
  }
  return Result.succeed(payload.join('\n'));
};

export const decodePayload = (
  payload: string,
  carrierName: CarrierName,
  line: number,
): Result.Result<FrontMatter, FrontMatterError> => {
  const parsed = parseToml(payload);
  if (Result.isFailure(parsed)) return Result.fail(tomlSyntax(carrierName, line, parsed.failure));
  if (Object.keys(parsed.success).length === 0) return Result.fail(emptyPayload(carrierName, line));

  const decoded = decodeFrontMatter(parsed.success);
  return Result.isFailure(decoded)
    ? Result.fail(schemaDecode(carrierName, line, decoded.failure.message))
    : Result.succeed(decoded.success);
};

export const parseFrontMatter = (
  text: string,
  carrierName: CarrierName,
): Result.Result<ParseOutcome, FrontMatterError> => {
  const located = locateFrontMatter(text, carrierName);
  if (Result.isFailure(located)) return Result.fail(located.failure);

  const span = located.success;
  if (span === undefined) return Result.succeed(NO_FRONT_MATTER);

  const lines = splitLines(text);
  const payload = extractPayload(lines, span, carrierName);
  if (Result.isFailure(payload)) return Result.fail(payload.failure);

  const startLine = span.openIndex + 1;
  const decoded = decodePayload(payload.success, carrierName, startLine);
  if (Result.isFailure(decoded)) return Result.fail(decoded.failure);

  return Result.succeed({
    _tag: 'FrontMatter',
    value: decoded.success,
    carrier: carrierName,
    startLine,
    endLine: span.closeIndex + 1,
    raw: joinLines(lines.slice(span.openIndex, span.closeIndex + 1), detectEol(text)),
  });
};

export const readFrontMatter = (
  path: string,
  text: string,
  policy: ExclusionPolicy = DEFAULT_EXCLUSION_POLICY,
): Result.Result<ParseOutcome | Excluded, FrontMatterError> => {
  const classification = classifyPath(path, policy);
  return classification._tag === 'Excluded'
    ? Result.succeed(classification)
    : parseFrontMatter(text, classification.carrier);
};
