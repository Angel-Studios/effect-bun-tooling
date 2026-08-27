import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';

export const FIXTURE_ROOT_DIRNAME = '.test-fixtures';

export const SEP = '--';

export const HOST = hostname().replace(/[^A-Za-z0-9_.]+/g, '_');

const PATH_SEGMENT = /[\\/]/;

const isInsideNodeModules = (dir: string): boolean => dir.split(PATH_SEGMENT).includes('node_modules');

export const REPO_ROOT_MARKERS = ['bun.lock', '.git'] as const;

const MARKER_LIST = REPO_ROOT_MARKERS.map((marker) => `'${marker}'`).join(' or ');

export const resolveRepoRootFrom = (startDir: string): string => {
  let dir = startDir;
  for (;;) {
    if (REPO_ROOT_MARKERS.some((marker) => existsSync(join(dir, marker)))) {
      if (isInsideNodeModules(dir)) {
        throw new Error(
          `fixture-root: the repo-root marker walk from ${startDir} stopped at ${dir}, which is INSIDE a ` +
            `'node_modules' directory. That happens when an INSTALLED copy of a package carries a ` +
            `${MARKER_LIST} entry of its own, and it would mint every fixture inside a ` +
            `dependency instead of inside the consuming repo — silently, in every suite at once. ` +
            `Remove that marker from the packaged files rather than working around this.`,
        );
      }
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `fixture-root: could not locate the repo root by walking up from ${startDir}; expected a ` +
      `${MARKER_LIST} marker in some ancestor. Fixtures MUST live inside the repo ` +
      `(hard invariant I-1), so there is deliberately no out-of-repo fallback.`,
  );
};

let repoRootMemo: string | undefined;
export const repoRoot = (): string => {
  repoRootMemo ??= resolveRepoRootFrom(import.meta.dir);
  return repoRootMemo;
};

export const fixtureBase = (): string => {
  const base = join(repoRoot(), FIXTURE_ROOT_DIRNAME);
  mkdirSync(base, { recursive: true });
  return base;
};

export const GIT_LOCATION_VARS = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_CEILING_DIRECTORIES',
] as const;

export const withoutGitLocationVars = (
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string> => {
  const banned: readonly string[] = GIT_LOCATION_VARS;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (v !== undefined && !banned.includes(k)) out[k] = v;
  }
  return out;
};

export type FixtureRoot = {
  readonly suite: string;

  readonly path: () => string;

  readonly mkdir: (prefix?: string) => string;

  readonly reserve: (prefix?: string) => string;

  readonly dispose: () => void;
};

const tokenPrefix = (label: string): string => {
  const normalised = label.replace(/-+$/, '');
  if (normalised.includes(SEP) || normalised === '') {
    throw new Error(
      `fixture-root: invalid fixture label ${JSON.stringify(label)}; a label must be non-empty and must ` +
        `not contain ${JSON.stringify(SEP)}, which is the ownership-token separator. Use single hyphens.`,
    );
  }
  return `${normalised}${SEP}${HOST}${SEP}${String(process.pid)}${SEP}`;
};

export const fixtureDirAtBase = (prefix: string): string => {
  return mkdtempSync(join(fixtureBase(), tokenPrefix(prefix)));
};

export const makeFixtureRoot = (suite: string): FixtureRoot => {
  let created: string | undefined;
  let seq = 0;
  const path = (): string => {
    if (created === undefined) {
      created = mkdtempSync(join(fixtureBase(), tokenPrefix(suite)));
    }
    return created;
  };
  return {
    suite,
    path,
    mkdir: (prefix = 'case-') => mkdtempSync(join(path(), prefix)),
    reserve: (prefix = 'path-') => {
      seq += 1;
      return join(path(), `${prefix}${seq}`);
    },
    dispose: () => {
      const root = created;
      if (root === undefined) return;
      created = undefined;
      rmSync(root, { recursive: true, force: true });
    },
  };
};
