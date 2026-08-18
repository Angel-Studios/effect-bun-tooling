import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { bareImportsOf, typeScriptFiles } from './imports';

export const repoRoot = resolve(dirname(import.meta.dir));

export type DepMap = Readonly<Record<string, string>>;

/** The only `exports` shape this repo publishes: one conditions object per subpath. */
export type ExportEntry = { readonly types: string; readonly default: string };

export type Manifest = {
  readonly name: string;
  readonly version: string;
  readonly private?: boolean;
  readonly exports?: Readonly<Record<string, ExportEntry>>;
  readonly dependencies?: DepMap;
  readonly optionalDependencies?: DepMap;
  readonly peerDependencies?: DepMap;
  readonly devDependencies?: DepMap;
};

export type WorkspacePackage = {
  readonly dir: string;
  readonly manifestPath: string;
  readonly manifest: Manifest;
};

export type Catalog = DepMap;

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));

const isManifest = (value: unknown): value is Manifest =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { name?: unknown }).name === 'string' &&
  typeof (value as { version?: unknown }).version === 'string';

export const readManifest = (manifestPath: string): Manifest => {
  const parsed = readJson(manifestPath);
  if (!isManifest(parsed)) throw new Error(`${manifestPath} is not a package manifest with name and version`);
  return parsed;
};

export const workspacePackages = (root: string = repoRoot): readonly WorkspacePackage[] => {
  const packagesDir = join(root, 'packages');
  return readdirSync(packagesDir)
    .map((entry) => join(packagesDir, entry))
    .filter((dir) => statSync(dir).isDirectory())
    .map((dir) => ({ dir, manifestPath: join(dir, 'package.json') }))
    .filter((candidate) => {
      try {
        return statSync(candidate.manifestPath).isFile();
      } catch {
        return false;
      }
    })
    .map((candidate) => ({ ...candidate, manifest: readManifest(candidate.manifestPath) }));
};

export const publishablePackages = (root: string = repoRoot): readonly WorkspacePackage[] =>
  workspacePackages(root).filter((pkg) => pkg.manifest.private !== true);

export const rootCatalog = (root: string = repoRoot): Catalog => {
  const parsed = readJson(join(root, 'package.json'));
  const catalog = (parsed as { workspaces?: { catalog?: unknown } }).workspaces?.catalog;
  if (typeof catalog !== 'object' || catalog === null)
    throw new Error('package.json has no workspaces.catalog');
  return catalog as Catalog;
};

type Span = { readonly start: number; readonly end: number };

const WHITESPACE = /\s/;

const endOfJsonString = (source: string, open: number): number => {
  for (let i = open + 1; i < source.length; i += 1) {
    if (source[i] === '\\') {
      i += 1;
      continue;
    }
    if (source[i] === '"') return i;
  }
  throw new Error('manifest contains an unterminated JSON string');
};

const skipWhitespace = (source: string, from: number): number => {
  let i = from;
  while (i < source.length && WHITESPACE.test(source[i] ?? '')) i += 1;
  return i;
};

const topLevelStringValueSpan = (source: string, key: string): Span | undefined => {
  let depth = 0;
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '"') {
      const close = endOfJsonString(source, i);
      const colon = skipWhitespace(source, close + 1);
      if (depth === 1 && source[colon] === ':' && source.slice(i + 1, close) === key) {
        const valueStart = skipWhitespace(source, colon + 1);
        if (source[valueStart] !== '"') return undefined;
        return { start: valueStart + 1, end: endOfJsonString(source, valueStart) };
      }
      i = close + 1;
      continue;
    }
    if (ch === '{' || ch === '[') depth += 1;
    else if (ch === '}' || ch === ']') depth -= 1;
    i += 1;
  }
  return undefined;
};

export const withVersion = (source: string, version: string): string => {
  const declared = (JSON.parse(source) as { version?: unknown }).version;
  if (typeof declared !== 'string') throw new Error('manifest has no top-level version field to rewrite');

  const span = topLevelStringValueSpan(source, 'version');
  if (span === undefined || source.slice(span.start, span.end) !== declared) {
    throw new Error(
      `manifest has a top-level version field ${JSON.stringify(declared)} that could not be located in ` +
        `the source text, so no top-level version field can be rewritten without risking the wrong key`,
    );
  }

  return `${source.slice(0, span.start)}${version}${source.slice(span.end)}`;
};

