import * as Result from 'effect/Result';
import * as Schema from 'effect/Schema';
import type { CarrierName } from './carrier.ts';
import { type ExclusionPolicyDecodeError, exclusionPolicyDecodeError } from './errors.ts';

export const EXCLUSION_REASONS = [
  'comment_incapable',
  'carrier_not_expressible',
  'generated',
  'vendored',
  'unowned',
  'no_carrier_declared',
] as const;

export const CARRIER_NOT_EXPRESSIBLE_RULE = `An .xml or .svg file is EXCLUDED because the ratified fence cannot be written as an XML comment.

XML 1.0 section 2.5 gives Comment ::= '<!--' ((Char - '-') | ('-' (Char - '-')))* '-->', so the string
-- must not occur inside comment content. The xml carrier opens '<!-- ---uv' and closes '--- -->',
which puts -- in the content at the FIRST fence, before any payload is written. Two conforming parsers
agree: libxml2 reports "Double hyphen within comment" and expat reports "not well-formed (invalid
token)". It fires on 100% of writes with the canonical payload; no adversarial input is involved.

This is a statement about the FENCE SPELLING, not about XML metadata being impossible. The candidate
fix is a processing instruction, <?uv ... ?>, which is legal by construction and carries no hyphen
restriction at all; it is a change to the ratified ---uv token that other work already binds to, so it
awaits ratification rather than being made here. Until then the honest verdict is that the format
cannot carry these files, and an excluded terminal is how this package says so.

The exclusion is scoped to the hosts that actually reject it. .html, .htm, .md, .svelte and .vue stay
on the xml carrier: the HTML5 tokenizer and CommonMark 0.30 and later both tolerate -- inside a
comment, so the same fence is well-formed there.`;

export type ExclusionReason = (typeof EXCLUSION_REASONS)[number];

export type Carried = {
  readonly _tag: 'Carried';
  readonly carrier: CarrierName;
};

export type Excluded = {
  readonly _tag: 'Excluded';
  readonly reason: ExclusionReason;
};

export type Classification = Carried | Excluded;

export const EXCLUSION_PRECEDENCE = [
  'vendored',
  'generated',
  'unowned',
  'comment_incapable',
  'carrier_not_expressible',
] as const;

export const carried = (carrier: CarrierName): Carried => ({ _tag: 'Carried', carrier });

export const excluded = (reason: ExclusionReason): Excluded => ({ _tag: 'Excluded', reason });

const StringList = Schema.Array(Schema.String);

export const ExclusionPolicySchema = Schema.Struct({
  carrierExtensions: Schema.Struct({
    block: StringList,
    hash: StringList,
    apostrophe: StringList,
    xml: StringList,
  }),
  commentIncapableExtensions: StringList,
  commentIncapableBasenames: StringList,
  carrierNotExpressibleExtensions: StringList,
  generatedBasenames: StringList,
  generatedSegments: StringList,
  vendoredSegments: StringList,
  unownedBasenames: StringList,
});

export type ExclusionPolicy = typeof ExclusionPolicySchema.Type;

