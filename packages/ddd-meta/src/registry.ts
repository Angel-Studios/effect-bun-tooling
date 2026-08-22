export const DERIVABILITY_RULE = `The gate forbids DERIVABLE, not REFUTABLE.

DERIVABLE = an AST or an extractor can PRODUCE the value from the code alone. FORBIDDEN.
REFUTABLE = an oracle can CONTRADICT a specific claim but cannot GENERATE it. LEGITIMATE,
            and it is precisely what feeds the parity gate: the path declares, the AST verifies.

Under this rule language, exports, imports, loc, coverage and service are FORBIDDEN, because an
extractor emits them. l, p, subdomain, owner, tier, data, deprecated, links, review and oncall are
LEGITIMATE, because no AST can refute them. l and p are refutable-but-not-derivable, which is the
interesting middle and the reason the parity gate has anything to check: where an AST fact refutes
a path claim the AST WINS and the linter emits a parity-violation finding, but no AST ever mints
the claim in the first place.`;

export const TOML_TYPES = ['string', 'string[]', 'table'] as const;

export type TomlType = (typeof TOML_TYPES)[number];

export type RegistryEntry = {
  readonly key: string;
  readonly tomlType: TomlType;
  readonly justification: string;
};

export const MINIMUM_JUSTIFICATION_LENGTH = 40;

export const FIELD_REGISTRY: readonly RegistryEntry[] = [
  {
    key: 'l',
    tomlType: 'string',
    justification:
      'DDD layer. Design intent. An oracle can REFUTE a specific claim, as when a file declared domain imports node: or bun:, but it cannot PRODUCE the layer: two runtime-free modules are domain or application by intent alone. Keyed l and not layer deliberately, because layer already names an AST-derivable Effect Layer.',
  },
  {
    key: 'p',
    tomlType: 'string',
    justification:
      'Tactical pattern. A class with an id field is not thereby an Entity; a struct is not thereby a Value Object. Weak signals exist; refutation does not. Pure DDD modelling intent.',
  },
  {
    key: 'subdomain',
    tomlType: 'string',
    justification:
      'Strategic judgment about what the business competes on. Nothing in the code states whether a context is core, supporting or generic.',
  },
  {
    key: 'tags',
    tomlType: 'string[]',
    justification:
      'Arbitrary declared metadata by design; no oracle exists unless a specific tag key ships its own. Canonically sorted and deduped, because k tags admit exactly one canonical spelling.',
  },
  {
    key: 'owner',
    tomlType: 'string',
    justification:
      'Organisational ownership. No code artifact records which team OWNS a file; VCS authorship records who TOUCHED it, which is a different claim.',
  },
  {
    key: 'tier',
    tomlType: 'string',
    justification:
      'Criticality or SLO band. A business decision about the consequence of failure, which no property of the source expresses.',
  },
  {
    key: 'data',
    tomlType: 'string[]',
    justification:
      'Data classification such as pii, pci or phi. A legal and regulatory judgment about what a value MEANS; a string field is not self-describing.',
  },
  {
    key: 'deprecated',
    tomlType: 'string',
    justification:
      'Intent to remove, plus a date. Nothing in the code states an INTENTION; a deprecation marker would itself be a declaration, not a derivation.',
  },
  {
    key: 'links',
    tomlType: 'table',
    justification:
      'Pointers to artifacts OUTSIDE the tree: an ADR, a ticket, a runbook, a dashboard. Not derivable by construction, because the referent is not in the corpus at all.',
  },
  {
    key: 'review',
    tomlType: 'string',
    justification:
      'A human attestation that someone looked, and when. An attestation cannot be derived from the thing attested.',
  },
  {
    key: 'oncall',
    tomlType: 'string',
    justification:
      'Routing target for a page. An organisational fact with no code representation anywhere in the tree.',
  },
];

export const REGISTRY_KEYS: readonly string[] = FIELD_REGISTRY.map((entry) => entry.key);

export const registryEntryOf = (key: string): RegistryEntry | undefined =>
  FIELD_REGISTRY.find((entry) => entry.key === key);

export const FORBIDDEN_DERIVABLE_NAMES: readonly string[] = [
  'exports',
  'imports',
  'dependencies',
  'dependency',
  'deps',
  'requires',
  'provides',
  'uses',
  'calls',
  'call_edges',
  'callers',
  'callees',
  'references',
  'symbols',
  'symbol',
  'signature',
  'signatures',
  'type_signature',
  'types',
  'errors',
  'error_types',
  'effects',
  'service',
  'services',
  's',
  'is_service',
  'layer',
  'layers',
  'has_layer',
  'provides_layer',
  'rpc',
  'handler',
  'workflow',
  'migration',
  'language',
  'lang',
  'languages',
  'extension',
  'ext',
  'filetype',
  'file_type',
  'loc',
  'lines',
  'line_count',
  'sloc',
  'size',
  'bytes',
  'complexity',
  'cyclomatic',
  'cognitive',
  'coverage',
  'covered',
  'tested',
  'test_count',
  'hash',
  'sha',
  'sha256',
  'checksum',
  'fingerprint',
  'mtime',
  'modified',
  'created',
  'authors',
  'author',
  'committers',
  'git_author',
  'git_history',
  'blame',
  'path',
  'filename',
  'basename',
  'dirname',
  'directory',
  'package',
  'module',
  'namespace',
  'context',
  'bc',
];

export const FORBIDDEN_DERIVABLE: ReadonlySet<string> = new Set(FORBIDDEN_DERIVABLE_NAMES);

export const FORBIDDEN_DERIVABLE_NOTES: Readonly<Record<string, string>> = {
  layer:
    'layer is forbidden while l is legitimate, because in this estate layer already names an AST-derivable Effect Layer: an extractor emits kind: service or layer. The DDD layer takes the key l precisely to avoid overloading a vocabulary an extractor already owns.',
  context:
    'context is forbidden because the bounded context lives in the PATH. Carrying it in front matter too would be two copies of one truth with no parity gate, which is the exact defect the one-truth-one-copy rule exists to prevent.',
  bc: 'bc is forbidden for the same reason as context: it is the abbreviation of a value the path already carries, and a second copy with no parity gate is a divergence waiting to happen.',
};

export const normalizeFieldName = (name: string): string => name.toLowerCase().replaceAll(/[-\s]/g, '_');

export const isForbiddenDerivable = (name: string): boolean =>
  FORBIDDEN_DERIVABLE.has(normalizeFieldName(name));

export const assertRegistryDerivability = (registry: readonly RegistryEntry[]): readonly string[] =>
  registry.filter((entry) => isForbiddenDerivable(entry.key)).map((entry) => entry.key);
