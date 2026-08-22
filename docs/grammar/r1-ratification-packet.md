# R1 ratification packet — the path grammar

This is the operator gate for milestone R1. R1 gates the entire migration line, so everything below
is a claim that becomes expensive to reverse once a fact is persisted against it.

Read alongside `./README.md`, which is the normative reference. This packet is the decision surface:
what is being ratified, what is genuinely uncertain, and what deviates from the brief that produced
it.

---

## A. The closed kind sets

Additive-only. Append, never rename, never remove — a content-addressed, commit-keyed fact store
references these names, so a rename orphans persisted facts with nothing to detect it. **The member
lists are pinned by test before any fact is persisted.** That is the whole mitigation for the one
one-way door this design cannot close.

### Path segment kinds — the closed structural set

```
StructuralKind = { bc, lang, t }
```

Three. That is the entire path vocabulary.

- **`bc_<name>`** — the bounded context. Coarse, stable, renamed roughly never.
- **`lang_<language>`** — the language root. The unit of adoption, and the key of the shell table.
- **`t_<kind>`** — a test tree, where the platform does not mandate one.

### Kinds retired from the path, and refused loudly

```
SupersededKind = { l, p, s, tag }
```

A path carrying one is `Malformed { superseded_kind }`, and the parser names the destination.

| Retired | Now lives in | Why it is refused rather than ignored |
|---|---|---|
| `l_<layer>` | front matter, field `l` | leniency would parse `l_domain` as an ordinary directory and drop the layer on the floor silently |
| `p_<pattern>` | front matter, field `p` | same |
| `s_<name>` | an AST fact; declared nowhere | same, plus it has no legal position — see decision D1 |
| `tag_<k>_<v>` | front matter, field `tags` | same |

### The shared vocabulary sets

These are **not** path vocabulary. They ship from this package because front matter, a linter and a
forest renderer must all reference the same literals, and two copies of a closed set with no parity
gate is the exact defect class this estate legislates against.

| Set | Members | Count |
|---|---|---|
| `Language` | `typescript` `rust` `swift` `kotlin` `elixir` `brightscript` | 6 |
| `Subdomain` | `core` `supporting` `generic` | 3 |
| `DddLayer` | `domain` `application` `infrastructure` `interface` `unlayered` | 5 |
| `TacticalPattern` | 14 inherited + `port` `adapter` `test_double` `barrel` + `unassigned` | 19 |
| `TestKind` | `unit` `integration` `e2e` `support` `fixture` `unassigned` | 6 |
| `Provenance` | `path_grammar` `ast_fact` `heuristic` `unassigned` | 4 |
| `AnchorKind` | 8 generic + `crate_root` + 5 per-platform manifests | 14 |
| `OutsideKind` | `build_plane` `ci_config` `agent_state` `installed_dependency` `build_output` `vendored` | 6 |
| `UngradedReason` | `no_grammar_tokens` `no_language_root` | 2 |
| `MalformedReason` | listed in the reference §2 | 14 |
| `HierarchyRole` | `root` `project` `context` `file` `symbol` `package_instance` | 6 |
| `RelationshipPattern` | the 8 strategic patterns — **vocabulary only**, never path-encoded | 8 |

---

## B. The declared shell table

**A constant shell table is refuted by the real corpus.** Shells are declared per repository in
`grammar.toml`, keyed by language, and resolved through Effect Schema over parsed TOML.

The evidence, measured rather than assumed:

- `project-xavier` @ `444244199` — Kotlin lives under **four** Gradle flavor source sets
  (`main`, `xavierDebug`, `xavierRelease`, `testXavierDebug`), in a `java/` directory holding
  Kotlin, under an org package path `com/angel/xavier`. All declared in `build.gradle.kts`, none of
  it derivable from a constant.
- `harvest/kmp` @ `1e7d64f` — **fifteen Kotlin Multiplatform source sets** beside two plain Gradle
  ones: `commonMain` `commonTest` `androidMain` `androidHostTest` `iosMain` `iosTest` `iosArm64Main`
  `iosSimulatorArm64Main` `jsMain` `jsTest` `jvmMain` `jvmTest` `wasmJsMain` `wasmJsTest` `webMain`.
  All fifteen resolve, and the count itself is asserted so a silently-dropped entry reddens.