export const DEFAULT_EXCLUSION_POLICY: ExclusionPolicy = {
  carrierExtensions: {
    block: [
      '.ts',
      '.tsx',
      '.js',
      '.jsx',
      '.mjs',
      '.cjs',
      '.mts',
      '.cts',
      '.rs',
      '.swift',
      '.kt',
      '.kts',
      '.c',
      '.cc',
      '.cpp',
      '.h',
      '.hpp',
      '.css',
      '.scss',
    ],
    hash: ['.ex', '.exs', '.py', '.sh', '.bash', '.zsh', '.toml', '.yml', '.yaml'],
    apostrophe: ['.brs'],
    xml: ['.html', '.htm', '.md', '.svelte', '.vue'],
  },
  commentIncapableExtensions: [
    '.json',
    '.png',
    '.jpg',
    '.jpeg',
    '.gif',
    '.ico',
    '.otf',
    '.ttf',
    '.woff',
    '.woff2',
    '.jar',
    '.class',
    '.pem',
    '.pbf',
    '.zip',
    '.tgz',
    '.bin',
    '.so',
    '.dylib',
    '.dll',
  ],
  commentIncapableBasenames: ['LICENSE', 'NOTICE'],
  carrierNotExpressibleExtensions: ['.xml', '.svg'],
  generatedBasenames: [
    'bun.lock',
    'package-lock.json',
    'yarn.lock',
    'pnpm-lock.yaml',
    'Cargo.lock',
    'gradle.lockfile',
  ],
  generatedSegments: [
    'dist',
    'build',
    'target',
    'out',
    'node_modules',
    '.svelte-kit',
    'generated',
    '__generated__',
  ],
  vendoredSegments: ['vendor', 'vendored', 'third_party', 'third-party', 'Pods', 'externals'],
  unownedBasenames: ['.gitignore', '.gitattributes', '.dockerignore', '.npmrc', '.editorconfig'],
};

export const decodeExclusionPolicy = (
  input: unknown,
): Result.Result<ExclusionPolicy, ExclusionPolicyDecodeError> => {
  const decoded = Schema.decodeUnknownResult(ExclusionPolicySchema, {
    errors: 'all',
    onExcessProperty: 'error',
  })(input);
  return Result.isFailure(decoded)
    ? Result.fail(exclusionPolicyDecodeError(decoded.failure.message))
    : Result.succeed(decoded.success);
};

export const posixPath = (path: string): string => path.replaceAll('\\', '/');

export const pathSegments = (path: string): readonly string[] =>
  posixPath(path)
    .split('/')
    .filter((segment) => segment !== '' && segment !== '.');

export const basenameOf = (path: string): string => {
  const segments = pathSegments(path);
  return segments.length === 0 ? '' : segments[segments.length - 1];
};

export const directorySegmentsOf = (path: string): readonly string[] => pathSegments(path).slice(0, -1);

export const extensionOf = (path: string): string => {
  const basename = basenameOf(path);
  const dot = basename.lastIndexOf('.');
  return dot <= 0 ? '' : basename.slice(dot).toLowerCase();
};

const hasAnySegment = (segments: readonly string[], candidates: readonly string[]): boolean =>
  segments.some((segment) => candidates.includes(segment));

export const carrierForExtension = (extension: string, policy: ExclusionPolicy): CarrierName | undefined => {
  if (policy.carrierExtensions.block.includes(extension)) return 'block';
  if (policy.carrierExtensions.hash.includes(extension)) return 'hash';
  if (policy.carrierExtensions.apostrophe.includes(extension)) return 'apostrophe';
  if (policy.carrierExtensions.xml.includes(extension)) return 'xml';
  return undefined;
};

export const classifyPath = (
  path: string,
  policy: ExclusionPolicy = DEFAULT_EXCLUSION_POLICY,
): Classification => {
  const directories = directorySegmentsOf(path);
  const basename = basenameOf(path);
  const extension = extensionOf(path);

  if (hasAnySegment(directories, policy.vendoredSegments)) return excluded('vendored');
  if (hasAnySegment(directories, policy.generatedSegments)) return excluded('generated');
  if (policy.generatedBasenames.includes(basename)) return excluded('generated');
  if (policy.unownedBasenames.includes(basename)) return excluded('unowned');
  if (policy.commentIncapableBasenames.includes(basename)) return excluded('comment_incapable');
  if (policy.commentIncapableExtensions.includes(extension)) return excluded('comment_incapable');
  if (policy.carrierNotExpressibleExtensions.includes(extension)) {
    return excluded('carrier_not_expressible');
  }

  const carrier = carrierForExtension(extension, policy);
  return carrier === undefined ? excluded('no_carrier_declared') : carried(carrier);
};
