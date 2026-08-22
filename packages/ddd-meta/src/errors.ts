import type { CarrierName } from './carrier.ts';

export type UnterminatedBlock = {
  readonly _tag: 'UnterminatedBlock';
  readonly carrier: CarrierName;
  readonly line: number;
};

export type CarrierLinePrefixMissing = {
  readonly _tag: 'CarrierLinePrefixMissing';
  readonly carrier: CarrierName;
  readonly line: number;
};

export type EmptyPayload = {
  readonly _tag: 'EmptyPayload';
  readonly carrier: CarrierName;
  readonly line: number;
};

export type TomlSyntax = {
  readonly _tag: 'TomlSyntax';
  readonly carrier: CarrierName;
  readonly line: number;
  readonly message: string;
};

export type SchemaDecode = {
  readonly _tag: 'SchemaDecode';
  readonly carrier: CarrierName;
  readonly line: number;
  readonly message: string;
};

export type PayloadMovesHostCommentEnd = {
  readonly _tag: 'PayloadMovesHostCommentEnd';
  readonly carrier: CarrierName;
  readonly line: number;
  readonly sequence: string;
};

export type MisplacedFrontMatter = {
  readonly _tag: 'MisplacedFrontMatter';
  readonly line: number;
};

export type DuplicateFrontMatter = {
  readonly _tag: 'DuplicateFrontMatter';
  readonly line: number;
};

export type FrontMatterError =
  | UnterminatedBlock
  | CarrierLinePrefixMissing
  | EmptyPayload
  | TomlSyntax
  | SchemaDecode
  | PayloadMovesHostCommentEnd
  | MisplacedFrontMatter
  | DuplicateFrontMatter;

export const FRONT_MATTER_ERROR_TAGS = [
  'UnterminatedBlock',
  'CarrierLinePrefixMissing',
  'EmptyPayload',
  'TomlSyntax',
  'SchemaDecode',
  'PayloadMovesHostCommentEnd',
  'MisplacedFrontMatter',
  'DuplicateFrontMatter',
] as const;

export type FrontMatterErrorTag = (typeof FRONT_MATTER_ERROR_TAGS)[number];

export const unterminatedBlock = (carrier: CarrierName, line: number): UnterminatedBlock => ({
  _tag: 'UnterminatedBlock',
  carrier,
  line,
});

export const carrierLinePrefixMissing = (carrier: CarrierName, line: number): CarrierLinePrefixMissing => ({
  _tag: 'CarrierLinePrefixMissing',
  carrier,
  line,
});

export const emptyPayload = (carrier: CarrierName, line: number): EmptyPayload => ({
  _tag: 'EmptyPayload',
  carrier,
  line,
});

export const tomlSyntax = (carrier: CarrierName, line: number, message: string): TomlSyntax => ({
  _tag: 'TomlSyntax',
  carrier,
  line,
  message,
});

export const schemaDecode = (carrier: CarrierName, line: number, message: string): SchemaDecode => ({
  _tag: 'SchemaDecode',
  carrier,
  line,
  message,
});

export const payloadMovesHostCommentEnd = (
  carrier: CarrierName,
  line: number,
  sequence: string,
): PayloadMovesHostCommentEnd => ({
  _tag: 'PayloadMovesHostCommentEnd',
  carrier,
  line,
  sequence,
});

export const misplacedFrontMatter = (line: number): MisplacedFrontMatter => ({
  _tag: 'MisplacedFrontMatter',
  line,
});

export const duplicateFrontMatter = (line: number): DuplicateFrontMatter => ({
  _tag: 'DuplicateFrontMatter',
  line,
});

export type ExclusionPolicyDecodeError = {
  readonly _tag: 'ExclusionPolicyDecode';
  readonly message: string;
};

export const exclusionPolicyDecodeError = (message: string): ExclusionPolicyDecodeError => ({
  _tag: 'ExclusionPolicyDecode',
  message,
});

export type VocabularyDecodeError = {
  readonly _tag: 'VocabularyDecode';
  readonly message: string;
};

export const vocabularyDecodeError = (message: string): VocabularyDecodeError => ({
  _tag: 'VocabularyDecode',
  message,
});

export const describeFrontMatterError = (error: FrontMatterError): string => {
  switch (error._tag) {
    case 'UnterminatedBlock':
      return `line ${error.line}: the ${error.carrier} front-matter block is never closed`;
    case 'CarrierLinePrefixMissing':
      return `line ${error.line}: this payload line is missing the ${error.carrier} carrier prefix`;
    case 'EmptyPayload':
      return `line ${error.line}: the ${error.carrier} front-matter block declares no fields`;
    case 'TomlSyntax':
      return `line ${error.line}: the ${error.carrier} front-matter payload is not TOML: ${error.message}`;
    case 'SchemaDecode':
      return `line ${error.line}: the ${error.carrier} front-matter payload failed field validation: ${error.message}`;
    case 'PayloadMovesHostCommentEnd':
      return `line ${error.line}: this payload line contains ${error.sequence}, which moves the end of the ${error.carrier} comment the front matter is carried in`;
    case 'MisplacedFrontMatter':
      return `line ${error.line}: front matter must open on the first line after the preamble, and this is not that line`;
    case 'DuplicateFrontMatter':
      return `line ${error.line}: a second front-matter opening in one file`;
  }
};