Four matcher forms, a closed set:

| Form | Consumes | Corpus that forced it |
|---|---|---|
| `{ literal = "src" }` | that exact segment | every language |
| `{ any_of = [...] }` | one segment from the declared set | the 15 KMP + 4 Gradle flavor source sets |
| `{ optional_run = [...] }` | the whole run, or nothing | `day/harvest` present in most harvest modules, **absent** in `build-logic/src/test/kotlin/DomainBoundaryGuardTest.kt` |
| `{ context = true, suffix }` | the enclosing context name plus a suffix | SwiftPM's target-named directory |

`optional_run` is all-or-nothing, never a partial prefix, because a partial match would be ambiguous.

**Shell resolution is re-armable**: the cursor arms on `lang_`, then attempts each declared run at
every subsequent position, first full-run match wins, at most one run consumed per path. That is what
lets the language root sit outside the context segment — the order-independence requirement — without
changing the result.

**A declared shell is not a per-language exception.** It records where a *platform* mandates its own
root. The grammar's form is identical above and below every shell; the table declares *where* the
grammar ends, never *how* anything is spelled.

**A grammar token found below a consumed shell is `Malformed { token_below_shell }`**, which is what
keeps a grammar token from ever becoming a Rust `mod` component, a Kotlin package segment, an Elixir
module component or a Swift target path. A *superseded* kind found there reports `superseded_kind`
instead — the retired kind is the more actionable diagnostic wherever it sits.

**Two ways this guard could be switched off are closed, and both were found by review rather than by
design.** A `grammar.toml` could have declared the retired directories as shell literals, turning every
one of them into a platform fact; a shell run may therefore not declare a segment whose prefix is a
structural or superseded kind, refused at decode time. And an ordinary directory name could have
suppressed the refusal, because `Outside` and `Anchor` terminate before `Malformed`; `superseded_kind`
therefore outranks both. A guard a configuration file or a directory name can switch off is not a guard.

---

## C. The tag form and its inheritance rule

Tags are **not in paths**. The form ships here so that front matter and every future tag consumer
agree on one spelling.

```
tagToken := [a-z0-9]+ ( '_' [a-z0-9]+ )*
```

Split on the **first** underscore — head is the key, tail is the value. No underscore at all is a
**bare** tag. `owner_platform_team` is `owner = platform_team`; `pii` is bare. Keys are single
tokens, values may be multi-word: keys are a small controlled vocabulary in practice, values are
free.

**Open versus closed is structural, not a lookup.** A kind drawn from the closed `StructuralKind`
set must take a value from that kind's closed literal set — an unknown one is a loud error. A tag
key, value or bare name is unconstrained and an unknown one parses silently. The *position* decides,
not a table. That asymmetry is reused by the front-matter schema rather than rebuilt there.

**Inheritance rule:**

```
tags(node) = ⋃ { tags(ancestor) : ancestor ∈ chain(node) } ∪ tags(node)
```

A set union, so the result is **order-independent by construction**. On a key collision the
**deepest** occurrence wins — override semantics — and the linter emits an INFO finding
`tag-shadowed` naming both sites. Bare tags never collide.

**One reserved key.** `subdomain` is the single tag key whose value is schema-checked, against the
closed `Subdomain` set. It is declared reserved rather than special-cased in a parser.

**The check is shipped rather than merely declared, and an earlier draft of this packet claimed it
before it existed.** `validateTagToken` and `decodeTagSet` apply the token form to key and value and
schema-check a `subdomain` key against `Subdomain`, returning a typed failure; `parseTagToken` and
`tagSetOf` remain the total permissive primitives. Until that landed, `TAG_TOKEN` and
`RESERVED_TAG_KEYS` were exported constants nothing consulted — a declaration reported as a verdict,
which is precisely the readiness anti-pattern this estate legislates against, and which this packet
would have carried into an operator ratification.

**A collision inside one node's own tag list is reported too**, by `decodeTagSet` before the collapse
into a set destroys the losing occurrence. That case is the likeliest one in practice, and
`shadowedKeys` — which sees only already-collapsed values — structurally cannot reach it.

