import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export const repoRoot = resolve(dirname(import.meta.dir));

export type Manifest = {
  readonly name: string;
  readonly version: string;
  readonly private?: boolean;
};

export type WorkspacePackage = {
  readonly dir: string;
  readonly manifestPath: string;
  readonly manifest: Manifest;
};

export type Catalog = Readonly<Record<string, string>>;

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

export const pnpmCatalog = (root: string = repoRoot): Catalog => {
  const parsed = Bun.YAML.parse(readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8'));
  const catalog = (parsed as { catalog?: unknown }).catalog;
  if (typeof catalog !== 'object' || catalog === null) throw new Error('pnpm-workspace.yaml has no catalog');
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

export const tarballName = (manifest: Manifest): string =>
  `${manifest.name.replace('@', '').replace('/', '-')}-${manifest.version}.tgz`;
