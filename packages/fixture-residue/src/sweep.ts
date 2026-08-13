import { readdirSync, rmSync, statSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';

export const FIXTURE_ROOT_DIRNAME = '.test-fixtures';

export const SEP = '--';

export const HOST = hostname().replace(/[^A-Za-z0-9_.]+/g, '_');

const REAP_GRACE_MS = 60_000;

const MAX_ENTRY_AGE_MS = 24 * 60 * 60 * 1000;

export type FixtureOwner = { readonly label: string; readonly host: string; readonly pid: number };

export const parseFixtureOwner = (name: string): FixtureOwner | undefined => {
  const parts = name.split(SEP);
  if (parts.length < 4) return undefined;
  parts.pop();
  const pidRaw = parts.pop();
  const host = parts.pop();
  const label = parts.join(SEP);
  if (pidRaw === undefined || host === undefined || host === '' || label === '') return undefined;
  if (!/^\d+$/.test(pidRaw)) return undefined;
  return { label, host, pid: Number(pidRaw) };
};

export const isOwnerAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as { code?: string }).code !== 'ESRCH';
  }
};

export type EntryVerdict = 'live' | 'within-grace' | 'unjudgeable' | 'dead-owner' | 'over-age';

const RESIDUE_VERDICTS: ReadonlySet<EntryVerdict> = new Set<EntryVerdict>(['dead-owner', 'over-age']);

const ageMs = (path: string, now: number): number => {
  try {
    return now - statSync(path).mtimeMs;
  } catch {
    return 0;
  }
};

export const classifyEntry = (name: string, path: string, now: number): EntryVerdict => {
  const age = ageMs(path, now);
  const owner = parseFixtureOwner(name);

  if (owner === undefined || owner.host !== HOST) return 'unjudgeable';

  if (age > MAX_ENTRY_AGE_MS) return 'over-age';
  if (isOwnerAlive(owner.pid)) return 'live';
  return age > REAP_GRACE_MS ? 'dead-owner' : 'within-grace';
};

export type ResidueEntry = {
  readonly name: string;
  readonly path: string;
  readonly verdict: EntryVerdict;
};

export type SweepResult = {
  readonly base: string;

  readonly baseResolved: boolean;

  readonly residue: readonly ResidueEntry[];
  readonly reaped: readonly string[];

  readonly liveOwned: number;

  readonly unjudgeable: number;
};

export const emptySweep = (base: string, baseResolved: boolean): SweepResult => ({
  base,
  baseResolved,
  residue: [],
  reaped: [],
  liveOwned: 0,
  unjudgeable: 0,
});

export const sweepFixtureResidue = (opts: {
  readonly reap: boolean;
  readonly now?: number;

  readonly base: string;
}): SweepResult => {
  const now = opts.now ?? Date.now();
  const base = opts.base;
  let names: readonly string[];
  try {
    names = readdirSync(base);
  } catch (e) {
    const absent = (e as { code?: string }).code === 'ENOENT';
    return emptySweep(base, absent);
  }
  const residue: ResidueEntry[] = [];
  const reaped: string[] = [];
  let liveOwned = 0;
  let unjudgeable = 0;
  for (const name of names) {
    const path = join(base, name);
    const verdict = classifyEntry(name, path, now);
    if (verdict === 'unjudgeable') {
      unjudgeable += 1;
      continue;
    }
    if (!RESIDUE_VERDICTS.has(verdict)) {
      liveOwned += 1;
      continue;
    }
    residue.push({ name, path, verdict });
    if (opts.reap) {
      try {
        rmSync(path, { recursive: true, force: true });
        reaped.push(path);
      } catch {}
    }
  }
  return { base, baseResolved: true, residue, reaped, liveOwned, unjudgeable };
};

export const renderResidue = (result: SweepResult): string => {
  if (!result.baseResolved) {
    return (
      'test-fixture residue tripwire COULD NOT RUN: the in-repo fixture base could not be resolved or ' +
      'read, so this is NOT a clean result. Inside a compiled binary `import.meta.dir` is `/$bunfs/root` ' +
      'and the marker walk cannot find the repo; run the tooling plane from source.'
    );
  }
  if (result.residue.length === 0) return '';
  const lines = [
    `test-fixture residue tripwire FAILED: ${result.residue.length} unreaped fixture dir(s) under ${result.base}`,
    '  A fixture outliving its suite means cleanup did not run — a bail-out, a SIGKILL, or a runner crash.',
    "  Fix the owning suite's disposal; deleting these by hand hides the defect and it returns.",
  ];
  for (const e of result.residue) lines.push(`  - ${e.name}  [${e.verdict}]`);
  return lines.join('\n');
};

export const renderSweepLine = (result: SweepResult): string =>
  `fixtures: base=${result.base === '' ? '<unresolved>' : result.base} resolved=${String(result.baseResolved)} ` +
  `liveOwned=${result.liveOwned} unjudgeable=${result.unjudgeable} residue=${result.residue.length} ` +
  `reaped=${result.reaped.length}`;