---

## D. Honest terminals, and the six-file abstention floor

The vocabulary carries explicit honest terminals — `unassigned`, `unlayered`, and a provenance of
`unassigned` — and uses them. **A classification that guesses is worse than one that abstains.**

**Test kind abstains rather than guesses.** A declared `test` run with no `test_kind` yields
`Test { kind: 'unassigned' }`. The previous behaviour silently defaulted to `unit`, which graded Cargo
integration tests as unit tests and was indistinguishable in the output from a declared value — the one
field in the whole classification that could be an unmarked guess.

**`Ungraded` is not `Malformed`.** An unmigrated path is `Ungraded`: typed, honest, green. It says
*this subtree has not adopted*, never *this is broken*, and never a guess. Only `Malformed` may fail
a gate. Conflating the two would make every unmigrated file a lint failure — a flag day, which is the
thing this design exists to avoid.

**No gate may be armed on the abstention count.** It may be reported. Making it block creates exactly
the pressure to invent a classification that the terminals exist to relieve.

### The floor is six of twenty-four, and it is not to be engineered down

Across the twenty-four source files in `effect-bun-tooling` @ `4d431c6`, restricted to the fourteen
inherited tactical literals, around nineteen honestly abstain — the only candidate for them is
`module`, a positive claim they do not earn. The four appended literals convert fifteen of those
nineteen into honest terms. **Six still abstain, and that is the correct output:**

| File | Why no term applies |
|---|---|
| `packages/bun-svelte-test/src/checked-pseudo.ts` | monkey-patches happy-dom internals; a patch is not an adapter |
| `packages/effect-bun-test/src/utils.ts` | twenty wrappers over `node:assert` |
| `packages/bun-svelte-test/src/mount.ts` | twenty-six lines of call-through around svelte's `mount`/`unmount` |
| `packages/fixture-residue/src/sweep.ts` | spans four layers in one 180-line file |
| `packages/effect-test-kit/src/tagged.ts` | pure functions over `Cause`/`Exit`/`Result`/`Option`; nothing to layer |
| `packages/effect-bun-test/src/fixture-root-suite.ts` | a suite wrapper |

All six paths were verified to exist. **Do not append a literal to drive that number down.**
`p_patch`, `p_wrapper`, `p_constants` would each be a literal minted to avoid saying "I don't know",
and additive-only makes that permanent. An append is justified only when it describes a real
recurring structure.

**The limitation this exposes:** classification grades *files*. A path grammar is only as
fine-grained as the file decomposition — a file spanning layers is graded at its lowest-privilege
layer, and reports a coarser truth than the code contains. Splitting `sweep.ts` is the single
highest-value follow-up, and it is a rewrite, explicitly outside a move-only migration.

---

## E. The FALSIFIABLE / UNFALSIFIABLE split — the chunk's load-bearing output

It does double duty: it is the parity gate's input (what an AST may contradict) **and** the
front-matter derivability gate's input (what front matter may not carry).

**Keyed on HOME, not on falsifiability.** Three homes, two falsifiability values — falsifiability alone
cannot decide the question, and stating the rule over it admits `bc` into front matter, since a bounded
context is UNFALSIFIABLE yet belongs in the path. An unknown kind is UNMARKED and must be reported as
such, never silently permitted.

```
home = 'front_matter'  => LEGITIMATE in front matter
home = 'ast_fact'      => FORBIDDEN  — an AST computes it
home = 'path'          => FORBIDDEN  — declared, but the path is where it is declared
not in the table       => UNMARKED   — no decision recorded; a gate must say so
```

Falsifiability keeps a different job: it tells the PARITY gate what an AST may contradict.

### Path kinds

| Kind | Marking | Oracle, or why none exists |
|---|---|---|
| `bc` | **UNFALSIFIABLE** | a context boundary is a human decision; nothing in the code says where one ends |
| `lang` | **FALSIFIABLE** | file extensions below the root contradict the declared language |
| `t` | **UNFALSIFIABLE** | no oracle computes a test KIND; `unit`/`integration`/`e2e` is intent. Partially refuted for those three by a tree with no test registration call; `t_support` and `t_fixture` carry no refutation at all |

