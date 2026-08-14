import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bareImportsOf, typeScriptFiles } from '../imports';
import { publishablePackages, readManifest, repoRoot, workspacePackages } from '../workspace';

type DepMap = Readonly<Record<string, string>>;

type PublishManifest = {
  readonly name: string;
  readonly version: string;
  readonly license?: string;
  readonly publishConfig?: Readonly<Record<string, unknown>>;
  readonly repository?: { readonly type?: string; readonly url?: string; readonly directory?: string };
  readonly files?: readonly string[];
  readonly exports?: Readonly<Record<string, string>>;
  readonly main?: string;
  readonly module?: string;
  readonly types?: string;
  readonly dependencies?: DepMap;
  readonly devDependencies?: DepMap;
  readonly peerDependencies?: DepMap;
  readonly optionalDependencies?: DepMap;
};

const PACKED_DEP_FIELDS = ['dependencies', 'peerDependencies', 'optionalDependencies'] as const;
const PUBLISHED_SCOPE = '@packages/';
const CROSS_BOUNDARY_SINGLETONS = ['effect', '@effect/platform', 'svelte'];

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

      it('ships src and the license text, and nothing else', () => {
        expect(manifest.files).toEqual(['src', 'README.md', 'LICENSE']);
      });

      it('exports source TypeScript only, so no build step can be required', () => {
        const targets = Object.values(manifest.exports ?? {});
        expect(targets.length).toBeGreaterThan(0);
        for (const target of targets) {
          expect({ target, sourceTs: target.startsWith('./src/') && target.endsWith('.ts') }).toEqual({
            target,
            sourceTs: true,
          });
        }
      });

      it('declares no main, module, or types field that would point at an unbuilt path', () => {
        expect({ main: manifest.main, module: manifest.module, types: manifest.types }).toEqual({
          main: undefined,
          module: undefined,
          types: undefined,
        });
      });

      it('keeps every cross-boundary singleton out of dependencies', () => {
        for (const singleton of CROSS_BOUNDARY_SINGLETONS) {
          expect({ singleton, declaredAsDependency: singleton in (manifest.dependencies ?? {}) }).toEqual({
            singleton,
            declaredAsDependency: false,
          });
        }
      });

      it('resolves catalog specifiers only in devDependencies, which are never packed', () => {
        for (const field of PACKED_DEP_FIELDS) {
          for (const [dep, range] of Object.entries(manifest[field] ?? {})) {
            expect({ field, dep, catalog: range.startsWith('catalog:') }).toEqual({
              field,
              dep,
              catalog: false,
            });
          }
        }
      });

      it('declares every peer dependency as a range rather than an exact pin', () => {
        for (const [dep, range] of Object.entries(manifest.peerDependencies ?? {})) {
          expect({ dep, range, ranged: /^[\^~>]/.test(range) }).toEqual({ dep, range, ranged: true });
        }
      });

      it('declares every package its shipped source imports, so a consumer resolves all of them', () => {
        const declared = new Set([
          ...Object.keys(manifest.dependencies ?? {}),
          ...Object.keys(manifest.peerDependencies ?? {}),
          ...Object.keys(manifest.optionalDependencies ?? {}),
        ]);
        for (const imported of bareImportsOf(typeScriptFiles(join(pkg.dir, 'src')))) {
          expect({ imported, declared: declared.has(imported) }).toEqual({ imported, declared: true });
        }
      });

      it('never imports a devDependency from shipped source, because a consumer installs none of them', () => {
        const devOnly = new Set(
          Object.keys(manifest.devDependencies ?? {}).filter(
            (dep) => !(dep in (manifest.dependencies ?? {})) && !(dep in (manifest.peerDependencies ?? {})),
          ),
        );
        for (const imported of bareImportsOf(typeScriptFiles(join(pkg.dir, 'src')))) {
          expect({ imported, devOnly: devOnly.has(imported) }).toEqual({ imported, devOnly: false });
        }
      });
    });
  }

  it('extracts bare imports from shipped source, so the two import gates above are not vacuous', () => {
    const across = packages.flatMap((pkg) => [...bareImportsOf(typeScriptFiles(join(pkg.dir, 'src')))]);
    expect(across).toContain('effect');
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

  it('points no .npmrc at a registry, since nothing here publishes to one', () => {
    const npmrc = join(repoRoot, '.npmrc');
    if (!existsSync(npmrc)) return;
    for (const line of readFileSync(npmrc, 'utf8').split('\n')) {
      const key = line.split('=')[0]?.trim() ?? '';
      expect({
        line,
        registryKey: key === 'registry' || key === 'access' || key.endsWith(':registry'),
      }).toEqual({ line, registryKey: false });
    }
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
