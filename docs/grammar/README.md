# The DDD path grammar — reference

`@packages/ddd-path` is the path grammar for a Domain-Driven Design repository structure that is
derivable from file paths alone, across six languages, with partial adoption and no flag day.

This document is the grammar's reference. It is normative: every closed literal set named here is
asserted against the package's schemas by test, and every worked example below is drawn from a file
that exists in a real tree at a recorded commit.

---

## 0. What the path carries, and what it deliberately does not

**The path carries the bounded context, the language root, and test trees. Nothing else.**

DDD layer, tactical pattern, tags and every other classification live in *file front matter*
(`@packages/ddd-meta`), not in a path segment. The reason is move cost, and it was measured rather
than assumed: a re-classification encoded in a path is a file move, and a file move in a large
estate invalidates markdown citations, quoted-path lines in guard tests, lint-rule path globs and
SHA-pinned paths — none of which any import rewriter repairs. Structural classification amortises
that cost over a rare redesign. A tag does not amortise it at all: it is the same cost paid on the
ordinary operation, by more people, about more things.

So the split is:

| Property | Home | Why |
|---|---|---|
| bounded context | **path** (`bc_<name>`) | coarse, stable, renamed roughly never; it drives the containment tree a forest renders |
| language root | **path** (`lang_<language>`) | it is the unit of adoption and the key of the shell table |
| test tree | **path** (`t_<kind>`) or a declared test shell | a test root is a real directory the platform often mandates |
| DDD layer, tactical pattern, tags, ownership, tier, deprecation | **front matter** | volatile; a re-classification must be a one-line diff, not a move |
| exports, imports, dependencies, LOC, language, complexity, coverage, type signatures, error types, call edges, Effect service/layer identity | **neither** — an extracted AST fact | derivable from the code; duplicating it is two copies of one truth with no parity gate |

That third row is a hard rule, not a preference. See §7.

### Kinds that were superseded, and are now refused loudly

`l_`, `p_`, `s_` and `tag_` were path kinds in an earlier revision of this grammar. They are gone.
A path carrying one is **`Malformed`** with reason `superseded_kind`, and the parser names where the
information moved:

| Retired kind | Was | Now lives in |
|---|---|---|
| `l_<layer>` | DDD layer directory | front matter, field `l` |
| `p_<pattern>` | tactical pattern directory | front matter, field `p` |
| `s_<name>` | Effect service unit directory | an AST fact; declared nowhere |
| `tag_<k>_<v>` | standalone tag segment | front matter, field `tags` |

They are refused rather than ignored because silence is the failure mode that matters: an
un-migrated `src/l_domain/p_port/types.ts` parsed leniently would classify as an ordinary directory
named `l_domain`, and nothing would ever say the file's layer had been dropped on the floor.

`s_` is retired for a second, independent reason worth stating separately: grammar segments appear
only **above** a language shell, so that no grammar token is ever a Rust `mod` component, a Kotlin
package segment, an Elixir module component or a Swift target path — that constraint is what keeps a
re-classification from being a breaking API change in four languages. A service unit groups source
files, which live *below* the shell. There is therefore no legal position for `s_` in the grammar at
all. It needs none: an Effect service unit is fully computable from the AST — a `Context.Service` or
`Tag` declaration with a `Layer` provided for it — so it is an extracted fact, not a declaration.

---

## 1. The lowest-common-denominator rule set

**One grammar, lowest common denominator, no per-language exceptions.** Rust's constraints are the
floor and they apply to every language. Where a relaxation is provably safe in a specific language it
is rejected anyway, because the value of one uniform grammar exceeds the value of per-language
ergonomics: a parser, a migrator, a linter and a renderer that each need one rule rather than six is
the entire point.

Every mintable value — today that means a context name, a language literal and a test-kind literal —
must satisfy all of:

1. **Charset and shape.** `LCD_IDENTIFIER = /^[a-z_][a-z0-9_]*$/`.
   - Underscore is the only delimiter. `pub mod l.domain;` fails rustc 1.96.1 with
     `expected one of ';' or '{', found '.'`; hyphens are illegal in Rust module names and in
     Kotlin/Java package segments.
   - No leading digit — illegal as an identifier in every one of the six languages.
   - **Lowercase only.** Rust modules are conventionally snake_case, and case-insensitive
     filesystems on macOS and Windows make a mixed-case grammar a latent collision. Uniform
     lowercase removes the class entirely rather than managing it.
2. **No reserved word.** Rust's keyword set is the floor and applies to all six languages. A context
   named `bc_match` is `Malformed`, not a style problem.
3. **No per-language alternate form.** Exactly one spelling of each kind prefix, everywhere.

On top of the LCD charset the grammar imposes a stricter *name shape*:

```
GRAMMAR_NAME = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/
```

which additionally forbids a leading underscore, a trailing underscore and a doubled underscore.
Every `GRAMMAR_NAME` match is an `LCD_IDENTIFIER` match; the package asserts that containment
directly rather than leaving it to inspection.

### The reserved-word floor, and how it is applied

The floor is the Rust keyword set, verbatim:

```
as async await break const continue crate dyn else enum extern false fn for if impl in let loop
match mod move mut pub ref return self Self static struct super trait true type unsafe use where
while
abstract become box do final macro override priv try typeof unsized virtual yield
```

**It is applied to the whole value, not to each underscore-delimited component.** `bc_match` is
refused; `bc_match_engine` is legal. This is a stated interpretation, and it is stated because the
ratified wording ("no reserved word as any segment or as any value component") admits a stricter
reading. The interpretation is chosen on evidence: `mod match_engine` is legal Rust, `package
a.match_engine` is legal Kotlin, and no language anywhere breaks on a compound name containing a
keyword as a component. The stricter reading would refuse plausible names to prevent a failure mode
that does not exist. Overturn it if you disagree — the package pins both behaviours by test, so the
decision is visible rather than buried.

`gen` is included, and the reasoning that first excluded it was inverted. The ratified floor predates
Rust's 2024 edition, and the initial call was to leave `gen` out because widening a refusal set makes a
currently-legal name illegal. That is backwards here: `mod gen` does not compile in Rust 2024, so
excluding it ships a grammar that will happily mint `bc_gen` — a name illegal in the language whose
constraints are the floor. Adding it now costs nothing (no fact is persisted, and no name in either
corpus collides); not adding it ships a known defect. The set is 52 words, not 51.

`union`, `raw`, `safe` and `macro_rules` remain absent and correctly so — they are weak or contextual
keywords, not reserved.

### The case-collision property

Because lowercase is enforced at mint time, the set of legal names is closed under `toLowerCase`.
Two distinct legal names therefore cannot collide on a case-insensitive filesystem. That is the
property, and the package asserts it as a property rather than asserting one example of it.

---

## 2. Segment kinds

```
segment := kind '_' name
kind    ∈ STRUCTURAL_KINDS = { 'bc', 'lang', 't' }        // CLOSED, additive-only
name    := GRAMMAR_NAME
```

The kind is the prefix up to the **first** underscore, and no kind contains an underscore, so the
split is total.

**An unknown prefix is refused only inside an adopted subtree, and this scoping is load-bearing.**
Read literally, "every `x_y` segment is a kind attempt" would refuse an ordinary underscored
directory — and the corpus refutes that reading immediately: the real unmigrated Elixir path
`tools/nvenc-lab/direct-sdk/elixir/lib/nvenc_lab/cli.ex` contains the segment `nvenc_lab`, which
would turn the partial-adoption hinge of §6 red on a path that must be green. So:

- a **known** kind (`bc`, `lang`, `t`) and a **superseded** kind (`l`, `p`, `s`, `tag`) are always
  tokens, adopted or not — that is what keeps an un-migrated `l_domain` refused loudly;
- any **other** prefix is a token only when the path carries a `lang_` segment and the segment sits
  above the consumed shell. Everywhere else it is an ordinary `Untyped` directory name.

Adoption scope and rule scope are the same thing here, exactly as they are at §6 steps 6 and 8.

**`superseded_kind` outranks every other refusal, including `token_below_shell`.** A retired kind is
found below a shell far more often than above one — `src/l_domain/p_port/types.ts` is exactly where
those directories lived before the pivot — so the ranking decides which diagnostic a migrating author
actually reads. `superseded_kind` names where the information moved; `token_below_shell` names a
structural rule the author was not trying to break. The specific, actionable reason wins.

The precedence reaches the terminals as well: a `superseded_kind` outranks `Outside` and `Anchor`,
which otherwise terminate first. Without that, an ordinary directory name disarms the supersession
refusal — `bc_billing/lang_typescript/src/l_domain/node_modules/x.ts` would report `Outside` and the
retired kind would go unreported, so a migration sweep counting `superseded_kind` findings would
undercount by an amount nothing could state. It is the same shape as a configuration file switching a
guard off, and it is closed the same way. `Outside` and `Anchor` keep their early termination for
every path that carries no retired kind, which is what keeps the parse cheap.

The precedence is also **cross-segment**, not merely positional: a `superseded_kind` anywhere on a path
outranks a competing refusal at a shallower segment. `bc_Billing/lang_typescript/src/l_domain/x.ts`
reports `superseded_kind`, not the `not_lowercase` that first-reason-wins-by-index would otherwise
select. In a pre-pivot tree the retired kind is the systemic defect across thousands of paths while
the other refusal is a local one, and a migration wants the systemic reason surfaced first. Among
several superseded kinds the outermost wins; absent one, ordering is by segment index.

**A shell run may not declare a segment whose prefix is a structural or superseded kind.** That is a
`GrammarConfigError { reason: 'schema_violation' }` at decode time, not a parse-time check, so it
costs nothing per path. Without it a repository could disarm the whole supersession refusal by
declaring `l_domain` and `p_port` as shell literals — a shell segment is returned before any kind
split, so every retired directory would silently become a platform fact. A guard a configuration file
can switch off is not a guard, and no real platform directory in either corpus begins with `bc_`,
`lang_`, `t_`, `l_`, `p_`, `s_` or `tag_`, so the refusal costs nothing legitimate.

| Written | Parses as |
|---|---|
| `bc_uuid_effect` | context `uuid_effect` |
| `lang_rust` | language root `rust` |
| `t_unit` | test tree, kind `unit` |
| `l_domain` | **`Malformed`** `superseded_kind` — moved to front matter field `l` |
| `q_foo` | `Untyped` on an unadopted path; **`Malformed`** `unknown_structural_kind` inside an adopted one — see below |
| `bc_match` | **`Malformed`** `reserved_word` |
| `bc_2fa` | **`Malformed`** `leading_digit` |
| `bc_Billing` | **`Malformed`** `not_lowercase` |
| `bc_uuid_effect__subdomain_generic` | **`Malformed`** `tag_suffix_in_path` — tags moved to front matter |

The `__` suffix form is refused rather than ignored for the same reason the retired kinds are:
accepted leniently, `bc_uuid_effect__subdomain_generic` would parse as a context literally *named*
`uuid_effect__subdomain_generic`, and the subdomain would be silently lost in a rename.

### The closed sets are additive-only

Append, never rename, never remove. A content-addressed, commit-keyed fact store references these
names, so a rename orphans persisted facts with nothing to detect it. **The member lists are pinned
by test before any fact is persisted** — that is the one one-way door this design cannot close, and
pinning it early is the whole mitigation.

| Set | Members |
|---|---|
| `StructuralKind` | `bc`, `lang`, `t` |
| `SupersededKind` | `l`, `p`, `s`, `tag` |
| `Language` | `typescript`, `rust`, `swift`, `kotlin`, `elixir`, `brightscript` |
| `Subdomain` | `core`, `supporting`, `generic` |
| `DddLayer` | `domain`, `application`, `infrastructure`, `interface`, `unlayered` |
| `TacticalPattern` | `entity`, `value_object`, `aggregate`, `aggregate_root`, `domain_event`, `domain_service`, `application_service`, `repository`, `factory`, `specification`, `policy`, `saga`, `module`, `read_model`, `port`, `adapter`, `test_double`, `barrel`, `unassigned` |
| `TestKind` | `unit`, `integration`, `e2e`, `support`, `fixture`, `unassigned` |
| `Provenance` | `path_grammar`, `ast_fact`, `heuristic`, `unassigned` |
| `AnchorKind` | `package_manifest`, `typescript_config`, `bun_config`, `formatter_config`, `lockfile`, `vcs_ignore`, `readme`, `license`, `crate_root`, `cargo_manifest`, `gradle_manifest`, `mix_manifest`, `swiftpm_manifest`, `roku_manifest` |
| `OutsideKind` | `build_plane`, `ci_config`, `agent_state`, `installed_dependency`, `build_output`, `vendored` |
| `UngradedReason` | `no_grammar_tokens`, `no_language_root` |
| `MalformedReason` | `unknown_structural_kind`, `superseded_kind`, `unknown_language`, `unknown_test_kind`, `bad_name_shape`, `not_lowercase`, `leading_digit`, `reserved_word`, `tag_suffix_in_path`, `duplicate_kind`, `reserved_basename`, `token_below_shell`, `file_outside_shell`, `unnormalized_path` |
| `HierarchyRole` | `root`, `project`, `context`, `file`, `symbol`, `package_instance` |
| `RelationshipPattern` | `partnership`, `shared_kernel`, `customer_supplier`, `conformist`, `anticorruption_layer`, `open_host_service`, `published_language`, `separate_ways` |

`DddLayer` and `TacticalPattern` are **not path vocabulary**. They ship here because front matter and
a forest renderer must reference the same literals, and two copies of a closed set with no parity
gate is the defect this whole design legislates against.

### Refusal precedence

A value is checked in exactly this order, and the order is pinned by test so a diagnostic is stable:

1. empty → `bad_name_shape`
2. contains `__` → `tag_suffix_in_path`
3. contains an uppercase character → `not_lowercase`
4. begins with a digit → `leading_digit`
5. fails `LCD_IDENTIFIER` → `bad_name_shape`
6. fails `GRAMMAR_NAME` → `bad_name_shape`
7. is a reserved word → `reserved_word`
8. fails its kind's closed literal set → `unknown_language` / `unknown_test_kind`

---

## 3. The parse is an order-independent token scan

Segment order cannot be fixed across languages. Roku's packager mandates `manifest`, `source/` and
`components/` at the channel root, which forces the language root outside the context segment; a
forest wants the context outermost. A positional grammar would have to know the language before it
could parse — the manifest lookup a context-free parse exists to avoid.

**So the parser scans every segment and recognises a kind by its prefix regardless of position.**
Classification is the token *set* found along a path; containment comes from the actual directory
nesting, whatever order the platform imposed. These two classify identically:

```
tools/bc_overlap_vision/lang_brightscript/source/board_geom.brs
tools/lang_brightscript/bc_overlap_vision/source/board_geom.brs
```