`lang_` is falsifiable and still lives in the path. Not a contradiction: the segment declares
**adoption scope**, and the derived `language` *fact* is what may refute it. They are separate
entries for exactly that reason.

### Front-matter kinds — all UNFALSIFIABLE, all legitimate

`l` (DDD layer), `p` (tactical pattern), `subdomain`, `tags`, `owner`, `oncall`,
`data_classification`, `tier`, `criticality`, `deprecation`, `external_links`, `review_status`.

Three kinds carry a **partial refutation** the parity gate consumes without becoming falsifiable — `l`,
`p`, and `t` from the path table above:

- `l` — a module declaring `domain` while importing `node:*`, `bun:*`, or a non-`effect`
  third-party runtime.
- `p` — per-value, and **only for the four structural literals**: `barrel` refuted by any
  non-re-export declaration; `port` by an exported runtime binding that is neither a
  `Context.Service`/`Tag` declaration nor a `Schema` — an implementation living in the port module,
  never the port itself, because an Effect port IS the Tag, so "any exported runtime binding" would
  refute every Effect port that can exist, this packet's own worked example included;
  `adapter` by importing nothing external; `test_double` by exporting no `Layer` and no stand-in. Every other `TacticalPattern`
  literal is modelling intent with no refuting oracle. Weak signals exist; refutation does not.

### AST-fact kinds — FALSIFIABLE, forbidden in front matter

`exports`, `imports`, `dependencies`, `effect_service`, `effect_layer`, `loc`, `language`,
`complexity`, `coverage`, `type_signatures`, `error_types`, `call_edges`, `service_unit`.

### The contract

Where an AST fact refutes a declaration, **the AST wins**, that field's provenance becomes
`ast_fact`, and the linter emits a `parity-violation` finding naming both sites. The declaration is
never silently corrected: a declaration that disagrees with reality is a finding, not a fixup.

Where a kind is UNFALSIFIABLE the linter must never emit a finding against it on AST grounds, because
it has no ground to stand on. Only structural and relational checks are available there.

---

## F. Decisions this packet asks the operator to ratify

Each of these is a call made rather than deferred, with the reasoning and the cost of being wrong.

### D1 — `s_` is deleted from the path grammar

**The brief named three retirements (`l_`, `p_`, `tag_`). This is a fourth.** It is not a preference;
it is forced, and the derivation is short:

1. A ratified decision puts grammar segments **only above a language shell**, so that no grammar
   token is ever a Rust `mod` component, a Kotlin package segment, an Elixir module component or a
   Swift target path. That constraint exists because a reclassification would otherwise be a
   breaking API change in four languages.
2. Everything above the shell is **language-agnostic by construction** — the shell table is keyed on
   `lang_`, so the region above it is the region where no language has been named yet. An Effect
   service unit is inherently language-specific.
3. Therefore `s_` has no legal position: below the shell it is forbidden by (1), and above it, it would
   put a language-specific concept in the language-agnostic region.

**An earlier draft of this derivation said instead "a service unit groups source files, which live below
the shell", and that step was asserted rather than derived.** Nothing in the grammar forces a service
unit below a shell — `bc_x/s_tokens/lang_typescript/src/tag.ts` places one above, violating no stated
rule, and this packet's own polyglot example puts multiple shells under one context, so an above-shell
grouping node is structurally available. The step was a description of where service units happen to sit
in this estate, promoted to a premise. The language-agnosticism argument above is the real one, and the
conclusion is unchanged.

It needs none. An Effect service unit is fully computable from the AST — a `Context.Service` or `Tag`
declaration with a `Layer` provided for it — so it is an extracted fact, and by the derivability rule
a computable fact is forbidden from front matter too. `s_` is retained in `SupersededKind` so a
pre-pivot path is refused loudly with its destination named.

