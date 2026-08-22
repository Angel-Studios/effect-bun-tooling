import { describe, expect, it } from 'bun:test';
import * as Result from 'effect/Result';
import { FIELD_REGISTRY, TOML_TYPES, type TomlType } from '../src/registry.ts';
import { decodeFrontMatter } from '../src/schema.ts';

const STRING_PROBES: readonly string[] = ['domain', '2026-01-31'];

const ARRAY_PROBE: readonly string[] = ['alpha', 'beta'];

const TABLE_PROBE: Readonly<Record<string, string>> = { adr: 'https://example.test/adr/1' };

const accepts = (key: string, probe: unknown): boolean =>
  Result.isSuccess(decodeFrontMatter({ [key]: probe }));

const observedTypesOf = (key: string): readonly TomlType[] => {
  const observed: TomlType[] = [];
  if (STRING_PROBES.some((probe) => accepts(key, probe))) observed.push('string');
  if (accepts(key, ARRAY_PROBE)) observed.push('string[]');
  if (accepts(key, TABLE_PROBE)) observed.push('table');
  return observed;
};

describe('the registry declares the TOML type the schema actually accepts', () => {
  for (const entry of FIELD_REGISTRY) {
    it(`accepts exactly ${entry.tomlType} for ${entry.key}, as the registry declares`, () => {
      expect(`${entry.key}: ${observedTypesOf(entry.key).join('+')}`).toBe(`${entry.key}: ${entry.tomlType}`);
    });
  }

  it('draws the probes from a fixed table, never from the field under test', () => {
    expect(TOML_TYPES).toEqual(['string', 'string[]', 'table']);
    expect(observedTypesOf('l')).toEqual(['string']);
    expect(observedTypesOf('tags')).toEqual(['string[]']);
    expect(observedTypesOf('links')).toEqual(['table']);
  });

  it('reports no accepted type for a key the schema does not declare', () => {
    expect(observedTypesOf('exports')).toEqual([]);
  });
});
