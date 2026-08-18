import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bareImportsOf, typeScriptFiles } from '../imports';
import {
  DIST_DIR,
  publishablePackages,
  readManifest,
  repoRoot,
  SOURCE_DIR,
  sourceOfDistTarget,
  WORKSPACE_SCOPE,
  workspacePackages,
  workspaceSiblingsOf,
} from '../workspace';

type DepMap = Readonly<Record<string, string>>;

type PublishManifest = {
  readonly name: string;
  readonly version: string;
  readonly license?: string;
  readonly publishConfig?: Readonly<Record<string, unknown>>;
  readonly repository?: { readonly type?: string; readonly url?: string; readonly directory?: string };
  readonly files?: readonly string[];
  readonly exports?: Readonly<Record<string, { readonly types?: string; readonly default?: string }>>;
  readonly main?: string;
  readonly module?: string;
  readonly types?: string;
  readonly dependencies?: DepMap;
  readonly devDependencies?: DepMap;
  readonly peerDependencies?: DepMap;
  readonly peerDependenciesMeta?: Readonly<Record<string, unknown>>;
  readonly optionalDependencies?: DepMap;
};

/** The fields that survive `bun pm pack` into a consumer's install graph. */
const PACKED_DEP_FIELDS = ['dependencies', 'optionalDependencies'] as const;
const PUBLISHED_SCOPE = '@packages/';

/** A specifier a consumer's package manager cannot resolve on its own. `workspace:` is meaningful
 *  only inside this repo, and the `@packages` scope is not ownable on npm, so either one packed
 *  into a manifest turns a plain install into a manual `overrides` exercise. */
const RESOLVES_FOR_A_CONSUMER = (name: string, range: string): boolean =>
  !name.startsWith(WORKSPACE_SCOPE) && !range.startsWith('workspace:') && !range.startsWith('catalog:');

const publishManifest = (manifestPath: string): PublishManifest =>
  JSON.parse(readFileSync(manifestPath, 'utf8')) as PublishManifest;

