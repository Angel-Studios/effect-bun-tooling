# The field registry

Closed. Eleven fields. Every one carries a written justification of at least 40 characters explaining why
no AST can PRODUCE the value. Adding a twelfth field means adding a registry entry AND a schema field:
the parity obligation in `docs/frontmatter/derivability.md` fails if you do only one.

Every field is OPTIONAL. A payload with ZERO keys is `EmptyPayload`, which is loud — an empty block is a
declaration that declares nothing, and it is far more likely to be a mistake than an intent.

| Key | TOML type | Why no AST can produce it |
|---|---|---|
| `l` | string | DDD layer. Design intent. An oracle can REFUTE a specific claim — a file declared `domain` importing `node:*` or `bun:*` — but it cannot PRODUCE the layer: two runtime-free modules are domain or application by intent alone. Keyed `l` and **not** `layer` deliberately; see the forbidden set. |
| `p` | string | Tactical pattern. A class with an id field is not thereby an Entity; a struct is not thereby a Value Object. Weak signals exist; refutation does not. Pure DDD modelling intent. |
| `subdomain` | string | Strategic judgment about what the business competes on. Nothing in the code states whether a context is core, supporting or generic. |
| `tags` | string[] | Arbitrary declared metadata by design; no oracle exists unless a specific tag key ships its own. Canonically sorted and deduped, because k tags admit exactly ONE canonical spelling — never k factorial. |
| `owner` | string | Organisational ownership. No code artifact records which team OWNS a file; VCS authorship records who TOUCHED it, which is a different claim. |
| `tier` | string | Criticality / SLO band. A business decision about the consequence of failure, which no property of the source expresses. |
| `data` | string[] | Data classification (`pii`, `pci`, `phi`). A legal and regulatory judgment about what a value MEANS; a `string` field is not self-describing. |
| `deprecated` | string (date) | Intent to remove, plus a date. Nothing in the code states an INTENTION; a `@deprecated` marker would itself be a declaration, not a derivation. |
| `links` | table | Pointers to artifacts OUTSIDE the tree: an ADR, a ticket, a runbook, a dashboard. Not derivable by construction — the referent is not in the corpus at all. |
| `review` | string (date) | A human attestation that someone looked, and when. An attestation cannot be derived from the thing attested. |
| `oncall` | string | Routing target for a page. An organisational fact with no code representation anywhere in the tree. |

## Value shapes

| Shape | Pattern | Applies to |
|---|---|---|
| IDENT | `^[a-z_][a-z0-9_]*$` | `l`, `p`, `subdomain`, `owner`, `tier`, `oncall`, every member of `tags` and `data`, and every KEY of `links` |
| DATE | `^\d{4}-\d{2}-\d{2}$` | `deprecated`, `review` |
| URI | `^[a-z][a-z0-9+.-]*:` | every VALUE of `links` |

IDENT is the least-common-denominator charset: what every carrier, every filesystem and every path
segment admits without quoting.

`tags` and `data` are arrays of IDENT that must be **non-empty, unique, and strictly lexicographically
ascending**. An unsorted or duplicated array is a DECODE FAILURE, not a value the decoder silently
repairs. That is what makes the canonical form enforceable rather than aspirational: a repaired value
would round-trip differently from the bytes on disk, and every diff would be noise.

`links` carries no non-empty requirement. That asymmetry is deliberate and worth knowing: `tags` and
`data` have a canonical ordering to enforce, and an empty array is the one array with no members to
order, so refusing it costs nothing. A table has no ordering to enforce in the source text — the writer
sorts its keys on the way out — so the same argument does not reach it.

## Unknown keys are a decode failure

`Schema.Struct` in Effect v4 STRIPS an unrecognised key by default. This package therefore decodes with
`onExcessProperty: 'error'` (`FRONT_MATTER_PARSE_OPTIONS` in `src/schema.ts`), which is what turns a
misspelled or forbidden key into a loud `SchemaDecode` rather than a silent omission. A field named
`exports` in a real block is refused by this mechanism, not by the derivability gate — the gate governs
what may enter the registry, and the excess-property refusal governs what may enter a file.

## Canonical output

`renderFrontMatter` emits keys in **registry order**, never object insertion order; `tags` and `data`
sorted and deduped; `links` as a TOML inline table with sorted keys. Two callers holding equal values
therefore emit byte-identical blocks, which is what makes `upsertFrontMatter` idempotent and its diffs
readable.

Dates are emitted as **quoted strings**. A bare TOML date is not merely a style choice here: Bun's TOML
parser (1.3.14) refuses `review = 2026-01-02` outright with `Expected key but found -`, so an unquoted
date would be a `TomlSyntax` failure rather than a date.