**Two tokens of the same kind on one path is a loud typed error**, never a precedence rule:
`bc_a/bc_b/lang_rust/src/x.rs` is `Malformed` with reason `duplicate_kind`.

---

## 4. Language shells — declared, never guessed

A **shell** is the run of platform-mandated segments between the `lang_` segment and the point at
which the grammar has ended. Below a shell the language's own layout is untouched: a grammar token
found below a consumed shell is `Malformed` with reason `token_below_shell` — which is what keeps a
grammar token from ever becoming a Rust `mod` component, a Kotlin package segment, an Elixir module
component or a Swift target path. A **superseded** kind found there reports `superseded_kind`
instead, per the ranking in §2: the retired kind is the more actionable diagnostic wherever it sits.

### The shell table is decoded strictly, and an unknown key is a refusal

An unrecognised language key, an unrecognised field inside a language's entry, and an unrecognised
top-level field are each a typed `GrammarConfigError { reason: 'schema_violation' }`. This is not a
detail. A permissive decode DROPS what it does not recognise, so a `grammar.toml` carrying a typo'd
`[shell.kotlyn]` would decode green with the Kotlin shell missing entirely — and then every Kotlin
path in the adopting repo classifies `file_outside_shell` or `Ungraded` with nothing anywhere naming
the typo. A mistyped `sources` for `source` has exactly the same shape. **An unknown value is a loud
error** is a rule this grammar applies to its own configuration, not only to the paths it parses.

**Shells are declared per repository in `grammar.toml`, keyed by language.** A constant table is
refuted by the real corpus. In `project-xavier` at commit `444244199`, Kotlin lives at
`src/main/java/…`, `src/xavierDebug/java/…`, `src/xavierRelease/java/…` **and**
`src/testXavierDebug/java/…` — Gradle flavor source sets, arbitrary by declaration in
`build.gradle.kts`. In `harvest/kmp` at commit `1e7d64f` there are **fifteen Kotlin Multiplatform
source sets** beside the two plain Gradle ones:

| | source sets |
|---|---|
| KMP (15) | `commonMain` `commonTest` `androidMain` `androidHostTest` `iosMain` `iosTest` `iosArm64Main` `iosSimulatorArm64Main` `jsMain` `jsTest` `jvmMain` `jvmTest` `wasmJsMain` `wasmJsTest` `webMain` |
| plain Gradle (2) | `main` `test` |

None of that is derivable from a constant. A constant table would be wrong on the first real Kotlin
tree it met.

**A declared shell is not a per-language exception to the LCD rule.** It records where a *platform*
mandates its own root. The grammar's form is identical above and below every shell; the table
declares *where* the grammar ends, never *how* anything is spelled.

### The matcher forms

A shell run is an ordered list of matchers. Four forms, a closed set, decoded through Effect Schema
over parsed TOML:

| Form | Consumes | Purpose |
|---|---|---|
| `{ literal = "src" }` | exactly that segment | a fixed platform directory |
| `{ any_of = ["main", "commonMain", …] }` | one segment from the declared set | Gradle flavor and KMP source sets |
| `{ optional_run = ["com", "angel", "xavier"] }` | the whole run if it matches, otherwise nothing | an org package path, which is present in most modules and absent in some |
| `{ context = true, suffix = "Tests" }` | one segment equal to the enclosing context **name** plus the suffix — `ios_app` and `ios_appTests`, never the `bc_` segment | SwiftPM, whose target directory varies with the target name |

`optional_run` is all-or-nothing, never a partial prefix — a partial match would be ambiguous.
It exists because the corpus demands it: in `harvest/kmp`, `modules/shared/src/commonMain/kotlin/day/harvest/…`
carries the `day/harvest` org path and `build-logic/src/test/kotlin/DomainBoundaryGuardTest.kt` does not.

`{ context = true }` is the one substitution token. It expands to the enclosing `bc_` segment's
**name** — `ios_app`, **not** `bc_ios_app` — which has already been parsed by the time a shell is
resolved, so Swift's variable target directory stays context-free. Expanding to the whole segment
would put a grammar token inside a Swift target path, which is precisely what §0 forbids, and it
would admit two legal spellings of one directory — a per-language alternate form, which the
lowest-common-denominator rule set refuses outright. **The matcher accepts exactly one spelling.**

**A shell segment is not a mintable grammar value, so the LCD rules do not apply to it.** `Sources`,
`main`, `commonMain`, `testXavierDebug` and `ios_appTests` all carry capitals, and all are legal:
they record what a platform mandates. The LCD rules bind context names, language literals and test
kinds — the values this grammar mints — and nothing else.

### Shell resolution is re-armable

The cursor arms when a `lang_` segment is parsed, then attempts the declared runs at **each**
subsequent position, taking the first full-run match. That is what lets the language root sit outside
the context segment without changing the result. At most one shell run is consumed per path.

### A worked `grammar.toml`

Two adjacent brackets must be separated by whitespace: bun's TOML lexer reads `[[` as an
array-of-tables token and fails `extra_source_roots = [[{ … }]]` with `Expected t_comma but found ]]`.
Written spaced, as below, it parses. A malformed table surfaces as a typed
`GrammarConfigError { reason: 'toml_parse_failed' }`, never a throw.

```toml
version = 1

[shell.typescript]
source = [{ literal = "src" }]
test = []

[shell.rust]
source = [{ literal = "src" }]
test = [{ literal = "tests" }]
test_kind = "integration"

[shell.elixir]
source = [{ literal = "lib" }]
test = [{ literal = "test" }]
test_kind = "unit"

[shell.swift]
source = [{ literal = "Sources" }, { context = true }]
test = [{ literal = "Tests" }, { context = true, suffix = "Tests" }]
test_kind = "unit"

[shell.brightscript]
source = [{ literal = "source" }]
extra_source_roots = [ [{ literal = "components" }] ]
test = []

[shell.kotlin]
source = [
  { literal = "src" },
  { any_of = ["main", "test", "xavierDebug", "xavierRelease", "testXavierDebug"] },
  { any_of = ["kotlin", "java"] },
  { optional_run = ["com", "angel", "xavier"] },
]
test = [
  { literal = "src" },
  { any_of = ["test", "testXavierDebug"] },
  { any_of = ["kotlin", "java"] },
  { optional_run = ["com", "angel", "xavier"] },
]
test_kind = "unit"
```

**A `test` run with no declared `test_kind` yields `Test { kind: 'unassigned' }`, never a guess.**
`unassigned` is an honest terminal in `TestKind` for the same reason `unassigned` and `unlayered` are
terminals in the pattern and layer vocabularies: a classification that guesses is worse than one that
abstains, and a silently-defaulted `unit` is indistinguishable in the output from a declared one.

Rust's `tests/` earns its own row and the table records why: Cargo treats only **direct** children of
`tests/` as integration-test crates, so a `t_integration/` cannot nest below it. **Where a platform
mandates an unnestable test root, that directory *is* the test tree and the table declares its
implied kind.** Rust unit tests are inline `#[cfg(test)] mod tests`, so their test-ness is a symbol
fact, not a path fact — correctly outside a path grammar.

---

## 5. Worked examples — one per language, every source path real

Each row cites a path that exists at the recorded commit, and the migrated form that the grammar
produces from it. The tail below the shell is preserved verbatim; migration inserts `bc_` and `lang_`
above the shell and moves nothing below it.

