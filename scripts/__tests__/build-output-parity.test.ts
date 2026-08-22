import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { BUNDLED_TYPES_DIR } from '../build-packages';
import { typeScriptFiles } from '../imports';
import {
  DECLARATION_SUFFIX,
  DIST_DIR,
  distFiles,
  distSubpathCarriesLeaf,
  distSubpathOfJsTarget,
  type ExportEntry,
  exportSubpathLeaf,
  publishablePackages,
  SOURCE_DIR,
  sourceEntrypoints,
  type WorkspacePackage,
} from '../workspace';

const BUNDLED_PREFIX = `${BUNDLED_TYPES_DIR}/`;
const JS_EXTENSION = '.js';
const SOURCE_EXTENSION = '.ts';

const BUILD_TSCONFIG = 'tsconfig.build.json';

type BuildTsconfig = {
  readonly compilerOptions?: { readonly rootDir?: unknown; readonly outDir?: unknown };
  readonly include?: unknown;
};

const buildTsconfigOf = (pkg: WorkspacePackage): BuildTsconfig =>
  JSON.parse(readFileSync(join(pkg.dir, BUILD_TSCONFIG), 'utf8')) as BuildTsconfig;

const posix = (path: string): string => path.replaceAll('\\', '/');

const withoutExtension = (path: string, extension: string): string =>
  path.slice(0, path.length - extension.length);

const sorted = (paths: Iterable<string>): readonly string[] => [...paths].sort();

type BuildShape = {
  readonly name: string;
  readonly bundled: readonly string[];
  readonly javaScript: readonly string[];
  readonly declarations: readonly string[];
  readonly source: readonly string[];
  readonly entrypoints: readonly string[];
  readonly exports: readonly (readonly [string, ExportEntry])[];
};

const shapeOf = (pkg: WorkspacePackage): BuildShape => {
  const emitted = distFiles(pkg).map(posix);
  const own = emitted.filter((file) => !file.startsWith(BUNDLED_PREFIX));
  const sourceDir = join(pkg.dir, SOURCE_DIR);

  return {
    name: pkg.manifest.name,
    bundled: emitted.filter((file) => file.startsWith(BUNDLED_PREFIX)),
    javaScript: own
      .filter((file) => file.endsWith(JS_EXTENSION))
      .map((file) => withoutExtension(file, JS_EXTENSION)),
    declarations: own
      .filter((file) => file.endsWith(DECLARATION_SUFFIX))
      .map((file) => withoutExtension(file, DECLARATION_SUFFIX)),
    source: typeScriptFiles(sourceDir).map((file) =>
      withoutExtension(posix(relative(sourceDir, file)), SOURCE_EXTENSION),
    ),
    entrypoints: sourceEntrypoints(pkg).map((entry) =>
      withoutExtension(entry.slice(`${SOURCE_DIR}/`.length), SOURCE_EXTENSION),
    ),
    exports: Object.entries(pkg.manifest.exports ?? {}),
  };
};

describe('the two emitters agree on where they put things', () => {
  const packages = publishablePackages();
  const shapes = packages.map(shapeOf);

  it('finds publishable packages to compare, so nothing below is vacuous', () => {
    expect(packages.length).toBeGreaterThan(0);
  });

  for (const shape of shapes) {
    const sourcePaths = new Set(shape.source);
    const sourceBasenames = new Set(shape.source.map((path) => basename(path)));
    const entrypointPaths = new Set(shape.entrypoints);
    const expected = sorted(shape.entrypoints);

    describe(shape.name, () => {
      it('has a dist to compare, which `bun run build` produces and the DoD runs before the tests', () => {
        expect({
          name: shape.name,
          built: shape.javaScript.length > 0 && shape.declarations.length > 0,
        }).toEqual({ name: shape.name, built: true });
      });

      it('emits one declaration per source file, at the relative path that source file holds', () => {
        expect(sorted(shape.declarations)).toEqual(sorted(shape.source));
      });

      it('emits the .js tree and the .d.ts tree at IDENTICAL relative paths across every entrypoint', () => {
        expect({
          javaScript: sorted(shape.javaScript.filter((path) => sourcePaths.has(path))),
          declarations: sorted(shape.declarations.filter((path) => entrypointPaths.has(path))),
        }).toEqual({ javaScript: expected, declarations: expected });
      });

      // A relocated module keeps its NAME and loses its directory, so its emitted path is never its
      // source path — comparing full paths would miss every relocation. A bundler chunk carries a
      // hash its source never had, so the basenames cannot collide by accident.
      it('emits no JavaScript beside an entrypoint sharing a name with a source module, as a relocated one would', () => {
        const declarationPaths = new Set(shape.declarations);
        for (const extra of shape.javaScript.filter((path) => !entrypointPaths.has(path))) {
          expect({
            name: shape.name,
            extra,
            shadowsSourceModule: sourceBasenames.has(basename(extra)),
            carriesDeclaration: declarationPaths.has(extra),
          }).toEqual({ name: shape.name, extra, shadowsSourceModule: false, carriesDeclaration: false });
        }
      });

      // DD-9 frees the dist PREFIX, so a subpath leaf is all that names the module. If two source
      // files under one package share the name a subpath resolves by, the subpath cannot say which
      // it means and the other silently stops being exported.
      it('leaves every exported subpath naming exactly one source module, so no flat subpath is ambiguous', () => {
        for (const [subpath, entry] of shape.exports) {
          const leaf = exportSubpathLeaf(subpath);
          expect({
            name: shape.name,
            subpath,
            candidates: shape.source.filter((path) => distSubpathCarriesLeaf(path, leaf)).sort(),
          }).toEqual({
            name: shape.name,
            subpath,
            candidates: [distSubpathOfJsTarget(entry.default)],
          });
        }
      });

      it(`carries only declarations under ${BUNDLED_TYPES_DIR}/, which is why the .js side may skip it`, () => {
        expect({
          name: shape.name,
          foreign: shape.bundled.filter((file) => !file.endsWith(DECLARATION_SUFFIX)),
        }).toEqual({ name: shape.name, foreign: [] });
      });
    });
  }

  it(`finds a real ${BUNDLED_TYPES_DIR}/ tree, so excluding it from the comparison excludes something`, () => {
    expect(shapes.flatMap((shape) => shape.bundled).length).toBeGreaterThan(0);
  });

  it('finds emitted JavaScript beside the entrypoints, so the allowance allows for something real', () => {
    const chunks = shapes.flatMap((shape) =>
      shape.javaScript.filter((path) => !shape.entrypoints.includes(path)),
    );
    expect(chunks.length).toBeGreaterThan(0);
  });

  // `SOURCE_DIR` reaches the bundler as `--root` and `tsc` through this file's `rootDir`, so the
  // two are copies of one constant in two languages. Pinning them here is what stops a package
  // from declaring a root of its own and reopening the divergence `--root` was added to close —
  // including a package added after this test was written.
  for (const pkg of publishablePackages()) {
    it(`points ${pkg.manifest.name}'s ${BUILD_TSCONFIG} at the same root and output the bundler is given`, () => {
      const config = buildTsconfigOf(pkg);
      expect({
        name: pkg.manifest.name,
        rootDir: config.compilerOptions?.rootDir,
        outDir: config.compilerOptions?.outDir,
        include: config.include,
      }).toEqual({
        name: pkg.manifest.name,
        rootDir: SOURCE_DIR,
        outDir: DIST_DIR,
        include: [SOURCE_DIR],
      });
    });
  }
});
