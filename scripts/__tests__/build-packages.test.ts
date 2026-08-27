import { describe, expect, it } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildOrder, externalsOf, withBuiltinPrefixes } from '../build-packages';
import { makeFixtureRoot } from '../fixture-root';
import {
  distSubpathCarriesLeaf,
  distSubpathOfJsTarget,
  distSubpathOfTypesTarget,
  EXPORT_ROOT_BASENAME,
  exportSubpathLeaf,
  publishablePackages,
  sourceEntrypoints,
  sourceOfDistTarget,
  workspaceSiblingsOf,
} from '../workspace';

describe('withBuiltinPrefixes', () => {
  it('restores the `node:` prefix the bundler drops, so no consumer package can shadow a builtin', () => {
    expect(withBuiltinPrefixes('import{readFileSync}from"fs";')).toBe('import{readFileSync}from"node:fs";');
    expect(withBuiltinPrefixes("import { join } from 'path';")).toBe("import { join } from 'node:path';");
    expect(withBuiltinPrefixes('await import("crypto")')).toBe('await import("node:crypto")');
  });

  it('leaves a specifier that already carries a scheme alone, `bun:test` included', () => {
    // bun reports `bun:test` among `builtinModules`, so an unguarded pass would emit `node:bun:test`.
    for (const code of ['import{test}from"bun:test";', 'import{readFile}from"node:fs/promises";']) {
      expect(withBuiltinPrefixes(code)).toBe(code);
    }
  });

  it('leaves a userland specifier alone, however much it looks like a builtin', () => {
    for (const code of ['import*as E from"effect";', 'import{compile}from"svelte/compiler";']) {
      expect(withBuiltinPrefixes(code)).toBe(code);
    }
  });

  it('rewrites only import positions, not a builtin name that happens to sit in a string', () => {
    const hint = 'const message = "check that fs is mounted";';
    expect(withBuiltinPrefixes(hint)).toBe(hint);
  });
});

describe('externalsOf', () => {
  it('keeps every installed dependency external, by bare name and by subpath', () => {
    const externals = externalsOf({
      dir: '',
      manifestPath: '',
      manifest: { name: 'x', version: '0.0.0', dependencies: { effect: '>=4.0.0-rc.109 <5' } },
    });
    expect(externals).toEqual(['effect', 'effect/*']);
  });

  it('leaves a package with no dependencies with nothing to externalise, so everything reached is bundled', () => {
    expect(externalsOf({ dir: '', manifestPath: '', manifest: { name: 'x', version: '0.0.0' } })).toEqual([]);
  });

  it('externalises a PEER, which is the one it can least afford to inline', () => {
    // Regression: while `externalsOf` read only `dependencies`, moving `effect` and `svelte` to
    // `peerDependencies` bundled both into the dist — a vendored singleton, exactly what the peer
    // declaration exists to prevent, and the build reported success.
    expect(
      externalsOf({
        dir: '',
        manifestPath: '',
        manifest: {
          name: 'x',
          version: '0.0.0',
          peerDependencies: { effect: '>=4.0.0-rc.109 <5', svelte: '^5.56.8' },
        },
      }),
    ).toEqual(['effect', 'effect/*', 'svelte', 'svelte/*']);
  });

  it('externalises every real peer this repo ships, so none of them can be inlined', () => {
    for (const pkg of publishablePackages()) {
      const externals = externalsOf(pkg);
      for (const peer of Object.keys(pkg.manifest.peerDependencies ?? {})) {
        expect({ pkg: pkg.manifest.name, peer, external: externals.includes(peer) }).toEqual({
          pkg: pkg.manifest.name,
          peer,
          external: true,
        });
      }
    }
  });
});

describe('sourceOfDistTarget', () => {
  it('maps a dist target back to the source file the build compiles', () => {
    expect(sourceOfDistTarget('./dist/index.js')).toBe('src/index.ts');
    expect(sourceOfDistTarget('./dist/app-doubles/navigation.js')).toBe('src/app-doubles/navigation.ts');
  });

  it('maps a dotted subpath without truncating at the dot', () => {
    expect(sourceOfDistTarget('./dist/layer.live.js')).toBe('src/layer.live.ts');
  });

  it('refuses a target that is not built JavaScript, rather than inventing a source path for it', () => {
    expect(() => sourceOfDistTarget('./src/index.ts')).toThrow(/not a \.\/dist\/\*\.js export target/);
  });
});

describe('distSubpathOfJsTarget and distSubpathOfTypesTarget', () => {
  it('strips the dist directory and the extension, leaving the path the two emitters share', () => {
    expect(distSubpathOfJsTarget('./dist/tag.js')).toBe('tag');
    expect(distSubpathOfTypesTarget('./dist/tag.d.ts')).toBe('tag');
    expect(distSubpathOfJsTarget('./dist/bc_identity/l_domain/tag.js')).toBe('bc_identity/l_domain/tag');
    expect(distSubpathOfTypesTarget('./dist/bc_identity/l_domain/tag.d.ts')).toBe('bc_identity/l_domain/tag');
  });

  it('keeps a dotted subpath whole rather than truncating at the first dot', () => {
    expect(distSubpathOfJsTarget('./dist/layer.live.js')).toBe('layer.live');
    expect(distSubpathOfTypesTarget('./dist/layer.live.d.ts')).toBe('layer.live');
  });

  it('refuses a declaration where JavaScript is required, and the reverse', () => {
    expect(() => distSubpathOfJsTarget('./dist/tag.d.ts')).toThrow(/not a \.\/dist\/\*\.js/);
    expect(() => distSubpathOfTypesTarget('./dist/tag.js')).toThrow(/not a \.\/dist\/\*\.d\.ts/);
  });

  it('refuses a near-miss extension rather than reading it as a declaration', () => {
    expect(() => distSubpathOfTypesTarget('./dist/tag.dXts')).toThrow(/not a \.\/dist\/\*\.d\.ts/);
  });

  it('refuses a target outside dist, so no export can point at source', () => {
    expect(() => distSubpathOfJsTarget('./src/tag.js')).toThrow(/not a \.\/dist\/\*\.js/);
  });
});