describe('publishable package contract', () => {
  const packages = publishablePackages();

  it('has at least one publishable package', () => {
    expect(packages.length).toBeGreaterThan(0);
  });

  for (const pkg of packages) {
    const manifest = publishManifest(pkg.manifestPath);

    describe(pkg.manifest.name, () => {
      it('is named under the publishable npm scope', () => {
        expect(manifest.name.startsWith(PUBLISHED_SCOPE)).toBe(true);
      });

      it('arms no registry publish, because @packages is not an ownable scope and distribution is by tarball', () => {
        expect(manifest.publishConfig).toBeUndefined();
      });

      it('declares the MIT license and a directory-scoped repository', () => {
        expect(manifest.license).toBe('MIT');
        expect(manifest.repository?.directory).toBe(pkg.dir.slice(repoRoot.length + 1));
      });

      it('ships the build output and the license text, and nothing else', () => {
        expect(manifest.files).toEqual([DIST_DIR, 'README.md', 'LICENSE']);
      });

      it('exports built JavaScript with a declaration beside it, never source TypeScript', () => {
        const entries = Object.entries(manifest.exports ?? {});
        expect(entries.length).toBeGreaterThan(0);
        for (const [subpath, entry] of entries) {
          expect({ subpath, ...entry }).toEqual({
            subpath,
            types: `./${DIST_DIR}/${subpath === '.' ? 'index' : subpath.slice(2)}.d.ts`,
            default: `./${DIST_DIR}/${subpath === '.' ? 'index' : subpath.slice(2)}.js`,
          });
        }
      });

      it('exports only targets the build has a source file for', () => {
        for (const entry of Object.values(manifest.exports ?? {})) {
          const source = join(pkg.dir, sourceOfDistTarget(entry.default ?? ''));
          expect({ source, present: existsSync(source) }).toEqual({ source, present: true });
        }
      });

      it('declares no main, module, or types field competing with the exports map', () => {
        expect({ main: manifest.main, module: manifest.module, types: manifest.types }).toEqual({
          main: undefined,
          module: undefined,
          types: undefined,
        });
      });

      it('declares NO peer dependency, which is the whole point of shipping a build', () => {
        expect({
          peerDependencies: manifest.peerDependencies,
          peerDependenciesMeta: manifest.peerDependenciesMeta,
        }).toEqual({ peerDependencies: undefined, peerDependenciesMeta: undefined });
      });

      it('packs only ranges a consumer can resolve with no overrides and no workspace of their own', () => {
        for (const field of PACKED_DEP_FIELDS) {
          for (const [dep, range] of Object.entries(manifest[field] ?? {})) {
            expect({ field, dep, range, resolves: RESOLVES_FOR_A_CONSUMER(dep, range) }).toEqual({
              field,
              dep,
              range,
              resolves: true,
            });
          }
        }
      });

      it('declares every package its shipped source imports, unless the build bundles it away', () => {
        const declared = new Set([
          ...Object.keys(manifest.dependencies ?? {}),
          ...Object.keys(manifest.optionalDependencies ?? {}),
        ]);
        const bundled = new Set(workspaceSiblingsOf(pkg, packages).map((sibling) => sibling.manifest.name));

        for (const imported of bareImportsOf(typeScriptFiles(join(pkg.dir, SOURCE_DIR)))) {
          expect({ imported, reachable: declared.has(imported) || bundled.has(imported) }).toEqual({
            imported,
            reachable: true,
          });
        }
      });

      it('imports no devDependency from shipped source except a sibling the build bundles', () => {
        const bundled = new Set(workspaceSiblingsOf(pkg, packages).map((sibling) => sibling.manifest.name));
        const devOnly = new Set(
          Object.keys(manifest.devDependencies ?? {}).filter(
            (dep) => !(dep in (manifest.dependencies ?? {})) && !bundled.has(dep),
          ),
        );
        for (const imported of bareImportsOf(typeScriptFiles(join(pkg.dir, SOURCE_DIR)))) {
          expect({ imported, devOnly: devOnly.has(imported) }).toEqual({ imported, devOnly: false });
        }
      });

      it('imports every relative specifier with its extension, which a `nodenext` consumer requires in the emitted declarations', () => {
        const EXTENSIONLESS = /(?:from|import\s*\()\s*'(\.[^']*)'/g;
        for (const file of typeScriptFiles(join(pkg.dir, SOURCE_DIR))) {
          for (const [, specifier] of readFileSync(file, 'utf8').matchAll(EXTENSIONLESS)) {
            expect({ file, specifier, extended: specifier?.endsWith('.ts') }).toEqual({
              file,
              specifier,
              extended: true,
            });
          }
        }
      });
    });
  }

  it('extracts bare imports from shipped source, so the import gates above are not vacuous', () => {
    const across = packages.flatMap((pkg) => [...bareImportsOf(typeScriptFiles(join(pkg.dir, SOURCE_DIR)))]);
    expect(across).toContain('effect');
  });

  it('finds the workspace sibling the build is meant to bundle, so that carve-out is not vacuous either', () => {
    const bundled = packages.flatMap((pkg) =>
      workspaceSiblingsOf(pkg, packages).map((sibling) => sibling.manifest.name),
    );
    expect(bundled).toContain('@packages/fixture-residue');
  });
});

describe('the registry arm stays disarmed', () => {
  it('carries no publishConfig in any manifest, the root one included', () => {
    const manifestPaths = [
      join(repoRoot, 'package.json'),
      ...workspacePackages().map((pkg) => pkg.manifestPath),
    ];
    for (const manifestPath of manifestPaths) {
      expect({ manifestPath, publishConfig: publishManifest(manifestPath).publishConfig }).toEqual({
        manifestPath,
        publishConfig: undefined,
      });
    }
  });

  it('carries no .npmrc at all, since nothing here authenticates to or publishes to a registry', () => {
    const npmrc = join(repoRoot, '.npmrc');
    expect({ npmrc, present: existsSync(npmrc) }).toEqual({ npmrc, present: false });
  });
});

describe('lockstep versioning', () => {
  const rootVersion = readManifest(join(repoRoot, 'package.json')).version;

  it('holds every workspace package at the root version', () => {
    for (const pkg of workspacePackages()) {
      expect({ name: pkg.manifest.name, version: pkg.manifest.version }).toEqual({
        name: pkg.manifest.name,
        version: rootVersion,
      });
    }
  });
});
