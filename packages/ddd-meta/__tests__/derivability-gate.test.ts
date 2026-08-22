import { describe, expect, it } from 'bun:test';
import {
  assertRegistryDerivability,
  DERIVABILITY_RULE,
  FIELD_REGISTRY,
  FORBIDDEN_DERIVABLE,
  FORBIDDEN_DERIVABLE_NAMES,
  FORBIDDEN_DERIVABLE_NOTES,
  isForbiddenDerivable,
  MINIMUM_JUSTIFICATION_LENGTH,
  normalizeFieldName,
  REGISTRY_KEYS,
  type RegistryEntry,
  registryEntryOf,
  TOML_TYPES,
} from '../src/registry.ts';
import { FRONT_MATTER_FIELD_KEYS, FrontMatterSchema } from '../src/schema.ts';

const SPEC_DERIVABLE_KINDS: readonly string[] = [
  'language',
  'exports',
  'imports',
  'loc',
  'coverage',
  'service',
];

const ALIASES_OF_A_FORBIDDEN_NAME: readonly string[] = ['Exports', 'EXPORTS', 'line-count', 'line count'];

const syntheticEntry = (key: string): RegistryEntry => ({
  key,
  tomlType: 'string',
  justification: 'A synthetic entry authored solely to prove the gate rejects rather than to be adopted.',
});

const registryKeysDerivedFromRegistry: readonly string[] = FIELD_REGISTRY.map((entry) => entry.key);

const schemaKeysDerivedFromSchema: readonly string[] = Object.keys(FrontMatterSchema.fields);

const sortedCopy = (values: readonly string[]): readonly string[] => [...values].sort();

describe('(a) the real registry produces zero offenders, over a non-empty input', () => {
  it('finds no forbidden derivable name among the shipped fields', () => {
    expect(assertRegistryDerivability(FIELD_REGISTRY)).toEqual([]);
  });

  it('runs that check over a registry that is actually populated, so the clean scan means something', () => {
    expect(FIELD_REGISTRY.length).toBeGreaterThan(0);
    expect(registryKeysDerivedFromRegistry.length).toBe(FIELD_REGISTRY.length);
    expect(new Set(registryKeysDerivedFromRegistry).size).toBe(FIELD_REGISTRY.length);
  });

  it('finds no forbidden derivable name among the schema field keys either', () => {
    expect(FRONT_MATTER_FIELD_KEYS.filter(isForbiddenDerivable)).toEqual([]);
  });
});

describe('(b) the gate is armed: the same function rejects a synthetic offender', () => {
  it('rejects a registry carrying a field named exports', () => {
    expect(assertRegistryDerivability([syntheticEntry('exports')])).toEqual(['exports']);
  });

  it('reports only the offending keys when legitimate fields sit beside a forbidden one', () => {
    const mixed = [...FIELD_REGISTRY, syntheticEntry('coverage'), syntheticEntry('layer')];
    expect(assertRegistryDerivability(mixed)).toEqual(['coverage', 'layer']);
  });

  it('rejects the key the estate deliberately reserved, while keeping the key it renamed to', () => {
    expect(isForbiddenDerivable('layer')).toBe(true);
    expect(isForbiddenDerivable('l')).toBe(false);
    expect(REGISTRY_KEYS).toContain('l');
    expect(REGISTRY_KEYS).not.toContain('layer');
  });
});

describe('(c) aliases normalise into the forbidden set rather than slipping past it', () => {
  for (const alias of ALIASES_OF_A_FORBIDDEN_NAME) {
    it(`rejects ${JSON.stringify(alias)} through the gate, not merely through the predicate`, () => {
      expect(isForbiddenDerivable(alias)).toBe(true);
      expect(assertRegistryDerivability([syntheticEntry(alias)])).toEqual([alias]);
    });
  }

  it('normalises case, hyphen and space and nothing else', () => {
    expect(normalizeFieldName('Line-Count')).toBe('line_count');
    expect(normalizeFieldName('line count')).toBe('line_count');
    expect(normalizeFieldName('LINE_COUNT')).toBe('line_count');
    expect(normalizeFieldName('line.count')).toBe('line.count');
  });
});

