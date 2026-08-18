#!/usr/bin/env bun

/**
 * Builds every publishable package into `<package>/dist`.
 *
 * Two emitters run per package and neither can substitute for the other:
 *
 * - `bun build` produces the JavaScript. It BUNDLES, which is what lets a workspace sibling
 *   (`@packages/*`) be folded into its dependent's output instead of shipped as a dependency a
 *   consumer would have to `overrides`-map to a tarball, since `@packages` is not an ownable npm
 *   scope and so resolves nowhere.
 * - `tsc --emitDeclarationOnly` produces the `.d.ts`. Nothing in the bundler emits declarations,
 *   and the declarations are the whole reason a third-party dependency stays EXTERNAL: a
 *   consumer's `Effect.Effect<A, E, R>` has to be the same type the signatures here name, which
 *   only holds while `effect` resolves to one installed package rather than a vendored copy.
 *
 * Because the two emitters disagree about workspace siblings — the bundler folds them in, `tsc`
 * leaves a bare `@packages/...` specifier standing in the `.d.ts` — {@link foldSiblingTypes}
 * finishes the job the bundler started, copying the sibling's declarations under `_bundled/` and
 * repointing the specifiers at them. Without it the JavaScript would need nothing installed while
 * the types still demanded a package that cannot resolve.
 *
 * Entry points are DERIVED from each manifest's `exports` map rather than listed here, so the map
 * stays the single statement of what a consumer can reach.
 */