/** `./dist/<name>.js` is built from `src/<name>.ts`; that pairing is the build's only input. */
export const DIST_DIR = 'dist';
export const SOURCE_DIR = 'src';

const DIST_TARGET = new RegExp(`^\\./${DIST_DIR}/(.+)\\.js$`);

/**
 * The source file behind an `exports` target, as a package-relative path.
 *
 * Deriving this from the manifest rather than from a separate list is what keeps the `exports`
 * map the single statement of what a consumer can reach: a subpath nobody exports is never
 * built, and a subpath that is exported cannot be forgotten by the build.
 */
export const sourceOfDistTarget = (target: string): string => {
  const match = DIST_TARGET.exec(target);
  if (match?.[1] === undefined) {
    throw new Error(`${target} is not a ./${DIST_DIR}/*.js export target, so no source file maps to it`);
  }
  return `${SOURCE_DIR}/${match[1]}.ts`;
};

export const sourceEntrypoints = (pkg: WorkspacePackage): readonly string[] =>
  Object.values(pkg.manifest.exports ?? {}).map((entry) => sourceOfDistTarget(entry.default));

/** The npm scope every package here is named under. It is not ownable, so it never resolves
 *  from a registry — which is precisely why a sibling is BUNDLED rather than depended on. */
export const WORKSPACE_SCOPE = '@packages/';

/**
 * The workspace siblings a package's SHIPPED SOURCE imports, and which its build therefore has to
 * fold in. Derived from the imports rather than from a manifest field, because a sibling is a
 * build input that leaves no trace in the published manifest — nothing else would keep the two
 * in step.
 */
export const workspaceSiblingsOf = (
  pkg: WorkspacePackage,
  candidates: readonly WorkspacePackage[],
): readonly WorkspacePackage[] => {
  const imported = bareImportsOf(typeScriptFiles(join(pkg.dir, SOURCE_DIR)));
  return candidates.filter(
    (candidate) =>
      candidate.manifest.name.startsWith(WORKSPACE_SCOPE) && imported.has(candidate.manifest.name),
  );
};

const DECLARATION_SUFFIX = '.d.ts';

/** Every declaration file a package emits for its OWN source, excluding folded-in siblings. */
export const typeTargets = (pkg: WorkspacePackage, exclude: readonly string[] = []): readonly string[] => {
  const dist = join(pkg.dir, DIST_DIR);
  if (!existsSync(dist)) return [];

  const walk = (dir: string): readonly string[] =>
    readdirSync(dir).flatMap((entry) => {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) return exclude.includes(entry) ? [] : walk(path);
      return path.endsWith(DECLARATION_SUFFIX) ? [path] : [];
    });

  return walk(dist);
};

/**
 * The dist files a module resolver can reach: the JavaScript a consumer executes and the
 * declarations its typechecker follows. A `.js.map` is deliberately not among them — nothing
 * resolves a sourcemap as a module, so the paths it records bind nobody.
 */
export const distModuleFiles = (pkg: WorkspacePackage): readonly string[] =>
  distFiles(pkg)
    .filter((file) => file.endsWith('.js') || file.endsWith(DECLARATION_SUFFIX))
    .map((file) => join(pkg.dir, DIST_DIR, file));

/** Every file a package's dist carries, as dist-relative paths. */
export const distFiles = (pkg: WorkspacePackage): readonly string[] => {
  const dist = join(pkg.dir, DIST_DIR);
  if (!existsSync(dist)) return [];

  const walk = (dir: string): readonly string[] =>
    readdirSync(dir).flatMap((entry) => {
      const path = join(dir, entry);
      return statSync(path).isDirectory() ? walk(path) : [path];
    });

  return walk(dist).map((path) => path.slice(dist.length + 1));
};

export const tarballName = (manifest: Manifest): string =>
  `${manifest.name.replace('@', '').replace('/', '-')}-${manifest.version}.tgz`;
