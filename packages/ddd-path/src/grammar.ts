import { Option, Schema } from 'effect';

export const LCD_IDENTIFIER: RegExp = /^[a-z_][a-z0-9_]*$/;

export const GRAMMAR_NAME: RegExp = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;

export const RUST_STRICT_KEYWORDS = [
  'as',
  'async',
  'await',
  'break',
  'const',
  'continue',
  'crate',
  'dyn',
  'else',
  'enum',
  'extern',
  'false',
  'fn',
  'for',
  'if',
  'impl',
  'in',
  'let',
  'loop',
  'match',
  'mod',
  'move',
  'mut',
  'pub',
  'ref',
  'return',
  'self',
  'Self',
  'static',
  'struct',
  'super',
  'trait',
  'true',
  'type',
  'unsafe',
  'use',
  'where',
  'while',
] as const;

export const RUST_RESERVED_FOR_FUTURE = [
  'abstract',
  'become',
  'box',
  'do',
  'final',
  'gen',
  'macro',
  'override',
  'priv',
  'try',
  'typeof',
  'unsized',
  'virtual',
  'yield',
] as const;

export const RESERVED_WORDS: ReadonlySet<string> = new Set<string>([
  ...RUST_STRICT_KEYWORDS,
  ...RUST_RESERVED_FOR_FUTURE,
]);

export const STRUCTURAL_KINDS = ['bc', 'lang', 't'] as const;
export const StructuralKind = Schema.Literals(STRUCTURAL_KINDS);
export type StructuralKind = typeof StructuralKind.Type;

export const SUPERSEDED_KINDS = ['l', 'p', 's', 'tag'] as const;
export const SupersededKind = Schema.Literals(SUPERSEDED_KINDS);
export type SupersededKind = typeof SupersededKind.Type;

export const SUPERSEDED_KIND_DESTINATION: Readonly<Record<SupersededKind, string>> = {
  l: 'front matter, field `l`',
  p: 'front matter, field `p`',
  s: 'an AST fact; declared nowhere',
  tag: 'front matter, field `tags`',
};

export const LANGUAGES = ['typescript', 'rust', 'swift', 'kotlin', 'elixir', 'brightscript'] as const;
export const Language = Schema.Literals(LANGUAGES);
export type Language = typeof Language.Type;

export const SUBDOMAINS = ['core', 'supporting', 'generic'] as const;
export const Subdomain = Schema.Literals(SUBDOMAINS);
export type Subdomain = typeof Subdomain.Type;

export const DDD_LAYERS = ['domain', 'application', 'infrastructure', 'interface', 'unlayered'] as const;
export const DddLayer = Schema.Literals(DDD_LAYERS);
export type DddLayer = typeof DddLayer.Type;

export const TACTICAL_PATTERNS = [
  'entity',
  'value_object',
  'aggregate',
  'aggregate_root',
  'domain_event',
  'domain_service',
  'application_service',
  'repository',
  'factory',
  'specification',
  'policy',
  'saga',
  'module',
  'read_model',
  'port',
  'adapter',
  'test_double',
  'barrel',
  'unassigned',
] as const;
export const TacticalPattern = Schema.Literals(TACTICAL_PATTERNS);
export type TacticalPattern = typeof TacticalPattern.Type;

export const TEST_KINDS = ['unit', 'integration', 'e2e', 'support', 'fixture', 'unassigned'] as const;
export const TestKind = Schema.Literals(TEST_KINDS);
export type TestKind = typeof TestKind.Type;

export const PROVENANCES = ['path_grammar', 'ast_fact', 'heuristic', 'unassigned'] as const;
export const Provenance = Schema.Literals(PROVENANCES);
export type Provenance = typeof Provenance.Type;

export const ANCHOR_KINDS = [
  'package_manifest',
  'typescript_config',
  'bun_config',
  'formatter_config',
  'lockfile',
  'vcs_ignore',
  'readme',
  'license',
  'crate_root',
  'cargo_manifest',
  'gradle_manifest',
  'mix_manifest',
  'swiftpm_manifest',
  'roku_manifest',
] as const;
export const AnchorKind = Schema.Literals(ANCHOR_KINDS);
export type AnchorKind = typeof AnchorKind.Type;

export const OUTSIDE_KINDS = [
  'build_plane',
  'ci_config',
  'agent_state',
  'installed_dependency',
  'build_output',
  'vendored',
] as const;
export const OutsideKind = Schema.Literals(OUTSIDE_KINDS);
export type OutsideKind = typeof OutsideKind.Type;

export const UNGRADED_REASONS = ['no_grammar_tokens', 'no_language_root'] as const;
export const UngradedReason = Schema.Literals(UNGRADED_REASONS);
export type UngradedReason = typeof UngradedReason.Type;

export const MALFORMED_REASONS = [
  'unknown_structural_kind',
  'superseded_kind',
  'unknown_language',
  'unknown_test_kind',
  'bad_name_shape',
  'not_lowercase',
  'leading_digit',
  'reserved_word',
  'tag_suffix_in_path',
  'duplicate_kind',
  'reserved_basename',
  'token_below_shell',
  'file_outside_shell',
  'unnormalized_path',
] as const;
export const MalformedReason = Schema.Literals(MALFORMED_REASONS);
export type MalformedReason = typeof MalformedReason.Type;

export const HIERARCHY_ROLES = ['root', 'project', 'context', 'file', 'symbol', 'package_instance'] as const;
export const HierarchyRole = Schema.Literals(HIERARCHY_ROLES);
export type HierarchyRole = typeof HierarchyRole.Type;

export const RELATIONSHIP_PATTERNS = [
  'partnership',
  'shared_kernel',
  'customer_supplier',
  'conformist',
  'anticorruption_layer',
  'open_host_service',
  'published_language',
  'separate_ways',
] as const;
export const RelationshipPattern = Schema.Literals(RELATIONSHIP_PATTERNS);
export type RelationshipPattern = typeof RelationshipPattern.Type;

const LEADING_DIGIT = /^[0-9]/;

export const checkValue = (value: string): Option.Option<MalformedReason> => {
  if (value.length === 0) return Option.some('bad_name_shape');
  if (value.includes('__')) return Option.some('tag_suffix_in_path');
  if (value !== value.toLowerCase()) return Option.some('not_lowercase');
  if (LEADING_DIGIT.test(value)) return Option.some('leading_digit');
  if (!LCD_IDENTIFIER.test(value)) return Option.some('bad_name_shape');
  if (!GRAMMAR_NAME.test(value)) return Option.some('bad_name_shape');
  if (RESERVED_WORDS.has(value)) return Option.some('reserved_word');
  return Option.none();
};

export type KindSplit = { readonly kind: string; readonly value: string };

export const splitKind = (segment: string): KindSplit | undefined => {
  const at = segment.indexOf('_');
  if (at <= 0) return undefined;
  return { kind: segment.slice(0, at), value: segment.slice(at + 1) };
};

export const isStructuralKind = (kind: string): kind is StructuralKind =>
  (STRUCTURAL_KINDS as readonly string[]).includes(kind);

export const isSupersededKind = (kind: string): kind is SupersededKind =>
  (SUPERSEDED_KINDS as readonly string[]).includes(kind);

export const isLanguage = (value: string): value is Language =>
  (LANGUAGES as readonly string[]).includes(value);

export const isTestKind = (value: string): value is TestKind =>
  (TEST_KINDS as readonly string[]).includes(value);

export const isReservedKindPrefix = (segment: string): boolean => {
  const split = splitKind(segment);
  return split !== undefined && (isStructuralKind(split.kind) || isSupersededKind(split.kind));
};
