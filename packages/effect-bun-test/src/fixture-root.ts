import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  classifyEntry,
  type EntryVerdict,
  emptySweep,
  FIXTURE_ROOT_DIRNAME,
  type FixtureOwner,
  HOST,
  isOwnerAlive,
  parseFixtureOwner,
  type ReapFailure,
  type ResidueEntry,
  renderResidue,
  renderSweepLine,
  SEP,
  type SweepResult,
  sweepFixtureResidue as sweepFixtureResidueAt,
} from '@packages/fixture-residue/sweep';

export type { EntryVerdict, FixtureOwner, ReapFailure, ResidueEntry, SweepResult };

export {
  classifyEntry,
  FIXTURE_ROOT_DIRNAME,
  isOwnerAlive,
  parseFixtureOwner,
  renderResidue,
  renderSweepLine,
};

const PATH_SEGMENT = /[\\/]/;

const isInsideNodeModules = (dir: string): boolean => dir.split(PATH_SEGMENT).includes('node_modules');

export const resolveRepoRootFrom = (startDir: string): string => {
  let dir = startDir;
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml')) || existsSync(join(dir, '.git'))) {
      if (isInsideNodeModules(dir)) {
        throw new Error(
          `fixture-root: the repo-root marker walk from ${startDir} stopped at ${dir}, which is INSIDE a ` +
            `'node_modules' directory. That happens when an INSTALLED copy of a package carries a ` +
            `'pnpm-workspace.yaml' or '.git' entry of its own, and it would mint every fixture inside a ` +
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
      `'pnpm-workspace.yaml' or '.git' marker in some ancestor. Fixtures MUST live inside the repo ` +
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

export const sweepFixtureResidue = (
  opts: { readonly reap: boolean; readonly now?: number; readonly base?: string } = { reap: false },
): SweepResult => {
  if (opts.base !== undefined) {
    return sweepFixtureResidueAt({ reap: opts.reap, now: opts.now, base: opts.base });
  }
  let base: string;
  try {
    base = join(repoRoot(), FIXTURE_ROOT_DIRNAME);
  } catch {
    return emptySweep('', false);
  }
  return sweepFixtureResidueAt({ reap: opts.reap, now: opts.now, base });
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

let sweptThisProcess = false;

const detectOnce = (): void => {
  if (sweptThisProcess) return;
  sweptThisProcess = true;
  const result = sweepFixtureResidue({ reap: false });

  if (result.residue.length === 0 && result.unjudgeable === 0) return;
  const what =
    result.residue.length > 0
      ? `${result.residue.length} stranded fixture dir(s) from an earlier run; NOT reaped here so the tooling plane can report them`
      : `${result.unjudgeable} unaccounted fixture dir(s) (no ownership token, or another host)`;
  process.stderr.write(`[fixture-root] ${what} under ${result.base}. ${renderSweepLine(result)}\n`);
};

export const fixtureDirAtBase = (prefix: string): string => {
  detectOnce();
  return mkdtempSync(join(fixtureBase(), tokenPrefix(prefix)));
};

export const makeFixtureRoot = (suite: string): FixtureRoot => {
  let created: string | undefined;
  let seq = 0;
  const path = (): string => {
    if (created === undefined) {
      detectOnce();
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