### TypeScript — `effect-bun-tooling` @ `4d431c6`

```
real      packages/uuid-effect/src/tag.ts
migrated  packages/bc_uuid_effect/lang_typescript/src/tag.ts
class     Graded { context: 'uuid_effect', language: 'typescript', shellRole: 'source' }
```

Layer and pattern for this file are front matter, not path: `l = "infrastructure"`, and it is the
service's port token.

### Rust — `project-xavier` @ `444244199`

```
real      packages/napi-avahi-client/src/lib.rs
migrated  packages/bc_napi_avahi_client/lang_rust/src/lib.rs
class     Anchor { kind: 'crate_root' }

real      tools/av1rt/crates/av1rt-quality/tests/vmaf_smoke.rs
migrated  tools/av1rt/crates/bc_av1rt_quality/lang_rust/tests/vmaf_smoke.rs
class     Test { context: 'av1rt_quality', language: 'rust', kind: 'integration' }
```

The second row is the declared test shell doing its work: `tests/` is Cargo-mandated and unnestable,
so the shell table supplies `test_kind = "integration"` and no `t_` segment is minted.

### Kotlin — `project-xavier` @ `444244199` (Gradle flavor source sets)

```
real      packages/nav-protocol-jetpack-compose-runtime/src/main/java/com/angel/xavier/api/NavCoord.kt
migrated  packages/bc_nav_protocol_jetpack_compose_runtime/lang_kotlin/src/main/java/com/angel/xavier/api/NavCoord.kt
class     Graded { context: 'nav_protocol_jetpack_compose_runtime', language: 'kotlin', shellRole: 'source' }

real      packages/nav-protocol-jetpack-compose-runtime/src/testXavierDebug/java/com/angel/xavier/end2end/CorpusEmitterTest.kt
migrated  packages/bc_nav_protocol_jetpack_compose_runtime/lang_kotlin/src/testXavierDebug/java/com/angel/xavier/end2end/CorpusEmitterTest.kt
class     Test { context: 'nav_protocol_jetpack_compose_runtime', language: 'kotlin', kind: 'unit' }
```

### Kotlin — `harvest/kmp` @ `1e7d64f` (Kotlin Multiplatform source sets)

```
real      modules/shared/src/wasmJsMain/kotlin/day/harvest/traditions/MapHost.wasmJs.kt
migrated  modules/bc_shared/lang_kotlin/src/wasmJsMain/kotlin/day/harvest/traditions/MapHost.wasmJs.kt

real      modules/domain/sdui/src/commonMain/kotlin/day/harvest/sdui/model/SurfaceId.kt
migrated  modules/domain/bc_sdui/lang_kotlin/src/commonMain/kotlin/day/harvest/sdui/model/SurfaceId.kt

real      build-logic/src/test/kotlin/DomainBoundaryGuardTest.kt      # no org package path
migrated  bc_build_logic/lang_kotlin/src/test/kotlin/DomainBoundaryGuardTest.kt
```

The third row is why `optional_run` is all-or-nothing rather than segment-by-segment optional.

### BrightScript / Roku — `project-xavier` @ `444244199`

```
real      tools/overlap-vision/roku-board-app/source/board_geom.brs
migrated  tools/overlap-vision/bc_roku_board_app/lang_brightscript/source/board_geom.brs

real      tools/overlap-vision/roku-board-app/components/BoardScene.brs
migrated  tools/overlap-vision/bc_roku_board_app/lang_brightscript/components/BoardScene.brs
```

**On Roku the grammar is documentary, not enforced.** Everything in `source/` is one global
namespace, so a boundary has no runtime meaning there and a violation cannot fail a build. A linter
is the only enforcement available. Do not claim otherwise.

The 65 `.brs` files at `packages/nav-protocol-roku-instrumentation/src/__fixtures__/` are **not** a
Roku channel — they are BrightScript fixtures inside a TypeScript package, and they classify as a
test fixture inside `lang_typescript`. **A language is attributed by the `lang_` segment, never by
file extension.** That is precisely the case where segment attribution is stronger than extension
attribution.

### Elixir — `project-xavier` @ `444244199`

```
real      tools/nvenc-lab/direct-sdk/elixir/lib/nvenc_lab/cli.ex
migrated  tools/nvenc-lab/direct-sdk/bc_nvenc_lab/lang_elixir/lib/nvenc_lab/cli.ex

real      tools/nvenc-lab/direct-sdk/elixir/test/nvenc_lab_test.exs
migrated  tools/nvenc-lab/direct-sdk/bc_nvenc_lab/lang_elixir/test/nvenc_lab_test.exs
class     Test { kind: 'unit' }
```

**Correction to a commonly-assumed coupling, verified by execution:** Elixir enforces *no*
path-to-module mapping at all. `elixirc` compiles any `.ex` under `elixirc_paths` regardless of
directory name, and a module's name is whatever `defmodule` says. The real constraint is the
community convention that `lib/<app>/<snake_path>.ex` maps to `App.SnakePath`, which
`Macro.camelize` implements. The underscore encoding is still correct here — it round-trips through
`Macro.camelize` into legal, readable module names — but the justification is convention and tooling,
not the compiler. The weaker true reason is recorded rather than the stronger false one. Kotlin is
the same shape: it does **not** require directory-to-package match either, unlike Java.

Neither correction changes the design. Under one lowest-common-denominator grammar, a relaxation
that is legal in one language is still forbidden.

### Swift — what is and is not validated

```
real      apps/iosApp/iosApp/ContentView.swift          # harvest/kmp @ 1e7d64f
real      apps/iosApp/iosApp/iOSApp.swift               # harvest/kmp @ 1e7d64f
migrated  apps/bc_ios_app/lang_swift/Sources/ios_app/ContentView.swift
```

**Be precise about the evidentiary status, in both directions.**

- `project-xavier` contains **zero** `.swift` files. Measured at commit `444244199`:
  `ts 5739, rs 253, sh 155, xml 108, h 106, brs 65, kt 64, cpp 45, py 43, tsx 13, kts 6, exs 5, ex 2`.
- `harvest/kmp` contains **exactly two** `.swift` files, both in an Xcode iOS app target.
- **An Xcode app target is not a SwiftPM package.** The declared Swift shell
  (`Sources/<Target>/`) therefore has **no instance anywhere in either corpus**. It is
  designed-for and validated only by a synthetic `swift build`, not by a real tree.
- What *is* corpus-validated for Swift is path legality — that the two real files' paths parse, and
  that a migrated form of them parses — nothing more.

**Swift is designed-for and unvalidated-by-corpus for its shell.** Say so when quoting this grammar.
Proving the Swift carrier against those two files is chunk M3's job, not this one's.

### C and C++ — out of scope, with the evidence

All 151 `.h`/`.cpp` files in `project-xavier` are vendored third-party SDKs:
`packages/napi-axcl-venc/vendor/include/ax_*.h` (Axera) and `tools/nvenc-lab/sdk/**` (NVIDIA Video
Codec SDK samples). Not one is first-party.

Be exact about what the shipped detection table actually does with them, because the two roots differ.
`packages/napi-axcl-venc/vendor/include/ax_*.h` classifies `Outside { kind: 'vendored' }` on its
`vendor` segment. `tools/nvenc-lab/sdk/**` does **not** — `sdk` is deliberately absent from the
default segment table, because a segment that common would swallow first-party code — so those files
classify `Ungraded`. Both outcomes are green and neither is a gap in the grammar; a per-repository
declared outside-prefix list, which would let a repo name `tools/nvenc-lab/sdk` explicitly, is
deferred work rather than something this package guesses at.

