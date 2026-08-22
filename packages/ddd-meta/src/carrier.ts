export const SENTINEL = '---uv';

export const SENTINEL_TERMINATOR = '---';

export const CARRIER_NAMES = ['block', 'hash', 'apostrophe', 'xml'] as const;

export type CarrierName = (typeof CARRIER_NAMES)[number];

export type BlockCommentDelimiters = {
  readonly open: string;
  readonly close: string;
  readonly nests: boolean;
};

export type Carrier = {
  readonly name: CarrierName;
  readonly open: string;
  readonly linePrefix: string;
  readonly close: string;
  readonly lineCommentLeaders: readonly string[];
  readonly blockComment: BlockCommentDelimiters | undefined;
};

export const CARRIERS: Readonly<Record<CarrierName, Carrier>> = {
  block: {
    name: 'block',
    open: `/* ${SENTINEL}`,
    linePrefix: '',
    close: `${SENTINEL_TERMINATOR} */`,
    lineCommentLeaders: ['//'],
    blockComment: { open: '/*', close: '*/', nests: true },
  },
  hash: {
    name: 'hash',
    open: `# ${SENTINEL}`,
    linePrefix: '# ',
    close: `# ${SENTINEL_TERMINATOR}`,
    lineCommentLeaders: ['#'],
    blockComment: undefined,
  },
  apostrophe: {
    name: 'apostrophe',
    open: `' ${SENTINEL}`,
    linePrefix: "' ",
    close: `' ${SENTINEL_TERMINATOR}`,
    lineCommentLeaders: ["'"],
    blockComment: undefined,
  },
  xml: {
    name: 'xml',
    open: `<!-- ${SENTINEL}`,
    linePrefix: '',
    close: `${SENTINEL_TERMINATOR} -->`,
    lineCommentLeaders: [],
    blockComment: { open: '<!--', close: '-->', nests: false },
  },
};

export const commentEndSequencesOf = (delimiters: BlockCommentDelimiters): readonly string[] =>
  delimiters.nests ? [delimiters.open, delimiters.close] : [delimiters.close];

export const HOST_COMMENT_END_SEQUENCES: readonly string[] = CARRIER_NAMES.flatMap((name) => {
  const delimiters = CARRIERS[name].blockComment;
  return delimiters === undefined ? [] : commentEndSequencesOf(delimiters);
});

export const isCarrierName = (value: string): value is CarrierName =>
  (CARRIER_NAMES as readonly string[]).includes(value);

export const carrierOf = (name: CarrierName): Carrier => CARRIERS[name];

export const isFrontMatterOpenLine = (carrier: Carrier, line: string): boolean =>
  line.trim() === carrier.open;

export const isFrontMatterCloseLine = (carrier: Carrier, line: string): boolean =>
  line.trim() === carrier.close;

export const hostCommentEndSequenceIn = (carrier: Carrier, line: string): string | undefined => {
  const delimiters = carrier.blockComment;
  if (delimiters === undefined) return undefined;
  return commentEndSequencesOf(delimiters).find((sequence) => line.includes(sequence));
};

export const payloadLine = (carrier: Carrier, text: string): string =>
  text === '' ? carrier.linePrefix.trimEnd() : `${carrier.linePrefix}${text}`;

export const stripPayloadPrefix = (carrier: Carrier, line: string): string | undefined => {
  if (carrier.linePrefix === '') return line;
  const trimmed = line.trimStart();
  if (trimmed.startsWith(carrier.linePrefix)) return trimmed.slice(carrier.linePrefix.length);
  return trimmed === carrier.linePrefix.trimEnd() ? '' : undefined;
};
