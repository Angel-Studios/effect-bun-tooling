import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { rootCatalog, workspacePackages } from '../workspace';

const CATALOG_SPECIFIER = 'catalog:';

describe('catalog', () => {
  const catalog = rootCatalog();

  it('declares at least one catalog entry', () => {
    expect(Object.keys(catalog).length).toBeGreaterThan(0);
  });

  it('pins every catalog entry to an exact version', () => {
    for (const [name, version] of Object.entries(catalog)) {
      expect({ name, exact: /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version) }).toEqual({
        name,
        exact: true,
      });
    }
  });

  it('resolves every `catalog:` specifier a workspace package declares', () => {
    for (const pkg of workspacePackages()) {
      const manifest = JSON.parse(readFileSync(pkg.manifestPath, 'utf8')) as Readonly<
        Record<string, unknown>
      >;
      for (const field of ['dependencies', 'devDependencies', 'peerDependencies'] as const) {
        const deps = manifest[field];
        if (typeof deps !== 'object' || deps === null) continue;
        for (const [name, specifier] of Object.entries(deps as Record<string, string>)) {
          if (specifier !== CATALOG_SPECIFIER) continue;
          expect({ pkg: pkg.manifest.name, field, name, cataloged: name in catalog }).toEqual({
            pkg: pkg.manifest.name,
            field,
            name,
            cataloged: true,
          });
        }
      }
    }
  });
});