**Cost if wrong: low UNTIL THE FIRST FACT IS PERSISTED, and not low afterwards.** Restoring `s_` is an
append to `StructuralKind` — cheap — but also a **removal from `SupersededKind`**, which is the operation
§A of this packet forbids outright. That is not a formality: `SupersededKind` drives
`Malformed { superseded_kind }`, so once any path carrying `s_` has been classified and written to the
content-addressed store, restoring `s_` reclassifies persisted facts — the exact orphaning §A calls the
one one-way door this design cannot close. Ratifying R1 is what ends the window in which this is cheap,
so an operator should read the cost as: reversible today, a one-way door tomorrow.

### D2 — `subdomain` moved from the path to front matter

**The brief said subdomain became a tag on `bc_` rather than a positional suffix. It is a tag; this
decision is about where the tag lives.** The earlier form was an inline suffix,
`bc_uuid_effect__subdomain_generic`.

Under that form, reclassifying a context from `supporting` to `core` renames the context root — which
**moves every file in the context**, the single most expensive move available in the tree. That is
precisely the move cost the front-matter split exists to eliminate, incurred at maximum blast radius,
for the one property least likely to be got right on the first pass. Strategic classification is
exactly the judgment that gets revised.

Consequences, all simplifications: the `missing_subdomain_tag` malformed reason disappears; the
"exactly one schema-checked tag key, special-cased in the parser" carve-out disappears; and `__` in a
path segment becomes a loud `tag_suffix_in_path` error rather than a silently-mangled context name.

**Cost if wrong:** low. Nothing downstream reads subdomain from a path yet. The cross-context rule
that keys on a target's subdomain reads it from front matter instead, at the same cost.

### D3 — the reserved-word floor applies to the whole value, not to each component

`bc_match` is refused; `bc_match_engine` is legal.

The ratified wording ("no reserved word as any segment or as any value component") admits a stricter
reading. The stricter reading is rejected on evidence: `mod match_engine` is legal Rust,
`package a.match_engine` is legal Kotlin, and **no language anywhere breaks on a compound name
containing a keyword as a component**. It would refuse plausible names to prevent a failure mode that
does not exist. Both behaviours are pinned by test, so the decision is visible rather than buried.

### D4 — `gen` IS in the reserved set, and the reasoning that first excluded it was inverted

The ratified floor predates Rust's 2024 edition and omits `gen`. The first call was to leave it out,
on the ground that widening a refusal set makes a currently-legal name illegal. **That is backwards
here.** `mod gen` does not compile in Rust 2024, so excluding it ships a grammar that will happily mint
`bc_gen` — a name illegal in the very language whose constraints are the floor. Adding it now costs
nothing: no fact is persisted and no name in either corpus collides. Not adding it ships a known defect
and makes the eventual fix a widening AFTER facts exist, which is the expensive moment. The set is 52
words. `union`, `raw`, `safe` and `macro_rules` remain absent and correctly so — weak or contextual
keywords, not reserved.

### D5 — Swift is designed-for; its shell is unvalidated by corpus

Be precise in both directions, because both an over-claim and an under-claim are wrong here.

- `project-xavier` @ `444244199` contains **zero** `.swift` files.
- `harvest/kmp` @ `1e7d64f` contains **exactly two**, both in an Xcode iOS app target.
- **An Xcode app target is not a SwiftPM package.** The declared Swift shell `Sources/<Target>/`
  therefore has **no instance anywhere in either corpus**. It is validated only by a synthetic
  `swift build`.
- What *is* corpus-validated is Swift path legality against those two real files, and nothing more.

**Swift's shell is designed-for and unvalidated-by-corpus.** Proving the Swift carrier against those
two files belongs to the later migration chunk, not to this one.

### D6 — C and C++ are out of scope, with evidence

All 151 `.h`/`.cpp` files in `project-xavier` are vendored third-party SDKs — Axera under
`packages/napi-axcl-venc/vendor/include/`, the NVIDIA Video Codec SDK samples under
`tools/nvenc-lab/sdk/`. Not one is first-party. They classify `Outside { vendored }`, a named
terminal rather than a gap.

**`lang_c` and `lang_cpp` are deliberately not minted.** A literal in a closed additive-only set is
permanent, and minting one for code nobody in either corpus writes is a cost with no counterparty. If
first-party C ever appears, `lang_c` is a free append.