describe('exportSubpathLeaf', () => {
  it('names the root subpath after the basename a dist path can actually carry', () => {
    expect(exportSubpathLeaf('.')).toBe(EXPORT_ROOT_BASENAME);
  });

  it('drops the leading marker and keeps every segment a consumer types', () => {
    expect(exportSubpathLeaf('./tag')).toBe('tag');
    expect(exportSubpathLeaf('./layer.live')).toBe('layer.live');
    expect(exportSubpathLeaf('./app-doubles/state')).toBe('app-doubles/state');
  });

  it('refuses a subpath node itself would not accept, rather than silently slicing two characters', () => {
    expect(() => exportSubpathLeaf('tag')).toThrow(/neither '\.' nor a '\.\/'-prefixed exports subpath/);
  });
});

describe('distSubpathCarriesLeaf', () => {
  it('accepts the flat layout, where the dist path IS the leaf', () => {
    expect(distSubpathCarriesLeaf('tag', 'tag')).toBe(true);
    expect(distSubpathCarriesLeaf('app-doubles/state', 'app-doubles/state')).toBe(true);
  });

  // The branch DD-9 exists for. Nothing in the repository reaches it until M2 nests `src/`, so it
  // is covered here rather than left to be exercised for the first time by the migration itself.
  it('accepts a nested dist path that still ends at the leaf, which is what frees the prefix', () => {
    expect(distSubpathCarriesLeaf('bc_identity/tag', 'tag')).toBe(true);
    expect(distSubpathCarriesLeaf('bc_identity/l_domain/tag', 'tag')).toBe(true);
    expect(distSubpathCarriesLeaf('bc_identity/app-doubles/state', 'app-doubles/state')).toBe(true);
  });

  it('refuses a dist path naming a different module, which is the wiring the flat pin used to prevent', () => {
    expect(distSubpathCarriesLeaf('bc_identity/uuid', 'tag')).toBe(false);
    expect(distSubpathCarriesLeaf('bc_identity/state', 'app-doubles/state')).toBe(false);
  });

  it('matches only at a segment boundary, so a longer name never passes as the leaf', () => {
    expect(distSubpathCarriesLeaf('mytag', 'tag')).toBe(false);
    expect(distSubpathCarriesLeaf('bc_identity/mytag', 'tag')).toBe(false);
  });
});

describe('buildOrder', () => {
  const packages = publishablePackages();

  it('bundles no sibling in THIS repository, so the ordering property has no live input here', () => {
    expect(packages.flatMap((pkg) => workspaceSiblingsOf(pkg, packages))).toEqual([]);
  });

  it('builds a bundled sibling before its dependent, whose declaration fold-in needs it', () => {
    const fixtures = makeFixtureRoot('build-order');
    try {
      const synthesise = (leaf: string, imports: readonly string[]) => {
        const dir = join(fixtures.path(), leaf);
        mkdirSync(join(dir, 'src'), { recursive: true });
        const manifest = { name: `@packages/${leaf}`, version: '0.0.0' };
        writeFileSync(join(dir, 'package.json'), `${JSON.stringify(manifest)}\n`);
        writeFileSync(
          join(dir, 'src', 'index.ts'),
          `${imports.map((specifier) => `import '${specifier}';`).join('\n')}\nexport const leaf = '${leaf}';\n`,
        );
        return { dir, manifestPath: join(dir, 'package.json'), manifest };
      };

      const sibling = synthesise('synthetic-sibling', []);
      const dependent = synthesise('synthetic-dependent', ['@packages/synthetic-sibling']);
      const pair = [dependent, sibling];

      expect(workspaceSiblingsOf(dependent, pair).map((pkg) => pkg.manifest.name)).toEqual([
        '@packages/synthetic-sibling',
      ]);
      expect(buildOrder(pair).map((pkg) => pkg.manifest.name)).toEqual([
        '@packages/synthetic-sibling',
        '@packages/synthetic-dependent',
      ]);
    } finally {
      fixtures.dispose();
    }
  });

  it('orders every publishable package exactly once', () => {
    expect(
      buildOrder(packages)
        .map((pkg) => pkg.manifest.name)
        .sort(),
    ).toEqual(packages.map((pkg) => pkg.manifest.name).sort());
  });
});

describe('sourceEntrypoints', () => {
  it('derives one entry point per exported subpath, so an export cannot go unbuilt', () => {
    for (const pkg of publishablePackages()) {
      expect({
        name: pkg.manifest.name,
        entries: sourceEntrypoints(pkg).length,
        exports: Object.keys(pkg.manifest.exports ?? {}).length,
      }).toEqual({
        name: pkg.manifest.name,
        entries: Object.keys(pkg.manifest.exports ?? {}).length,
        exports: Object.keys(pkg.manifest.exports ?? {}).length,
      });
    }
  });
});
