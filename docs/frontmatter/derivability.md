# The derivability gate

## The rule, verbatim

> **The gate forbids DERIVABLE, not REFUTABLE.**
>
> **DERIVABLE** = an AST or an extractor can PRODUCE the value from the code alone. **FORBIDDEN.**
>
> **REFUTABLE** = an oracle can CONTRADICT a specific claim but cannot GENERATE it. **LEGITIMATE**, and it
> is precisely what feeds the parity gate: the path declares, the AST verifies.
>
> Under this rule `language`, `exports`, `imports`, `loc`, `coverage` and `service` are FORBIDDEN, because
> an extractor emits them. `l`, `p`, `subdomain`, `owner`, `tier`, `data`, `deprecated`, `links`, `review`
> and `oncall` are LEGITIMATE, because no AST can refute them. `l` and `p` are
> refutable-but-not-derivable, which is the interesting middle and the reason the parity gate has anything
> to check: where an AST fact refutes a path claim the AST WINS and the linter emits a parity-violation
> finding, but no AST ever mints the claim in the first place.

That text is not prose about the code. It is the exported constant `DERIVABILITY_RULE` in
`packages/ddd-meta/src/registry.ts`, so the rule and the gate cannot drift apart silently.

## Why "falsifiable" is the wrong word

The architect specification lists `l_<layer>` as "(partly)" falsifiable, and a gate that read
`FALSIFIABLE => derivable => FORBIDDEN` literally would delete `l` and `p` — the two fields the whole
pivot exists to carry. The specification's own contract text settles it: it is about REFUTATION, "where
an AST fact refutes a path claim, the AST WINS … the linter emits a parity-violation finding", not about
DERIVATION.

A field that an oracle can refute is the *most* useful kind of declared field. A field an oracle can
generate is a second copy of a truth that already exists, and a second copy with no parity gate is a
divergence waiting to happen.

## The forbidden set

`FORBIDDEN_DERIVABLE` is a closed, exported `ReadonlySet<string>`. The gate checks the **normalized**
name, where `NORMALIZE(name)` lowercases and maps `-` and space to `_`, so `Exports`, `EXPORTS`,
`line-count` and `line count` all land in the set.

```
exports imports dependencies dependency deps requires provides uses calls call_edges callers
callees references symbols symbol signature signatures type_signature types errors error_types
effects service services s is_service layer layers has_layer provides_layer rpc handler workflow
migration language lang languages extension ext filetype file_type loc lines line_count sloc size
bytes complexity cyclomatic cognitive coverage covered tested test_count hash sha sha256 checksum
fingerprint mtime modified created authors author committers git_author git_history blame path
filename basename dirname directory package module namespace context bc
```

### Two entries carry their own reasoning

**`layer` is forbidden while `l` is legitimate.** In this estate `layer` already names an AST-derivable
Effect Layer: an extractor emits `kind: 'service' | 'layer'` from the source. The DDD layer takes the key
`l` precisely to avoid overloading a vocabulary an extractor already owns. Two different meanings behind
one key is how a parity gate ends up comparing incomparable things and reporting green.

**`context` and `bc` are forbidden because the bounded context lives in the PATH.** Carrying it in front
matter as well would be two copies of one truth with no parity gate — the exact defect the one-truth-one-copy
rule exists to prevent. `bc` is listed alongside `context` because an abbreviation is the obvious way
around a ban on the long form.

## The gate is armed, not vacuous

`assertRegistryDerivability(registry)` returns the offending field names for **any** registry handed to
it, not just the shipped one. That signature is deliberate: a gate that has only ever been run against a
registry it passes is a gate nobody has seen reject. The obligations on its test suite are:

1. the real registry produces zero offenders;
2. a synthetic registry carrying a field named `exports` is REJECTED;
3. `Exports`, `EXPORTS`, `line-count` and `line count` are each rejected, through `normalizeFieldName`;
4. the forbidden set contains every derivable kind the specification actually names: `language`,
   `exports`, `imports`, `loc`, `coverage`, `service`;
5. **PARITY** — the registry's key list EXACTLY equals the schema struct's field list, with the schema
   keys derived programmatically (`Object.keys(FrontMatterSchema.fields)`), never restated. Without this
   a future author adds a field to the schema, skips the registry, and the gate never sees it;
6. every registry entry's justification is a non-empty string of at least `MINIMUM_JUSTIFICATION_LENGTH`
   (40) characters.

Obligation 5 is the load-bearing one. `src/registry.ts` and `src/schema.ts` deliberately do not import
each other, so their agreement is a fact a test can check rather than a fact a shared constant asserts.
