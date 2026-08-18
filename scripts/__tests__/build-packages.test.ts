import { describe, expect, it } from 'bun:test';
import { buildOrder, externalsOf, withBuiltinPrefixes } from '../build-packages';
import {
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

describe('buildOrder', () => {
  const packages = publishablePackages();

  it('builds a bundled sibling before its dependent, whose declaration fold-in needs it', () => {
    const ordered = buildOrder(packages).map((pkg) => pkg.manifest.name);

    for (const pkg of packages) {
      for (const sibling of workspaceSiblingsOf(pkg, packages)) {
        expect({
          pkg: pkg.manifest.name,
          sibling: sibling.manifest.name,
          before: ordered.indexOf(sibling.manifest.name) < ordered.indexOf(pkg.manifest.name),
        }).toEqual({ pkg: pkg.manifest.name, sibling: sibling.manifest.name, before: true });
      }
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
