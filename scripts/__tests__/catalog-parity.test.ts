import { describe, expect, it } from 'bun:test';
import { pnpmCatalog, rootCatalog } from '../workspace';

describe('catalog parity', () => {
  const bun = rootCatalog();
  const pnpm = pnpmCatalog();

  it('declares at least one catalog entry', () => {
    expect(Object.keys(bun).length).toBeGreaterThan(0);
  });

  it('pins every bun catalog entry identically in the pnpm catalog', () => {
    for (const [name, version] of Object.entries(bun)) {
      expect({ name, version }).toEqual({ name, version: pnpm[name] });
    }
  });

  it('pins every pnpm catalog entry identically in the bun catalog', () => {
    for (const [name, version] of Object.entries(pnpm)) {
      expect({ name, version }).toEqual({ name, version: bun[name] });
    }
  });

  it('pins every catalog entry to an exact version', () => {
    for (const [name, version] of Object.entries(bun)) {
      expect({ name, exact: /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version) }).toEqual({
        name,
        exact: true,
      });
    }
  });
});
