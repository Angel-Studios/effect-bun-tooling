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
| `xml` | `<!-- ---uv` | raw | `--- -->` | `.xml .html .htm .md .svelte .svg .vue` |

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
- any comment line or comment block whose text contains a member of `MACHINE_READ_DIRECTIVES`.

`MACHINE_READ_DIRECTIVES` is closed and exported: `biome-ignore`, `ast-grep-ignore`, `@ts-expect-error`,
`@ts-ignore`, `@ts-nocheck`, `eslint-disable`, `eslint-enable`, `svelte-ignore`, `prettier-ignore`,
`/// <reference`, `@license`, `SPDX-License-Identifier`, `shellcheck`, `ruff:`, `noqa`, `-*- coding`,
`type: ignore`, `mypy:`, `pylint:`, `rustfmt::skip`, `clippy::`, `@flow`, `@jsx`.

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

`comment_incapable` · `generated` · `vendored` · `unowned` · `no_carrier_declared`

The precedence order is itself a tested property:

```
vendored > generated > unowned > comment_incapable > carrier lookup > no_carrier_declared
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

The whole table is `DEFAULT_EXCLUSION_POLICY`, which is declared data decoded through Effect Schema
(`ExclusionPolicySchema`), not code. A repository that needs a different policy decodes its own.

## Errors

Every failure is a plain readonly tagged object. Nothing throws, and no Effect runtime is required.

| Tag | Carries | Raised when |
|---|---|---|
| `UnterminatedBlock` | carrier, line | an opening with no matching close |
| `CarrierLinePrefixMissing` | carrier, line | a payload line without the carrier's prefix |
| `EmptyPayload` | carrier, line | the block decodes to zero keys |
| `TomlSyntax` | carrier, line, message | Bun's TOML parser threw; the throw is caught and converted, never allowed to escape |
| `SchemaDecode` | carrier, line, message | the payload is TOML but not a valid payload; the rendered schema message is carried as a string |
| `MisplacedFrontMatter` | line | an opening that is not on the first non-preamble line |
| `DuplicateFrontMatter` | line | a second opening in one file |

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
- refuses with a typed error when the text is misplaced, duplicated or unterminated;
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