### D7 — one clarification to a ratified rule, made explicit rather than worked around

The ratified derivability rule reads `FALSIFIABLE => derivable => forbidden in front matter`. That
phrasing conflates two properties, and taken literally it contradicts the same rule's own list of
legitimate front matter: the mechanical layer test can refute `l = "domain"` on a module importing
`node:fs`, which would mark layer falsifiable and therefore forbid the very field the rule names as
legitimate.

**Resolution, grounded in that rule's own legitimate list: the marking is per FIELD and keyed on
derivability, not on refutability.** A field an AST can only partially refute stays UNFALSIFIABLE and
legitimate, and carries a separate `partialRefutation` oracle the parity gate consumes. A field is
never marked falsifiable because *some* of its values can be contradicted. This preserves the
original insight about the four structural pattern literals without breaking the gate that consumes
the marking.

### D8 — the unit of atomic adoption is a package, not a segment, and the cost is 49%

§6 of the reference calls one `lang_<language>` root the smallest independently-adoptable unit. That is
true of the *rule scope* and it was measured to be misleading about the *work*.

The TypeScript shell declares no test run, so a TypeScript test tree must be a minted `t_` segment.
Dropping `lang_typescript` into a package therefore does not stand alone: without simultaneously
renaming `__tests__/` to `t_unit/` and relocating anything else sitting beside `src/`, every file
outside the shell is `Malformed { file_outside_shell }`. Measured against this repository's own
`packages/**`, a bare `lang_` insertion yields **76 reds out of 156 files, 49%**, every `__tests__/**`
file among them; `docs/**` and `scripts/**` would join them. Minting the test tree in the same step
takes it to **zero** `Malformed` over a 114-file denominator — which is what makes this a cost to plan
for rather than a defect to fix. (The figure was 47% of 151 when first measured; this chunk's own test
files enlarged the denominator, and the corpus sweep re-measures it rather than quoting a stale
number.)

The honest unit is **one `lang_` root plus every sibling of its shell inside it**, migrated together.
That is still nothing like a flag day — one package at a time, every other package untouched and green
— but it is package-granular, not segment-granular, and an operator should ratify the measured figure
rather than the smaller-sounding claim.

---

## F2. What independent review changed, and what it says about the evidence

An Engineering Critic reviewed this chunk before ratification and returned four Critical findings, all
upheld and all fixed. Two of them matter to how the remaining claims should be read.

**The two most serious defects were invisible to reading and to a twelve-path exemplar suite, and both
fell out of a single sweep over 11,071 real paths.** `reserved_basename` was unscoped, reddening
thirteen real unmigrated paths including a first-party script — a direct violation of the
partial-adoption guarantee this design is built on. And `build`, `target` and `coverage` in the outside
table swallowed twenty-one first-party source files, which is worse than reddening them: they were
absent from the map with no terminal in play and nothing to notice.

Hand-picked exemplars prove the cases their author already thought of. A corpus sweep with a
denominator floor now runs over this repository's own tree and asserts the properties — zero
`Malformed` on an unadopted tree, no first-party source classified `Outside` — rather than sampling
them. **That sweep, not the exemplars, is the evidence behind requirement (4).**

**The derivability gate's rule was wrong in this document, not merely in the code.** It was stated over
falsifiability when there are three homes, which admits `bc` into front matter, and the predicate
returned "permitted" for any kind not in the table. The code implemented the document faithfully — which
made it worse, because the sibling front-matter chunk would have reimplemented the same wrong rule
independently rather than inheriting a fix. §E now states the rule over the three homes and the gate
fails closed.

---

## G. What was NOT built, and must not be claimed

- **No lint gate, no migration, no consumer change.** This chunk is additive only.
- **Strategic relationships are not path-encodable and no attempt was made.** A path is a tree; a
  context relationship is an edge. The `RelationshipPattern` set ships as vocabulary only.
- **The linter does not exist.** The parser never fails, it classifies. Judgment is a later chunk.
- **No repository has been migrated.** Every "migrated" path in the reference is the grammar's
  *output* for a real input path, not a path that exists on disk.
- **The `Sources/<Target>/` Swift shell has no corpus instance.** See D5.