import { cpSync, existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { bareImportsOf } from './imports';
import {
  DIST_DIR,
  distFiles,
  distModuleFiles,
  publishablePackages,
  sourceEntrypoints,
  typeTargets,
  WORKSPACE_SCOPE,
  type WorkspacePackage,
  workspaceSiblingsOf,
} from './workspace';

/** Where a bundled sibling's declarations land inside its dependent's `dist`. */
export const BUNDLED_TYPES_DIR = '_bundled';

/**
 * Everything a consumer installs stays external, and a PEER most of all: the entire reason
 * `effect` and `svelte` are peers is that exactly one copy may exist in a consumer's tree, and
 * bundling a second one in here would defeat that outright and silently. `bun build` matches an
 * external by exact specifier, so a package reached by subpath (`effect/Layer`,
 * `svelte/compiler`) needs the wildcard form alongside the bare name.
 */
export const externalsOf = (pkg: WorkspacePackage): readonly string[] =>
  [
    ...Object.keys(pkg.manifest.dependencies ?? {}),
    ...Object.keys(pkg.manifest.peerDependencies ?? {}),
    ...Object.keys(pkg.manifest.optionalDependencies ?? {}),
  ]
    .sort()
    .flatMap((name) => [name, `${name}/*`]);

/**
 * A `.d.ts` relative specifier keeps the `.ts` extension it had in source: TypeScript resolves
 * `./x.ts` to `./x.d.ts`, and an EXTENSIONLESS specifier is a hard error for any consumer on
 * `moduleResolution: node16` or `nodenext`. This is the same form `effect` itself ships.
 */
const declarationSpecifier = (fromFile: string, toFile: string): string => {
  const rel = relative(dirname(fromFile), toFile).replaceAll('\\', '/');
  const withTsExtension = rel.replace(/\.d\.ts$/, '.ts');
  return withTsExtension.startsWith('.') ? withTsExtension : `./${withTsExtension}`;
};

/**
 * Copies each bundled sibling's declarations into this package's `dist` and repoints every
 * `@packages/<sibling>/<subpath>` specifier at the copy, mirroring in the type graph what the
 * bundler already did in the module graph.
 */
export const foldSiblingTypes = (pkg: WorkspacePackage, siblings: readonly WorkspacePackage[]): void => {
  const dist = join(pkg.dir, DIST_DIR);

  for (const sibling of siblings) {
    const siblingDist = join(sibling.dir, DIST_DIR);
    if (!existsSync(siblingDist)) {
      throw new Error(
        `${pkg.manifest.name} bundles ${sibling.manifest.name}, whose dist is not built yet; ` +
          'a sibling must be built before its dependent',
      );
    }

    const vendored = join(dist, BUNDLED_TYPES_DIR, sibling.manifest.name.replace('@', '').replace('/', '-'));
    // Only the declarations travel: the sibling's JavaScript is already inlined by the bundler.
    cpSync(siblingDist, vendored, {
      recursive: true,
      filter: (src) => statSync(src).isDirectory() || src.endsWith('.d.ts'),
    });

    for (const [subpath, target] of Object.entries(sibling.manifest.exports ?? {})) {
      const specifier = `${sibling.manifest.name}${subpath.slice(1)}`;
      const vendoredFile = join(vendored, target.types.slice(`./${DIST_DIR}/`.length));

      for (const file of typeTargets(pkg, [BUNDLED_TYPES_DIR])) {
        const source = readFileSync(file, 'utf8');
        const rewritten = source
          .replaceAll(`'${specifier}'`, `'${declarationSpecifier(file, vendoredFile)}'`)
          .replaceAll(`"${specifier}"`, `"${declarationSpecifier(file, vendoredFile)}"`);
        if (rewritten !== source) writeFileSync(file, rewritten);
      }
    }
  }
};

/** Bun reports `bun:test` and friends among `builtinModules`; those already carry a scheme and
 *  must not be prefixed a second time. */
const BUILTINS: ReadonlySet<string> = new Set(builtinModules.filter((name) => !name.includes(':')));

const MODULE_SPECIFIER = /(from\s*|import\s*\(\s*|require\s*\(\s*)(['"])([^'"]+)\2/g;

/**
 * Restores the `node:` prefix the bundler drops.
 *
 * Source here imports `node:fs`; `bun build` emits plain `fs`, and under `--target=node` it emits
 * BOTH forms in one file. The bare form is not wrong — Node and Bun both resolve a builtin name
 * ahead of `node_modules` — but `fs`, `path`, `os`, `crypto` and `assert` are all real packages on
 * npm, so the bare form is one resolver quirk away from binding to a consumer's userland copy. The
 * prefixed form cannot be shadowed by anything.
 */
export const withBuiltinPrefixes = (code: string): string =>
  code.replaceAll(MODULE_SPECIFIER, (whole, head: string, quote: string, specifier: string) =>
    BUILTINS.has(specifier) ? `${head}${quote}node:${specifier}${quote}` : whole,
  );

const run = (cmd: readonly string[], cwd: string, what: string): void => {
  const result = Bun.spawnSync({ cmd: [...cmd], cwd, stdout: 'pipe', stderr: 'pipe' });
  if (result.exitCode !== 0) {
    throw new Error(
      `${what} failed in ${cwd}:\n${result.stdout.toString()}${result.stderr.toString()}`.trimEnd(),
    );
  }
};

export const buildOne = (pkg: WorkspacePackage, siblings: readonly WorkspacePackage[] = []): string => {
  const dist = join(pkg.dir, DIST_DIR);
  rmSync(dist, { recursive: true, force: true });

  const entrypoints = sourceEntrypoints(pkg);
  if (entrypoints.length === 0) throw new Error(`${pkg.manifest.name} declares no exports to build`);

  run(
    [
      'bun',
      'build',
      '--target=bun',
      '--splitting',
      '--sourcemap=linked',
      `--outdir=${dist}`,
      ...externalsOf(pkg).map((name) => `--external=${name}`),
      ...entrypoints,
    ],
    pkg.dir,
    'bun build',
  );

  for (const file of distFiles(pkg).filter((name) => name.endsWith('.js'))) {
    const path = join(dist, file);
    const source = readFileSync(path, 'utf8');
    const prefixed = withBuiltinPrefixes(source);
    if (prefixed !== source) writeFileSync(path, prefixed);
  }

  // Through `bun run`, never as a bare `tsc`: the bin carries a `#!/usr/bin/env node` shebang, and
  // a direct spawn both leaves the workspace's pinned TypeScript for whatever `tsc` is on PATH and
  // starts the node process this repo installs no toolchain for.
  run(['bun', 'run', 'build:types'], pkg.dir, 'tsc --emitDeclarationOnly');

  foldSiblingTypes(pkg, siblings);

  for (const entry of Object.values(pkg.manifest.exports ?? {})) {
    for (const target of [entry.default, entry.types]) {
      const path = join(pkg.dir, target);
      if (!existsSync(path)) {
        throw new Error(`${pkg.manifest.name} exports ${target}, which the build did not produce`);
      }
    }
  }

  // A peer that stopped being imported was INLINED, not dropped: `bun build` bundles anything it
  // is not told to keep external, and a silently vendored second copy of `effect` or `svelte` is
  // the exact failure the peer declaration exists to prevent. Measured once for real, when
  // `externalsOf` did not yet read `peerDependencies`.
  const distImports = bareImportsOf(distModuleFiles(pkg));
  for (const peer of Object.keys(pkg.manifest.peerDependencies ?? {})) {
    if (!distImports.has(peer)) {
      throw new Error(
        `${pkg.manifest.name} declares ${peer} as a peer dependency, but its dist imports it ` +
          'nowhere — the bundler inlined a copy instead of leaving it external, which is what the ' +
          'peer declaration exists to prevent',
      );
    }
  }

  for (const imported of distImports) {
    if (imported.startsWith(WORKSPACE_SCOPE)) {
      throw new Error(
        `${pkg.manifest.name}'s dist still imports ${imported}, a ${WORKSPACE_SCOPE} name that resolves ` +
          'nowhere for a consumer; the bundler and the declaration fold-in were meant to remove every one',
      );
    }
  }

  return dist;
};

/**
 * Builds siblings before their dependents, since folding a sibling's declarations in requires
 * that sibling's own `dist` to already exist.
 */
export const buildOrder = (packages: readonly WorkspacePackage[]): readonly WorkspacePackage[] => {
  const remaining = [...packages];
  const ordered: WorkspacePackage[] = [];

  while (remaining.length > 0) {
    const index = remaining.findIndex((pkg) =>
      workspaceSiblingsOf(pkg, packages).every((sibling) => ordered.includes(sibling)),
    );
    if (index === -1) {
      throw new Error(
        `a cycle of bundled workspace siblings has no build order: ${remaining
          .map((pkg) => pkg.manifest.name)
          .join(', ')}`,
      );
    }
    ordered.push(...remaining.splice(index, 1));
  }
  return ordered;
};

export const buildAll = (): readonly string[] => {
  const packages = publishablePackages();
  return buildOrder(packages).map((pkg) => buildOne(pkg, workspaceSiblingsOf(pkg, packages)));
};

if (import.meta.main) {
  for (const dist of buildAll()) process.stdout.write(`${dist}\n`);
}