**`build`, `target` and `coverage` were in that table and have been removed, on the same criterion.**
They failed it measurably: over `project-xavier`'s 11,071 tracked paths they swallowed **21 first-party
source files sitting under `src/`** — `apps/xavier/src/device-lab/build/**`,
`apps/sofa/src/calibration/target/**`, `apps/xavier/src/nav-protocol/coverage/**`. Swallowed is worse
than red: those files were not `Malformed` and not `Ungraded`, they were simply absent from the map,
with no abstention terminal in play and nothing to notice. Stating a criterion, testing it for one
member, and violating it with three others in the same table is the failure this correction closes. The
default table keeps only `node_modules`, `dist`, `vendor` and `third_party`; a repository that genuinely
wants a `target/` excluded declares it, once that declared list exists.

**`lang_c` and `lang_cpp` are deliberately not minted.** A literal added to a closed additive-only
set is permanent, and minting one for code nobody in either corpus writes is a cost with no
counterparty. If first-party C ever appears, `lang_c` is a free append.

---

## 6. `Ungraded` is not `Malformed` — the partial-adoption hinge

```
PathClass =
  | Graded    { context?, language, shellRole, provenance }
  | Test      { context?, language?, kind, provenance }
  | Anchor    { kind }
  | Outside   { kind }
  | Ungraded  { reason, context?, provenance }        // NOT an error, and never red
  | Malformed { reason, segment }                      // RED
```

**`Ungraded` is the parse result for a path that has not adopted the grammar.** It is typed, honest
and green: it says *this subtree has not adopted*, never *this is broken*, and never a guess.
`Malformed` is reserved for a path that carries grammar tokens and carries them wrongly. Conflating
the two would make every unmigrated file a lint failure — a flag day, which is exactly what this
design exists to avoid.

**Only `Malformed` may fail a gate.** `Ungraded`, `unassigned` and `unlayered` all pass.

### Classification order — load-bearing

0. a `superseded_kind` segment anywhere on the path → `Malformed { superseded_kind }`. **This runs
   ahead of everything, `Outside` and `Anchor` included** — see §2. Both terminals are listed below
   as steps 1 and 2 because that is where they run for every path carrying no retired kind, but
   neither may suppress a supersession finding: an ordinary directory name must not be able to
   disarm the refusal any more than a configuration file may.
1. an `Outside` prefix or segment → `Outside`
2. an anchor basename → `Anchor`
3. any malformed segment → `Malformed` (first reason wins)
4. **inside an adopted subtree only** — a file basename whose first `_`-delimited token is a structural
   or superseded kind → `Malformed { reserved_basename }`, so a file can never be confused with a
   directory under a path-only parse. The adoption scoping is the same one §2 applies to an unknown
   prefix, and for the same measured reason: unscoped, this rule reddens thirteen real unmigrated paths
   in `project-xavier`, among them the first-party script `scripts/tag_branch.sh`. §2's
   always-a-token rationale does not transfer here — it is about a DIRECTORY that carried a
   classification and would otherwise drop it on the floor, whereas a file basename never carried a
   grammar segment, so an unscoped refusal produces a false positive and nothing else
5. a `t_` segment, or a consumed test shell → `Test`
6. no `lang_` segment → `Ungraded` — **the hinge**
7. a consumed source shell → `Graded`
8. a `lang_` segment with no consumed shell and no anchor → `Malformed { file_outside_shell }`

Ahead of all eight, the input itself is checked. **`classify` takes a normalized, repo-relative POSIX
path**, and a leading separator, any `..` component, or any backslash yields
`Malformed { unnormalized_path }`. This is loud rather than tolerant because the failure it replaces is
a vacuous pass at whole-repository scale: a caller on Windows feeding `path.join` output would otherwise
get `Ungraded` for every path in the tree — green, typed, and completely wrong — and the partial-adoption
story makes an all-green result look expected rather than suspicious. A `..` component is refused on a
narrower ground: a path containing one is not repo-relative, and the classifier would otherwise answer
about a different file from the one the string denotes.

An unknown-prefix segment produces `Malformed { unknown_structural_kind }` at step 3 only under the
adoption scoping of §2; on an unadopted path it is an ordinary `Untyped` name and the path reaches
step 6.

Step 6 is where adoption scope and rule scope become the same thing by construction. Absence of a
`lang_` segment means the subtree has not adopted, so the result is green. Presence of one means
adoption is **declared**, so step 8's failure is red. The rule set carries partial adoption; the tool
has no special case for it.

### The smallest independently-adoptable unit is one `lang_<language>` root

- The shell table is keyed on `lang_`. Below it the grammar's end point is known; above it, nothing
  needs to be known.
- A manifest belongs to exactly one `lang_` root — `package.json`, `Cargo.toml`, `mix.exs`,
  `build.gradle.kts`, `Package.swift`, a Roku `manifest`. Build reconciliation is per-manifest, so a
  `lang_` root is exactly the unit whose build can be made consistent in one step.
- A larger unit would force a polyglot package's Rust and TypeScript to migrate together for no
  reason. `packages/bc_napi_ultravisor_store/{lang_rust,lang_typescript}/` is the shape `lang_`
  exists for, and each half adopts independently.

**A `lang_` root adopts atomically WITH every sibling of its shell, and the cost of that is measured
rather than left to be discovered.** The TypeScript shell declares no test run, so a TypeScript test
tree must be a minted `t_` segment. Dropping `lang_typescript` into a package therefore does not stand
alone: without simultaneously renaming `__tests__/` to `t_unit/` and relocating anything else beside
`src/`, the files outside the shell are `Malformed { file_outside_shell }`. Applied to this repository's
own `packages/**` a `lang_` insertion alone yields **76 reds out of 156 files, 49%**, every
`__tests__/**` file among them, and `docs/**` and `scripts/**` would join them. Minting the test tree
in the same step takes it to **zero** `Malformed` over a 114-file denominator — which is what makes
this a cost to plan for rather than a defect to fix.

So the honest statement of the unit is: **one `lang_` root plus every sibling of its shell inside that
root**, migrated together. That is still far short of a flag day — it is one package at a time, and every
other package in the repository stays untouched and green — but it is a package-granular atomic step, not
a segment-granular one, and an operator should ratify the real figure rather than the smaller one.

A `bc_` rename is a separate, later, independent step. Until it lands, a graded `lang_typescript/`
under a flat `packages/uuid-effect/` yields `context: undefined` with `provenance: 'unassigned'` for
the context field and `path_grammar` provenance for the language. Honest, and useful immediately.

### Provenance is per field, not per node

| Value | Meaning |
|---|---|
| `path_grammar` | read from a typed segment |
| `ast_fact` | supplied by an extractor |
| `heuristic` | a labelled fallback, never promoted silently |
| `unassigned` | honest absence |

A node may carry its language from `path_grammar` and its service identity from `ast_fact`
simultaneously. During partial adoption that is the normal state, not a degraded one.

---

## 7. FALSIFIABLE vs UNFALSIFIABLE — the derivability gate

This is the grammar's most load-bearing output, because it does double duty: it is the parity gate's
input (what an AST may contradict) **and** the front-matter derivability gate's input (what front
matter may not carry).

**The rule.** Front matter must never carry a fact derivable from the code. A duplicated derivable
fact is two copies of one truth with no parity gate — the same defect class as two dependency
catalogs that drift, and the same reason a prose comment is banned: a comment cannot go red.

