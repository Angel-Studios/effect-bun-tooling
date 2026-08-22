import { Data, Effect, Schema } from 'effect';
import { isReservedKindPrefix, Language, TestKind } from './grammar.ts';

export const LiteralMatcher = Schema.Struct({ literal: Schema.String });
export type LiteralMatcher = typeof LiteralMatcher.Type;

export const AnyOfMatcher = Schema.Struct({ any_of: Schema.Array(Schema.String) });
export type AnyOfMatcher = typeof AnyOfMatcher.Type;

export const OptionalRunMatcher = Schema.Struct({ optional_run: Schema.Array(Schema.String) });
export type OptionalRunMatcher = typeof OptionalRunMatcher.Type;

export const ContextMatcher = Schema.Struct({
  context: Schema.Literal(true),
  suffix: Schema.optionalKey(Schema.String),
});
export type ContextMatcher = typeof ContextMatcher.Type;

export const ShellMatcher = Schema.Union([LiteralMatcher, AnyOfMatcher, OptionalRunMatcher, ContextMatcher]);
export type ShellMatcher = typeof ShellMatcher.Type;

export const ShellRun = Schema.Array(ShellMatcher);
export type ShellRun = typeof ShellRun.Type;

export const LanguageShell = Schema.Struct({
  source: Schema.optionalKey(ShellRun),
  test: Schema.optionalKey(ShellRun),
  test_kind: Schema.optionalKey(TestKind),
  extra_source_roots: Schema.optionalKey(Schema.Array(ShellRun)),
});
export type LanguageShell = typeof LanguageShell.Type;

export const GrammarConfig = Schema.Struct({
  version: Schema.Int,
  shell: Schema.Record(Language, Schema.optionalKey(LanguageShell)),
});
export type GrammarConfig = typeof GrammarConfig.Type;

export const GRAMMAR_CONFIG_ERROR_REASONS = ['toml_parse_failed', 'schema_violation'] as const;
export const GrammarConfigErrorReason = Schema.Literals(GRAMMAR_CONFIG_ERROR_REASONS);
export type GrammarConfigErrorReason = typeof GrammarConfigErrorReason.Type;

export class GrammarConfigError extends Data.TaggedError('GrammarConfigError')<{
  readonly reason: GrammarConfigErrorReason;
  readonly detail: string;
}> {}

export const emptyGrammarConfig: GrammarConfig = { version: 1, shell: {} };

const decodeStrict = Schema.decodeUnknownEffect(GrammarConfig, { onExcessProperty: 'error' });

export const SHELL_RUN_NAMES = ['source', 'test', 'extra_source_roots'] as const;
export type ShellRunName = (typeof SHELL_RUN_NAMES)[number];

const declaredSegmentsOf = (run: ShellRun): readonly string[] =>
  run.flatMap((matcher) => {
    if ('literal' in matcher) return [matcher.literal];
    if ('any_of' in matcher) return [...matcher.any_of];
    if ('optional_run' in matcher) return [...matcher.optional_run];
    return [];
  });

const namedRunsOf = (shell: LanguageShell): readonly (readonly [ShellRunName, ShellRun])[] => [
  ...(shell.source === undefined ? [] : [['source', shell.source] as const]),
  ...(shell.test === undefined ? [] : [['test', shell.test] as const]),
  ...(shell.extra_source_roots ?? []).map((run) => ['extra_source_roots', run] as const),
];

const reservedShellDeclaration = (config: GrammarConfig): string | undefined => {
  for (const [language, shell] of Object.entries(config.shell)) {
    if (shell === undefined) continue;
    for (const [runName, run] of namedRunsOf(shell)) {
      for (const segment of declaredSegmentsOf(run)) {
        if (isReservedKindPrefix(segment)) {
          return (
            `[shell.${language}] ${runName} declares the segment "${segment}", whose prefix is a ` +
            'reserved grammar kind; a shell run may not declare a structural or superseded kind'
          );
        }
      }
    }
  }
  return undefined;
};

const withoutReservedShellDeclaration = (
  config: GrammarConfig,
): Effect.Effect<GrammarConfig, GrammarConfigError> => {
  const offending = reservedShellDeclaration(config);
  return offending === undefined
    ? Effect.succeed(config)
    : Effect.fail(new GrammarConfigError({ reason: 'schema_violation', detail: offending }));
};

export const decodeGrammarConfig = (input: unknown): Effect.Effect<GrammarConfig, GrammarConfigError> =>
  Effect.flatMap(
    Effect.mapError(
      decodeStrict(input),
      (issue) => new GrammarConfigError({ reason: 'schema_violation', detail: String(issue) }),
    ),
    withoutReservedShellDeclaration,
  );

export const parseGrammarToml = (source: string): Effect.Effect<GrammarConfig, GrammarConfigError> =>
  Effect.flatMap(
    Effect.try({
      try: (): unknown => Bun.TOML.parse(source),
      catch: (cause) => new GrammarConfigError({ reason: 'toml_parse_failed', detail: String(cause) }),
    }),
    decodeGrammarConfig,
  );
