# @packages/ddd-path

The path grammar for a Domain-Driven Design repository structure that is derivable from file paths
alone, across six languages, with partial adoption and no flag day.

The normative reference is [`docs/grammar/README.md`](../../docs/grammar/README.md). This package is
that document made executable: every closed literal set here is the set named there, and every
worked example there is drawn from a file that exists in a real tree at a recorded commit.

```ts
import { Effect } from 'effect';
import { parseGrammarToml } from '@packages/ddd-path/config';
import { classify } from '@packages/ddd-path/parse';

const config = Effect.runSync(parseGrammarToml(await Bun.file('grammar.toml').text()));

classify('packages/bc_uuid_effect/lang_typescript/src/tag.ts', config);
// { _tag: 'Graded', context: 'uuid_effect', language: 'typescript', shellRole: 'source', … }

classify('packages/uuid-effect/src/tag.ts', config);
// { _tag: 'Ungraded', reason: 'no_grammar_tokens', provenance: 'unassigned' }
```

## What the path carries

The bounded context (`bc_<name>`), the language root (`lang_<language>`) and test trees
(`t_<kind>`, or a declared test shell). Nothing else. DDD layer, tactical pattern, tags and every
other classification live in file front matter, because a re-classification encoded in a path is a
file move and a file move invalidates markdown citations, quoted-path lines in guard tests,
lint-rule path globs and SHA-pinned paths — none of which any import rewriter repairs.

`l_`, `p_`, `s_` and `tag_` were path kinds in an earlier revision. A path carrying one is
`Malformed` with reason `superseded_kind`, and the parser names where the information moved.

## The parser never fails; it classifies

`parsePath` and `classify` are total pure functions. A refusal is a returned
`Malformed { reason, segment }`, never a throw and never an `Effect` failure. `decodeGrammarConfig`,
`parseGrammarToml`, `validateTagToken` and `decodeTagSet` return an `Effect`, failing with
`GrammarConfigError` or `TagError`.

**Precondition: a normalized, repo-relative POSIX path.** A leading separator, any `..` component, or
any backslash yields `Malformed { unnormalized_path }`. That is deliberate rather than tolerant: a
Windows-separator path silently tokenizes to nothing, and since `Ungraded` is this design's green
terminal, tolerating it would turn a whole repository green without earning it.

`Ungraded` is not `Malformed`. It is the parse result for a path that has not adopted the grammar:
typed, honest and green. `Malformed` is reserved for a path that carries grammar tokens and carries
them wrongly. Only `Malformed` may fail a gate.

## Subpaths

| Subpath | Carries |
|---|---|
| `./grammar` | the closed literal sets, their Effect Schemas, the name regexes, the reserved-word floor, `checkValue` |
| `./tags` | the tag token form, tag sets, union inheritance with deepest-wins override, shadowing findings, and the checked `validateTagToken` / `decodeTagSet` entry points |
| `./config` | the `grammar.toml` shell table: matcher forms, decode and TOML parse, `GrammarConfigError` |
| `./parse` | segment scan, re-armable shell resolution, `parsePath` and `classify` |
| `./marking` | the FALSIFIABLE / UNFALSIFIABLE derivability gate, per-value pattern refutations, the abstention floor |

## Language shells are declared, never guessed

A shell is the run of platform-mandated segments between the `lang_` segment and the point at which
the grammar ends. Shells are declared per repository in `grammar.toml`, keyed by language, because a
constant table is refuted by the real corpus: Kotlin Multiplatform alone contributes fifteen source
sets beside the two plain Gradle ones, arbitrary by declaration in `build.gradle.kts`.

Four matcher forms, a closed set, decoded through Effect Schema over parsed TOML:
`{ literal }`, `{ any_of }`, `{ optional_run }` (all-or-nothing, never a partial prefix) and
`{ context = true, suffix }`, which expands against the already-parsed `bc_` segment's **name**
(`ios_app`, never `bc_ios_app`) in exactly one spelling. A segment consumed by a shell matcher is
not a mintable grammar value, so the LCD rules never bind it: `Sources`, `commonMain`,
`testXavierDebug` and `ios_appTests` all carry capitals and all resolve.

Resolution is re-armable: the cursor arms on the `lang_` segment, then attempts each declared run at
every subsequent position and takes the first full-run match, at most one run per path. That is what
lets Roku's packager put the language root outside the context segment without changing the result.

## Abstention is a result, not a gap

`TestKind` carries `unassigned`, and a declared test shell with no `test_kind` yields
`Test { kind: 'unassigned' }` rather than guessing `unit`. `Ungraded`, `unassigned` and `unlayered`
all pass a gate; only `Malformed` may fail one.

## Resolution requirements

Ships built JavaScript with declarations beside it: `exports` points at `./dist/*.js`, typed by
`./dist/*.d.ts`. Consumers need a TypeScript `moduleResolution` honouring `exports` (`bundler`,
`node16`, or `nodenext`).

**Nothing to declare.** `effect` is a **peer** dependency at the open range `>=4.0.0-rc.109 <5`, and
bun auto-installs a missing peer, so a consumer names it nowhere. `parseGrammarToml` reads the
`Bun.TOML` global rather than importing a TOML parser, so the package pulls in no other runtime
dependency at all.