**The gate is keyed on HOME, not on falsifiability.** There are three homes and only two falsifiability
values, so falsifiability alone cannot decide the question — and stating the rule over the wrong axis is
not an academic error: it admits `bc` into front matter, since a bounded context is UNFALSIFIABLE yet
lives in the path for the move-cost reason §0 gives.

```
home = 'front_matter'  => LEGITIMATE in front matter
home = 'ast_fact'      => FORBIDDEN  — an AST computes it; duplicating it is two copies of one truth
home = 'path'          => FORBIDDEN  — it is declared, but the path is where it is declared
kind not in the table  => UNMARKED   — no decision has been recorded; a gate must say so, not pass
```

Falsifiability still carries real weight, but a different weight: it tells the **parity gate** what an
AST may contradict. It is not the derivability gate's key.

**The unknown case must be loud, and this is the asymmetry rule applied to the marking itself.** §2 and
§8 establish that an unknown *kind* is a loud error while an unknown *tag* parses silently. Front-matter
kinds are the closed side of that asymmetry — the total is pinned at 28 precisely because they are
closed — so a kind with no marking must not resolve to "permitted". A predicate returning the same
answer for "known and allowed" as for "never decided" reports a success it did not earn, and the failure
lands in a consumer's repository rather than this one. `isForbiddenInFrontMatter` therefore fails
CLOSED, and `frontMatterEligibility` gives a gate the third answer so it can emit an actionable finding
instead of a silent pass.

```
FALSIFIABLE   => an AST oracle COMPUTES the value  => home = 'ast_fact'
UNFALSIFIABLE => design intent no AST reveals      => home = 'front_matter' or 'path'
```

### One distinction the ratified wording conflates, made explicit

*Derivable* (an AST can compute the value) and *refutable* (an AST can contradict one particular
claimed value) are not the same property, and treating them as one produces a contradiction: the
mechanical layer test can refute `l = "domain"` on a module importing `node:fs`, which would mark
layer FALSIFIABLE and therefore forbid it from front matter — yet DDD layer is named explicitly as
legitimate front matter.

The resolution, grounded in that same legitimate list: **the marking is per field and keyed on
derivability.** A field an AST can only partially refute stays UNFALSIFIABLE and legitimate, and
carries a separate `partialRefutation` oracle that the parity gate consumes. A field is never marked
falsifiable because *some* of its values can be contradicted.

### The table

**Path kinds**

| Kind | Marking | Oracle, or why none exists |
|---|---|---|
| `bc` (bounded context) | **UNFALSIFIABLE** | a context boundary is a human decision; nothing in the code says where one ends |
| `lang` (language root) | **FALSIFIABLE** | file extensions below the root contradict the declared language |
| `t` (test tree kind) | **UNFALSIFIABLE** | `unit` vs `integration` vs `e2e` is intent no AST distinguishes, so nothing can COMPUTE the kind. Partial refutation: a `t_unit`/`t_integration`/`t_e2e` tree containing no test registration call. `t_support` and `t_fixture` carry no refutation at all — they hold no test registrations by definition, so an oracle demanding one would turn a correct declaration into a false parity violation |

`t` sits in this table but is UNFALSIFIABLE, and the correction matters: marked falsifiable, its oracle
refuted two of its five legal values by definition, and the "AST wins" contract below would have turned a
correct `t_support` or `t_fixture` declaration into a parity violation. It is the same case the
derivable/refutable distinction was drawn for, so it carries a `partialRefutation` like `l` and `p` and
is UNFALSIFIABLE like them. Three kinds carry one in total: `l`, `p`, `t`.

`lang_` is falsifiable and still lives in the path. That is not a contradiction: the segment is a
declaration of **adoption scope**, and the derived `language` fact is what may refute it. The two are
separate entries in the table for exactly that reason.

**Front-matter kinds — twelve, legitimate, all UNFALSIFIABLE**

Each is separately addressable, because the gate is keyed on a kind string: `markingOf(kind)` and
`isForbiddenInFrontMatter(kind)` take one kind, so a row naming two would be unusable.

| Kind | Why no AST refutes it | Partial refutation available to the parity gate |
|---|---|---|
| `l` (DDD layer) | `domain` vs `application` for two runtime-free modules is intent | a module in `domain` importing `node:*`, `bun:*` or a non-`effect` third-party runtime |
| `p` (tactical pattern) | a class with an id field is not thereby an Entity; a struct is not thereby a Value Object | per-value, for the four structural literals only — see below |
| `subdomain` | pure strategic judgment about what the business competes on | none |
| `tags` | arbitrary metadata by design | none, unless a specific tag key ships its own declared oracle |
| `owner` | organizational fact | none |
| `oncall` | organizational fact | none |
| `data_classification` (PII/PCI) | a legal and design judgment | none |
| `tier` | operational intent | none |
| `criticality` | operational intent | none |
| `deprecation` | intent plus a date | none |
| `external_links` (ADR, ticket, runbook, dashboard) | a pointer, not a property | none |
| `review_status` | process state | none |

Per-value partial refutations for `p`, and only these four:

| Value | Refuted by |
|---|---|
| `barrel` | any non-re-export declaration in the module |
| `port` | an exported runtime binding that is neither a `Context.Service`/`Tag` declaration nor a `Schema` — an implementation living in the port module |
| `adapter` | importing nothing external |
| `test_double` | exporting no `Layer` and no stand-in |

Every other `TacticalPattern` literal is modelling intent with no refuting oracle. Weak signals
exist; refutation does not.

**`port` is worded that carefully because the obvious wording is wrong, and wrong in a way that fires
on everything.** "Any exported runtime binding" refutes `packages/uuid-effect/src/tag.ts` — this
document's own §5 worked example — and with it every Effect port that can exist. A port in plain
TypeScript is a type-only `interface`, fully erased; an Effect port IS the `Context.Service` class,
which is a runtime value by construction because it is the Tag. An oracle refuting "an exported
runtime binding" therefore refutes 100% of Effect ports in an estate that is entirely Effect, and the
parity gate consumes it with no human in the loop. The oracle must refute an *implementation* sitting
in a port module, not the port itself. It is pinned both ways against real files: it must NOT refute
`packages/uuid-effect/src/tag.ts` and it MUST refute `packages/uuid-effect/src/layer.live.ts`.

**AST-fact kinds — FALSIFIABLE, and therefore forbidden in front matter**

`exports`, `imports`, `dependencies`, `effect_service`, `effect_layer`, `loc`, `language`,
`complexity`, `coverage`, `type_signatures`, `error_types`, `call_edges`, `service_unit`. Thirteen.

**The table is 3 path kinds + 12 front-matter kinds + 13 AST-fact kinds = 28 markings**, and that
total is pinned by test so an added kind with no decision reddens rather than passing unmarked.

`service_unit` is the retired `s_` kind. It is listed here rather than dropped, so that the reason it
has no home in either the path or front matter is recorded rather than inferred.

### The contract

Where an AST fact refutes a path or front-matter claim, **the AST wins**, that field's provenance
becomes `ast_fact`, and the linter emits a `parity-violation` finding naming both sites. The
declaration is never silently corrected: a declaration that disagrees with reality is a finding, not
a fixup.

Where a kind is UNFALSIFIABLE, the linter must never emit a finding against it on AST grounds,
because it has no ground to stand on. The only checks available there are structural (literal
membership, uniqueness) and relational (the import matrix).