describe('(d) the forbidden set names every derivable kind the specification lists', () => {
  for (const kind of SPEC_DERIVABLE_KINDS) {
    it(`forbids ${kind}`, () => {
      expect(FORBIDDEN_DERIVABLE.has(kind)).toBe(true);
      expect(isForbiddenDerivable(kind)).toBe(true);
    });
  }

  it('keeps the exported set and the exported name list as one truth', () => {
    expect(sortedCopy([...FORBIDDEN_DERIVABLE])).toEqual(sortedCopy(FORBIDDEN_DERIVABLE_NAMES));
    expect(FORBIDDEN_DERIVABLE.size).toBe(new Set(FORBIDDEN_DERIVABLE_NAMES).size);
  });

  it('writes down why the two collision cases are forbidden at all', () => {
    for (const key of Object.keys(FORBIDDEN_DERIVABLE_NOTES)) {
      expect(FORBIDDEN_DERIVABLE.has(key)).toBe(true);
      expect(FORBIDDEN_DERIVABLE_NOTES[key].length).toBeGreaterThan(MINIMUM_JUSTIFICATION_LENGTH);
    }
    expect(sortedCopy(Object.keys(FORBIDDEN_DERIVABLE_NOTES))).toEqual(['bc', 'context', 'layer']);
  });

  it('states the governing rule as data rather than as a comment', () => {
    expect(DERIVABILITY_RULE).toContain('DERIVABLE');
    expect(DERIVABILITY_RULE).toContain('REFUTABLE');
    expect(DERIVABILITY_RULE.length).toBeGreaterThan(MINIMUM_JUSTIFICATION_LENGTH);
  });
});

describe('(e) parity: the registry key list and the schema field list are one closed set', () => {
  it('agrees on membership, with each side read from its own module', () => {
    expect(sortedCopy(registryKeysDerivedFromRegistry)).toEqual(sortedCopy(schemaKeysDerivedFromSchema));
  });

  it('agrees on order, which is what the writer relies on for a canonical payload', () => {
    expect(registryKeysDerivedFromRegistry).toEqual(schemaKeysDerivedFromSchema);
  });

  it('agrees on size, so neither side can carry a field the other has never seen', () => {
    expect(registryKeysDerivedFromRegistry.length).toBe(schemaKeysDerivedFromSchema.length);
  });

  it('keeps the two exported convenience lists derived rather than restated', () => {
    expect(REGISTRY_KEYS).toEqual(registryKeysDerivedFromRegistry);
    expect(FRONT_MATTER_FIELD_KEYS).toEqual(schemaKeysDerivedFromSchema);
  });
});

describe('(f) every registry entry carries a written justification', () => {
  for (const entry of FIELD_REGISTRY) {
    it(`justifies ${entry.key} in at least ${MINIMUM_JUSTIFICATION_LENGTH} characters`, () => {
      expect(entry.justification.trim().length).toBeGreaterThanOrEqual(MINIMUM_JUSTIFICATION_LENGTH);
      expect(entry.justification.trim()).not.toBe('');
    });
  }

  it('declares a TOML type drawn from the closed list for every entry', () => {
    expect(TOML_TYPES).toEqual(['string', 'string[]', 'table']);
    for (const entry of FIELD_REGISTRY) expect(TOML_TYPES).toContain(entry.tomlType);
  });

  it('looks an entry up by key, and reports an unknown key as absent rather than as empty', () => {
    for (const entry of FIELD_REGISTRY) expect(registryEntryOf(entry.key)).toEqual(entry);
    expect(registryEntryOf('exports')).toBeUndefined();
  });
});
