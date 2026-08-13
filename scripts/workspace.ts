import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export const repoRoot = resolve(dirname(import.meta.dir));

export type Manifest = {
  readonly name: string;
  readonly version: string;
  readonly private?: boolean;
  readonly publishConfig?: { readonly access?: string };
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

export const tarballName = (manifest: Manifest): string =>
  `${manifest.name.replace('@', '').replace('/', '-')}-${manifest.version}.tgz`;