**Why the partition is worth more than either half.** It tells a consumer exactly which parts of the
map are verified and which are asserted. A forest can render a verified node differently from an
asserted one, and an auditor knows which claims to spot-check by hand, because no machine can.

---

## 8. Tags — the form, and the inheritance rule

Tags are **not in paths**. The form ships here because front matter and any future tag consumer must
agree on one spelling, and two definitions of one form is the drift this design refuses.

```
tagToken := [a-z0-9]+ ( '_' [a-z0-9]+ )*
```

Split on the **first** underscore: the head is the key, the tail is the value. A token with no
underscore at all is a **bare** tag.

```
'pii'                  -> Bare { name: 'pii' }
'owner_platform_team'  -> KeyValue { key: 'owner', value: 'platform_team' }
```

Keys are single tokens; values may be multi-word snake_case. That is the right way round: keys are a
small controlled vocabulary in practice (`owner`, `pii`, `tier`, `stability`, `subdomain`), values
are free.

### Open versus closed is structural, not a lookup

> A **kind** drawn from the closed `StructuralKind` set is structural, and its value must be a member
> of that kind's closed literal set — an unknown value is a loud error. A **tag** key, value or bare
> name is unconstrained, and an unknown one parses silently.

No lookup table decides open-versus-closed; the position decides it. That is what makes an unknown
`q_foo` red and an unknown tag green, deterministically. The asymmetry is reused by the front-matter
schema rather than rebuilt there.

### Inheritance

```
tags(node) = ⋃ { tags(ancestor) : ancestor ∈ chain(node) } ∪ tags(node)
```

A set union, so the result is **order-independent by construction**. On a key collision the
**deepest** occurrence wins — override semantics — and the linter emits an INFO finding
`tag-shadowed` naming both sites. Bare tags never collide.

**A collision INSIDE one node's own tag list is a key collision too, and it is reported.** It is also the
likeliest one in practice: a hand-written front-matter `tags` list is where a duplicate key actually gets
typed. `shadowedKeys` operates on already-collapsed `TagSet` values and therefore structurally cannot see
an intra-node collision, so `decodeTagSet` reports it from the token list before the collapse, using the
same `ShadowedKey` shape.

### One reserved key

`subdomain` is the single tag key whose value is schema-checked, against the closed `Subdomain` set.
It is declared as reserved rather than special-cased in a parser.

**The check is shipped, not merely declared.** `validateTagToken` and `decodeTagSet` apply `TAG_TOKEN`
to the key and the value and schema-check a `subdomain` key against `Subdomain`, returning a typed
failure. `parseTagToken` and `tagSetOf` stay total and permissive as the underlying primitives. Both are
exported deliberately, and the checked pair is the documented path — because a rule that exists only as
an exported constant nothing consults is a declaration reported as a verdict, which is the readiness
anti-pattern this estate legislates against. Without a shipped check every consumer reimplements it, and
they drift.

**`subdomain` moved from the path to front matter, and that is a deviation worth flagging.** An
earlier revision carried it as an inline suffix on the context segment
(`bc_uuid_effect__subdomain_generic`). Under that design, reclassifying a context from `supporting`
to `core` renames the context root — which moves *every file in the context*, the single most
expensive move available in the tree. That is precisely the move cost the front-matter split exists
to eliminate, so carrying subdomain in the path would have reintroduced it at maximum blast radius
for the one property least likely to be got right first time. It is a tag; it lives where tags live.

---

## 9. Abstention is a first-class result

The vocabulary carries explicit honest terminals — `unassigned` for a tactical pattern, `unlayered`
for a layer, `unassigned` for a provenance — and uses them. **A classification that guesses is worse
than one that abstains.**

**No gate may be armed on the abstention count.** It may be reported. Making it block would create
exactly the pressure to invent a classification that the terminals exist to relieve.

### The measured floor: six files in twenty-four

Across the twenty-four source files in this repository at commit `4d431c6`, restricting to the
fourteen inherited tactical literals, the only candidate for most of them is `module` — a positive
claim ("a cohesive grouping") that around nineteen of them do not earn. The four appended literals
(`port`, `adapter`, `test_double`, `barrel`) convert fifteen of those nineteen into honest terms.

**Six still abstain, and that is the correct output for them:**

| File | Why no term applies |
|---|---|
| `packages/bun-svelte-test/src/checked-pseudo.ts` | monkey-patches happy-dom's `QuerySelector`/`SelectorItem` internals; a patch is not an adapter |
| `packages/effect-bun-test/src/utils.ts` | twenty wrappers over `node:assert` |
| `packages/bun-svelte-test/src/mount.ts` | twenty-six lines of thin call-through around svelte's `mount`/`unmount` |
| `packages/fixture-residue/src/sweep.ts` | spans four layers in one 180-line file |
| `packages/effect-test-kit/src/tagged.ts` | pure functions over `Cause`/`Exit`/`Result`/`Option`; nothing to layer |
| `packages/effect-bun-test/src/fixture-root-suite.ts` | a suite wrapper; it is what it is |

**Do not append a literal to drive that number down.** `p_patch`, `p_wrapper` and `p_constants` are
each a literal minted to avoid saying "I don't know", and additive-only makes such a mistake
permanent. An append is justified only when it describes a real recurring structure.

### The limitation this exposes, stated plainly

All four layers are honestly present in `sweep.ts`, but classification grades **files**. **A path
grammar is only as fine-grained as the file decomposition: a file spanning layers is graded at its
lowest-privilege layer, and the grammar reports a coarser truth than the code contains.** Splitting
that file is the single highest-value follow-up available, and it is a rewrite, explicitly outside a
move-only migration.

---

## 10. What this grammar cannot do

**Strategic relationships are not path-encodable, and no attempt is made.** A path is a tree;
`ContextRelationship { from, to, pattern }` is an edge. Encoding one would produce a directory per
relationship — a containment node for something with no containment meaning.

The `RelationshipPattern` literal set ships here as **vocabulary only**. The relationships themselves
belong in a declared `context-map.toml` consumed elsewhere, carried on an already-enumerated graph
edge kind, and verified against the import graph: a declared edge with no import is
`relationship-unrealised`; an import with no declared edge is `relationship-undeclared`. Both are
findings against the map, never against a path.

---

## 11. API surface

Five subpaths, each a flat module. `effect` is a **peer**, never a dependency.

### `@packages/ddd-path/grammar`

```ts
export const LCD_IDENTIFIER: RegExp;
export const GRAMMAR_NAME: RegExp;
export const RESERVED_WORDS: ReadonlySet<string>;
export const STRUCTURAL_KINDS: readonly ['bc', 'lang', 't'];
export const SUPERSEDED_KINDS: readonly ['l', 'p', 's', 'tag'];
export const SUPERSEDED_KIND_DESTINATION: Readonly<Record<SupersededKind, string>>;

export const StructuralKind, SupersededKind, Language, Subdomain, DddLayer, TacticalPattern,
             TestKind, Provenance, AnchorKind, OutsideKind, UngradedReason, MalformedReason,
             HierarchyRole, RelationshipPattern;   // Effect Schema.Literals
export type  StructuralKind, /* … one type alias per set … */;

export const LANGUAGES, SUBDOMAINS, DDD_LAYERS, TACTICAL_PATTERNS, TEST_KINDS,
             PROVENANCES, ANCHOR_KINDS, OUTSIDE_KINDS, UNGRADED_REASONS, MALFORMED_REASONS,
             HIERARCHY_ROLES, RELATIONSHIP_PATTERNS: readonly string[];   // the member lists

export const checkValue: (value: string) => Option<MalformedReason>;   // §2 refusal precedence
```

