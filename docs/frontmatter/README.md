# Front matter

The structured, schema-validated metadata block that lives in a comment at the top of every owned,
comment-capable file in a repository. Implemented by `@packages/ddd-meta`.

- [`derivability.md`](./derivability.md) — the rule that decides what may be a field at all.
- [`field-registry.md`](./field-registry.md) — the closed 11-field registry, value shapes, canonical output.

## The sentinel

The sentinel is `---uv`. Four carriers wrap one identical payload:

| Carrier | Open | Payload lines | Close | Extensions |
|---|---|---|---|---|
| `block` | `/* ---uv` | raw | `--- */` | `.ts .tsx .js .jsx .mjs .cjs .mts .cts .rs .swift .kt .kts .c .cc .cpp .h .hpp .css .scss` |
| `hash` | `# ---uv` | `# ` prefixed | `# ---` | `.ex .exs .py .sh .bash .zsh .toml .yml .yaml` |
| `apostrophe` | `' ---uv` | `' ` prefixed | `' ---` | `.brs` |
| `xml` | `<!-- ---uv` | raw | `--- -->` | `.html .htm .md .svelte .vue` |

`.xml` and `.svg` are **not** on this table, and the omission is a decision. See
[Why `.xml` and `.svg` are excluded](#why-xml-and-svg-are-excluded).

The payload is TOML. Strip the carrier's line prefix and all four carriers yield the same bytes, which is
why a value decoded from one carrier is deep-equal to the same value decoded from any other.

An opening line must equal its carrier's open delimiter exactly after trimming; likewise the close. A
payload line under a prefixed carrier must start with the prefix, or be exactly the prefix with its
trailing space removed (a bare `#` or `'`). Anything else is `CarrierLinePrefixMissing`.

## Asymmetry: silent for non-participants, loud for participants

| Situation | Outcome | Why |
|---|---|---|
| no sentinel | `NoFrontMatter` — silently ignored | a repository adopting this format has thousands of files that will never carry it, and bothering them is how a tool gets turned off |
| sentinel present, payload bad | loud typed error | the author asked to participate and got it wrong |
| sentinel present, not in the front-matter position | loud `MisplacedFrontMatter` | silence would let an author believe front matter took effect where no tool reads it |
| two sentinel openings in one file | loud `DuplicateFrontMatter` | two blocks means two answers, and nothing decides between them |

## Position: the preamble rule

Front matter MUST open on the **first non-preamble line**. The preamble is a maximal run from the start
of the file of:

- blank or whitespace-only lines;
- a shebang `#!…`, on **line 1 only**;
- an XML prolog `<?…?>` or a `<!DOCTYPE …>`, under the `xml` carrier;
- a Rust inner attribute line starting `#![` — `#![no_std]` must stay at the crate root top;
- a **closed** Markdown YAML front-matter fence, under the `xml` carrier, on line 1 only;
- a comment line or comment block carrying a **file-scoped** machine-read directive. A **next-line**
  directive STOPS the preamble instead of being consumed — see [Not every directive may be
  consumed](#not-every-directive-may-be-consumed) below, which is the rule, not an exception to it.

`MACHINE_READ_DIRECTIVES` is the closed, exported **recognition vocabulary** — the tokens that make a
leading comment a machine-read directive at all. It does not by itself decide anything: `DIRECTIVE_SCOPES`
is the **rule**, and it is what `advancePreamble` reads. The vocabulary is: `biome-ignore`, `ast-grep-ignore`, `@ts-expect-error`,
`@ts-ignore`, `@ts-nocheck`, `eslint-disable`, `eslint-enable`, `svelte-ignore`, `prettier-ignore`,
`/// <reference`, `@license`, `SPDX-License-Identifier`, `shellcheck`, `ruff:`, `noqa`, `-*- coding`,
`type: ignore`, `mypy:`, `pylint:`, `rustfmt::skip`, `clippy::`, `@flow`, `@jsx`.

### Not every directive may be consumed

A directive is preamble only when consuming it cannot DETACH it from what it governs, so
`DIRECTIVE_SCOPES` assigns every one a scope and the preamble rule reads it:

| Scope | Directives | Effect |
|---|---|---|
| `file` | `@ts-nocheck` `eslint-disable` `eslint-enable` `/// <reference` `@license` `SPDX-License-Identifier` `shellcheck` `ruff:` `noqa` `-*- coding` `type: ignore` `mypy:` `pylint:` `clippy::` `@flow` `@jsx` | consumed as preamble; the block is written BELOW |
| `next_line` | `@ts-expect-error` `@ts-ignore` `ast-grep-ignore` `biome-ignore` `prettier-ignore` `svelte-ignore` `rustfmt::skip` | STOPS the preamble; the block is written ABOVE, keeping the directive adjacent to the line it suppresses |

`DIRECTIVE_SCOPES` covers every member of `MACHINE_READ_DIRECTIVES` and adds exactly two entries,
`biome-ignore-all` and `eslint-disable-next-line`, each an extension of a token already in the vocabulary.
It is held in lexicographic order so that its ORDER carries no protection: both prefix pairs sit with the
shorter token first, which is the order in which a first-match classifier gets both of them wrong.

A `next_line` directive governs the line that FOLLOWS it. Writing the block between the two returns the
suppressed diagnostic and, for `@ts-expect-error`, adds a second error because the now-pointless
directive is itself `TS2578: Unused '@ts-expect-error' directive`.

Scope is read by **longest matching token**, because two spellings are extensions of their opposite:
`biome-ignore-all` is file-scoped and contains the `next_line` token `biome-ignore`, while
`eslint-disable-next-line` is `next_line`-scoped and contains the file-scoped token `eslint-disable`.
First-match would misclassify both, and `biome-ignore-all` is the live population.

### A Markdown YAML fence is preamble

A `.md` file opening with a `---` fence that CLOSES gets the block written BELOW the fence. Every consumer
of YAML front matter requires the fence to be the first thing in the file; writing above it produces no
syntax error anywhere and silently removes the file's metadata. A leading `---` with no closing `---` is
ordinary content, not a fence, and the previous behaviour stands.

A **prose** comment before the block means the front matter is not in position. Rust `//!` doc comments
and a shell file's `# Shared helper: …` block are exactly this case, and both appear in the fixtures for
that reason: the preamble stops at them, so a block written below them is `MisplacedFrontMatter` and a
block written by `upsertFrontMatter` goes ABOVE them.

A comment span that IS a front-matter opening never counts as preamble, whatever its payload contains.
Without that carve-out a block whose `links` value happened to contain the text `@license` would skip
past itself and report as misplaced.

## Exclusion: honest terminals, never failures

A path is either **Carried** by one of the four carriers, or **Excluded** for a stated reason. Exclusion
is a terminal state, never an error:

`comment_incapable` · `carrier_not_expressible` · `generated` · `vendored` · `unowned` · `no_carrier_declared`

The precedence order is itself a tested property:

```
vendored > generated > unowned > comment_incapable > carrier_not_expressible > carrier lookup > no_carrier_declared
```

`generated` and `vendored` are decided **by path**, and they must beat the extension lookup: a generated
`.ts` is excluded even though `.ts` has a carrier. The recorded incident is the reason — stripping
comments from a generated `.d.ts` desynced a sha256 fingerprint. Front matter in a generated file must
come from its GENERATOR or not at all.

Segment matching is **full-segment** on the posix path, never substring, and only over directory
segments. `distribution/` must not match the `dist` segment, and it does not.

| Class | Members |
|---|---|
| `comment_incapable` | `.json`; the binary and opaque extensions `.png .jpg .jpeg .gif .ico .otf .ttf .woff .woff2 .jar .class .pem .pbf .zip .tgz .bin .so .dylib .dll`; the basenames `LICENSE`, `NOTICE` |
| `generated` (basenames) | `bun.lock` `package-lock.json` `yarn.lock` `pnpm-lock.yaml` `Cargo.lock` `gradle.lockfile` |
| `generated` (segments) | `dist` `build` `target` `out` `node_modules` `.svelte-kit` `generated` `__generated__` |
| `vendored` (segments) | `vendor` `vendored` `third_party` `third-party` `Pods` `externals` |
| `unowned` (basenames) | `.gitignore` `.gitattributes` `.dockerignore` `.npmrc` `.editorconfig` |
| `carrier_not_expressible` | `.xml` `.svg` |

The whole table is `DEFAULT_EXCLUSION_POLICY`, which is declared data decoded through Effect Schema
(`ExclusionPolicySchema`), not code. A repository that needs a different policy decodes its own.

## Why `.xml` and `.svg` are excluded

XML 1.0 §2.5 gives `Comment ::= '<!--' ((Char - '-') | ('-' (Char - '-')))* '-->'`: the string `--` MUST
NOT occur inside comment content. The ratified xml fences are `<!-- ---uv` and `--- -->`, so `--` lands in
the comment content **at the first fence, before any payload is written**. Two conforming parsers agree —
libxml2 reports `Double hyphen within comment`, expat reports `not well-formed (invalid token)` — and it
fires on 100% of writes with the canonical payload, with no adversarial input involved.

This is a fact about the **fence spelling**, not about XML metadata being impossible. The candidate fix is
an XML **processing instruction**, `<?uv … ?>`, which is legal by construction and carries no hyphen
restriction at all. That is a change to the ratified `---uv` token which other work already binds to, so
it awaits ratification rather than being made here. Until then the honest verdict is that the format
cannot carry these files, and `carrier_not_expressible` is how this package says so. The exclusion is
fully reversible the day a new fence is ratified.

The exclusion is scoped to the hosts that actually reject `--`. `.html`, `.htm`, `.md`, `.svelte` and
`.vue` stay on the xml carrier: the HTML5 tokenizer and CommonMark ≥ 0.30 both tolerate `--` inside a
comment, so the same fence is well-formed there.

## Neutralisation: a payload may never move the host comment's end

A rendered payload must never change **where the host comment ends**. That, and not "a comment
terminator", is the set — a sequence qualifies when its presence relocates the comment's end in either
direction.

| Sequence | Direction | Escaped as |
|---|---|---|
| `*/` | ends the block comment EARLY; the rest of the file is parsed as code | `\u002A` + `/` |
| `-->` | ends the xml comment EARLY | `\u002D` + `->` |
| `/*` | delays the end INDEFINITELY wherever the host NESTS block comments — Rust, Swift and Kotlin all do, and `.rs .swift .kt .kts` are block-carrier extensions | `\u002F` + `*` |

Only the FIRST character of each occurrence is escaped, which is what makes the overlapping inputs
`**/`, `--->` and `/*/` decode byte-identical. `Bun.TOML` decodes `\uXXXX` back to the original
character, so the value is PRESERVED rather than refused. The escape is UNCONDITIONAL in all four
carriers — the payload is one payload behind four delimiter sets — and its set is DERIVED from the
carrier table, so a fifth block-comment carrier is covered the moment it declares whether it nests.

`<!--` is deliberately NOT neutralised: an xml comment ends at its first `-->`, so an inner open cannot
move that end. A bare `--` is not chased either — the ratified fences carry it by design, which is
precisely the fact that excludes `.xml` and `.svg` above.

Escaping covers rendered **values**. An inline-table **key** is interpolated into the payload rather than
escaped, and a `*` is not legal in a TOML bare key at all, so a hostile key is REFUSED rather than
neutralised — see the write errors below.

## Errors

Every failure is a plain readonly tagged object. Nothing throws, and no Effect runtime is required.

Read errors — `FrontMatterError`, every one carrying a 1-based `line`:

| Tag | Carries | Raised when |
|---|---|---|
| `UnterminatedBlock` | carrier, line | an opening with no matching close |
| `CarrierLinePrefixMissing` | carrier, line | a payload line without the carrier's prefix |
| `EmptyPayload` | carrier, line | the block decodes to zero keys |
| `TomlSyntax` | carrier, line, message | Bun's TOML parser threw; the throw is caught and converted, never allowed to escape |
| `SchemaDecode` | carrier, line, message | the payload is TOML but not a valid payload; the rendered schema message is carried as a string |
| `PayloadMovesHostCommentEnd` | carrier, line, sequence | a payload line between the fences carries a sequence that relocates the host comment's end. A no-op for the `hash` and `apostrophe` carriers, which declare no block comment; the close fences themselves are outside the scanned span and can never trip it |
| `MisplacedFrontMatter` | line | an opening that is not on the first non-preamble line |
| `DuplicateFrontMatter` | line | a second opening in one file |

Write errors — `FrontMatterWriteError` adds these two to the read set. They are about the VALUE, not the
text, so they carry no line:

| Tag | Carries | Raised when |
|---|---|---|
| `UnregisteredField` | keys | the value declares a key the closed registry does not carry. It used to be dropped in silence |
| `PayloadNotRenderable` | message | the rendered payload does not parse as TOML, or parses and fails field validation — a hostile inline-table key, or a control character a URI value admits and TOML cannot express |

Line numbers are 1-based, and for the block-level errors they name the OPENING line.

## Writing

`upsertFrontMatter(text, carrier, value)`:

- emits keys in registry order, `tags` and `data` sorted and deduped, `links` as an inline table with
  sorted keys;
- preserves the preamble above it;
- preserves the file's dominant line ending and its final-newline convention (a mixed-ending file is
  normalised onto the dominant one);
- REPLACES an existing in-position block, INSERTS after the preamble when absent;
- is IDEMPOTENT: `upsert(upsert(t, c, v), c, v) === upsert(t, c, v)`, on all four carriers;
- refuses with a typed error when the text is misplaced, duplicated or unterminated, and when the VALUE
  cannot be rendered — the write path is total over both, and validates the value BEFORE it touches the
  text;
- emits a blank line after the block when the next line is non-empty, so an adjacent `#` prose comment
  can never be read as a continuation of a hash-carrier block.

## Vocabulary arrives as data

`@packages/ddd-meta` ships the `Vocabulary` TYPE and ZERO members. Decoding front matter gives SHAPE
validity only; vocabulary membership is a second, explicit call to `gradeFrontMatter(value, vocabulary)`.
Skipping it is a consumer defect, and the types name it: decode yields a `FrontMatter`, grading yields
findings, and a consumer who wants a graded value calls both.

A field whose declared vocabulary is empty yields `VocabularyUndeclared` rather than nothing. An
unchecked claim is reported as unchecked; it is never reported as approved.

This is the same discipline as a tooling plane that never loads consumer code: the format layer holds no
vocabulary, and the vocabulary arrives as decoded configuration. It is also what keeps one truth in one
copy — `ddd-meta` never mints a second definition of the layer or pattern literal sets that another
package owns.
