# @packages/ddd-meta

The **front-matter format**: a schema-validated TOML metadata block carried in a comment at the top of
an owned, comment-capable file, plus the four per-language comment carriers that read and write **one
identical payload**.

This package owns the FORMAT and ships **zero vocabulary**. The members of the layer, pattern, subdomain
and tier vocabularies arrive as injected data through `./vocabulary`, never as a second copy of a
definition another package owns.

```sh
bun add @packages/ddd-meta   # peer: effect >=4.0.0-rc.109 <5
```

## The block

Four carriers, one payload. The payload between the delimiters is TOML, and it is byte-identical across
all four once the per-line carrier prefix is stripped.

| Carrier | Open | Payload lines | Close |
|---|---|---|---|
| `block` | `/* ---uv` | raw | `--- */` |
| `hash` | `# ---uv` | `# ` prefixed | `# ---` |
| `apostrophe` | `' ---uv` | `' ` prefixed | `' ---` |
| `xml` | `<!-- ---uv` | raw | `--- -->` |

```ts
/* ---uv
l = "domain"
p = "value_object"
tags = ["ddd", "front_matter"]
owner = "platform_tooling"
links = { adr = "https://example.invalid/adr/0023" }
--- */
```

## The asymmetry is the safety property

| Situation | Outcome |
|---|---|
| no sentinel | `NoFrontMatter` — **silently ignored**. Non-participants are never bothered. |
| sentinel present, payload bad | **loud typed error**. Participants who got it wrong are told. |
| sentinel present, not in the front-matter position | loud `MisplacedFrontMatter`. |
| two sentinel openings in one file | loud `DuplicateFrontMatter`. |

Silence on a misplaced block would let an author believe front matter took effect where no tool reads it.

## Reading

```ts
import * as Result from 'effect/Result';
import { readFrontMatter } from '@packages/ddd-meta/parse';

const outcome = readFrontMatter('packages/thing/src/order.ts', source);
if (Result.isFailure(outcome)) return report(outcome.failure);

switch (outcome.success._tag) {
  case 'Excluded':      return skip(outcome.success.reason);
  case 'NoFrontMatter': return skip('not a participant');
  case 'FrontMatter':   return use(outcome.success.value);
}
```

`parseFrontMatter(text, carrier)` is the same path without the exclusion classifier. Both are **pure
functions over strings**: no I/O, no module state, no Effect runtime. Errors are plain readonly tagged
objects, and a consumer lifts a `Result` into Effect in one call.

## Writing

```ts
import * as Result from 'effect/Result';
import { upsertFrontMatter } from '@packages/ddd-meta/write';

const written = upsertFrontMatter(source, 'hash', { l: 'infrastructure', owner: 'platform_tooling' });
if (Result.isFailure(written)) return report(written.failure);
save(path, written.success);
```

`upsertFrontMatter` returns `Result<string, FrontMatterWriteError>`. It preserves the file's dominant line
ending and its final-newline convention, replaces an existing in-position block, inserts after the preamble
when absent, and is idempotent on all four carriers.

The preamble it writes below is a shebang, an XML prolog, a Rust `#![…]` inner attribute, a **closed**
Markdown YAML fence, and any **file-scoped** machine-read directive. A **next-line** directive —
`@ts-expect-error`, `@ts-ignore`, `ast-grep-ignore`, `biome-ignore`, `prettier-ignore`, `svelte-ignore`,
`rustfmt::skip` — STOPS the preamble instead, and the block is written ABOVE it so the directive stays
adjacent to the line it suppresses.

It refuses with a typed error in **five** cases: three about the TEXT, two about the VALUE.

| Tag | Refused because |
|---|---|
| `MisplacedFrontMatter` | the text already carries a block that is out of position |
| `DuplicateFrontMatter` | the text already carries two blocks |
| `UnterminatedBlock` | the text carries a block that is never closed |
| `UnregisteredField` | the value declares a key the closed registry does not carry |
| `PayloadNotRenderable` | the rendered payload would not parse as TOML, or would fail field validation |

The VALUE is validated before the TEXT is touched, so a bad value is reported even when the file's existing
block is also misplaced.

## Shape validity is not vocabulary validity

Decoding gives SHAPE validity only. Vocabulary membership is a **second, explicit call**:

```ts
import { gradeFrontMatter } from '@packages/ddd-meta/vocabulary';

const findings = gradeFrontMatter(value, vocabulary);
```

A field whose vocabulary carries zero members reports `VocabularyUndeclared` rather than passing: an
ungraded claim is reported as ungraded, never as approved.

## Subpaths

| Subpath | Holds |
|---|---|
| `./parse` | `parseFrontMatter`, `readFrontMatter`, `locateFrontMatter`, the `ParseOutcome` union |
| `./write` | `renderFrontMatter`, `upsertFrontMatter`, the canonical TOML renderer, the host-comment neutralisation |
| `./sentinel` | the `---uv` sentinel, line splitting, EOL detection, the preamble rule, the `MACHINE_READ_DIRECTIVES` recognition vocabulary and the `DIRECTIVE_SCOPES` table that decides what may be consumed |
| `./carrier` | the four carriers and their delimiters, prefix application and stripping |
| `./schema` | the Effect Schema for the payload, the value shapes, `decodeFrontMatter` |
| `./registry` | the closed 11-field registry, `FORBIDDEN_DERIVABLE`, `assertRegistryDerivability` |
| `./errors` | every error shape and its constructor, `describeFrontMatterError`, `describeFrontMatterWriteError` |
| `./exclude` | the exclusion classifier, `DEFAULT_EXCLUSION_POLICY`, `ExclusionPolicySchema` |
| `./vocabulary` | the `Vocabulary` seam, `gradeFrontMatter`, `decodeVocabulary` |

## Field registry, and why it is closed

A field is legitimate only when **no AST can PRODUCE its value**. An oracle that can CONTRADICT a claim
without being able to GENERATE it is fine — that is exactly what a parity gate checks. The full rule,
the forbidden set and every field's written justification live in `docs/frontmatter/`.

## Fixtures

`__tests__/fixtures/` carries real per-language files, derived once at authoring time from live
repositories and committed here. Nothing reads those repositories at run time; `provenance.ts` records
where each fixture came from as data.