### `@packages/ddd-path/tags`

```ts
export type TagToken = { readonly _tag: 'Bare'; readonly name: string }
                     | { readonly _tag: 'KeyValue'; readonly key: string; readonly value: string };
export type TagSet   = { readonly keyed: ReadonlyMap<string, string>; readonly bare: ReadonlySet<string> };

export const RESERVED_TAG_KEYS: ReadonlySet<string>;      // { 'subdomain' }
export const emptyTagSet: TagSet;
export const parseTagToken: (token: string) => TagToken;          // total, permissive primitive
export const tagSetOf: (tokens: readonly string[]) => TagSet;     // total, permissive primitive
export const validateTagToken: (token: string) => Effect<TagToken, TagError>;
export const decodeTagSet: (tokens: readonly string[]) => Effect<DecodedTagSet, TagError>;
// DecodedTagSet carries the TagSet plus the intra-node ShadowedKey entries the collapse would destroy.
export const inheritTags: (chainOutermostFirst: readonly TagSet[]) => TagSet;   // deepest wins
export const shadowedKeys: (chainOutermostFirst: readonly TagSet[]) => readonly ShadowedKey[];

export type ShadowedKey = {
  readonly key: string;
  readonly shadowedIndex: number;   readonly shadowedValue: string;
  readonly winningIndex: number;    readonly winningValue: string;
};
```

An index into the outermost-first chain is the only site identifier available to a pure function, and
§8 requires the finding to name both sites. One entry per shadowed occurrence: a key set at three
depths yields two.

### `@packages/ddd-path/config`

```ts
export const ShellMatcher, ShellRun, LanguageShell, GrammarConfig;   // Effect Schema
export type  GrammarConfig;
export const emptyGrammarConfig: GrammarConfig;
export const decodeGrammarConfig: (input: unknown) => Effect<GrammarConfig, GrammarConfigError>;
export const parseGrammarToml:    (source: string) => Effect<GrammarConfig, GrammarConfigError>;

export const GRAMMAR_CONFIG_ERROR_REASONS: readonly ['toml_parse_failed', 'schema_violation'];
export type  GrammarConfigErrorReason = (typeof GRAMMAR_CONFIG_ERROR_REASONS)[number];
export class GrammarConfigError extends Data.TaggedError('GrammarConfigError')<{
  readonly reason: GrammarConfigErrorReason;
  readonly detail: string;
}> {}
```

`GrammarConfig` is `{ version: Int; shell: Record<Language, LanguageShell | undefined> }`. `version`
is required — every worked table in §4 carries it — and each language entry is optional, so a partial
table decodes rather than failing.

### `@packages/ddd-path/parse`

```ts
export type Segment;                       // Shell | Context | LanguageRoot | TestTree | Reserved | Untyped | MalformedSegment
export type ParsedPath = {
  readonly path: string;            readonly basename: string;
  readonly segments: readonly Segment[];
  readonly context?: string;        readonly language?: Language;
  readonly adopted: boolean;        // a lang_ segment is present — the partial-adoption hinge
  readonly testKind?: TestKind;     readonly shellRole?: ShellRole;
  readonly shellSegments: readonly string[];
  readonly anchor?: AnchorKind;     readonly outside?: OutsideKind;
  readonly reservedBasename: boolean;
  readonly malformed: readonly MalformedSegment[];
};
export type PathClass;                     // §6
export const parsePath:       (repoRelativeFilePath: string, config: GrammarConfig) => ParsedPath;
// PRECONDITION: a normalized, repo-relative POSIX path. A leading separator, any `..` component, or
// any backslash yields Malformed { unnormalized_path } rather than being silently tolerated.
export const classifyParsed:  (parsed: ParsedPath) => PathClass;
export const classify:        (repoRelativeFilePath: string, config: GrammarConfig) => PathClass;

export const ANCHOR_BASENAMES: ReadonlyMap<string, AnchorKind>;
export const OUTSIDE_SEGMENTS: ReadonlyMap<string, OutsideKind>;
```

**A `ReadonlyMap`, not a `Record`, and the reason is soundness rather than taste.** These two tables
exist to be consulted by a lookup on a key that is usually absent — most basenames are not anchors
and most segments are not outside. `noUncheckedIndexedAccess` is not enabled in this repo, so
indexing a `Record<string, AnchorKind>` with a missing key is typed `AnchorKind` while evaluating to
`undefined`: the signature lies at exactly the call site that matters. `Map.get` is typed
`AnchorKind | undefined`, which is the truth. Both remain fully enumerable, so the inspectability
they are exported for is unaffected.

`ANCHOR_BASENAMES` and `OUTSIDE_SEGMENTS` are the detection tables steps 1 and 2 of §6 consult. They
are exported rather than hidden, so a consumer can see exactly what is recognised — and so that the
`sdk` omission recorded in §5 is inspectable rather than a surprise. A per-repository declared
outside-prefix list is deferred work.

The parser **never fails; it classifies.** A judgment is a linter's job, and a linter is a later
chunk.

### `@packages/ddd-path/marking`

```ts
export type Falsifiability = 'falsifiable' | 'unfalsifiable';
export type MarkingHome    = 'path' | 'front_matter' | 'ast_fact';
export type KindMarking = {
  readonly kind: string;
  readonly falsifiability: Falsifiability;
  readonly home: MarkingHome;
  readonly oracle: string;
  readonly partialRefutation?: string;
};
export const KIND_MARKINGS: readonly KindMarking[];
export const markingOf: (kind: string) => KindMarking | undefined;
export const isForbiddenInFrontMatter: (kind: string) => boolean;   // keyed on home; FAILS CLOSED
export const frontMatterEligibility: (kind: string) => 'legitimate' | 'forbidden' | 'unmarked';
export const FRONT_MATTER_LEGITIMATE_KINDS: readonly string[];
export const PATTERN_REFUTATIONS: Readonly<Record<TacticalPattern, string | undefined>>;
export const ABSTENTION_FLOOR: readonly { readonly path: string; readonly reason: string }[];
```

---

## 12. Provenance of every measurement in this document

| Claim | Source |
|---|---|
| 24 source files, the six abstaining files, `4d431c6` | `effect-bun-tooling`, this repository |
| the 49% adoption cost (156 files, 76 reds), and 0 reds once the test tree is minted (114 files) | `effect-bun-tooling` working tree, measured by `__tests__/corpus-sweep.test.ts`. The figure moved from an earlier 47%/151/71 because this chunk's own files enlarged the denominator |
| Kotlin Gradle flavor source sets, Rust `tests/`, Roku channel, Elixir tree, zero `.swift`, 151 vendored `.h`/`.cpp` | `project-xavier` @ `444244199`, read-only |
| fifteen KMP source sets, two `.swift` files, `day/harvest` org path, the org-path-absent module | `harvest/kmp` @ `1e7d64f`, read-only |
| `pub mod l.domain;` rustc failure, Elixir dotted-directory compile, `Macro.camelize` round-trip | executed against rustc 1.96.1, `mix`, and `elixir` |
| `Sources/<Target>/` Swift shell | **not** corpus-validated; synthetic `swift build` only |
| Kotlin identifier legality, Roku packager layout | specification-cited; no `kotlinc` or `gradle` on the authoring machine |
