import { describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  classifyEntry,
  FIXTURE_ROOT_DIRNAME,
  HOST,
  isOwnerAlive,
  parseFixtureOwner,
  renderResidue,
  renderSweepLine,
  SEP,
  sweepFixtureResidue,
} from '../src/sweep';
import { ownedName, scratchDir } from './fixture-base';

const UNREACHABLE_PID = 2147483647;
const GRACE_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;

type Placed = { readonly name: string; readonly path: string; readonly mtimeMs: number };

const place = (base: string, name: string): Placed => {
  const path = join(base, name);
  mkdirSync(path, { recursive: true });
  return { name, path, mtimeMs: statSync(path).mtimeMs };
};

const verdictAt = (placed: Placed, ageMs: number): string =>
  classifyEntry(placed.name, placed.path, placed.mtimeMs + ageMs);

describe('the convention itself', () => {
  it('names the fixture root directory, so both sides agree on it byte for byte', () => {
    expect(FIXTURE_ROOT_DIRNAME).toBe('.test-fixtures');
    expect(SEP).toBe('--');
  });

  it('sanitises the host segment so it can never contain the token separator', () => {
    expect(HOST).not.toContain(SEP);
    expect(HOST).toMatch(/^[A-Za-z0-9_.]+$/);
  });
});

describe('parseFixtureOwner', () => {
  it('reads label, host and pid out of a conforming name', () => {
    expect(parseFixtureOwner(`suite${SEP}box${SEP}4242${SEP}abcdef`)).toEqual({
      label: 'suite',
      host: 'box',
      pid: 4242,
    });
  });

  it('keeps a hyphenated label whole, because only the last three segments are fixed', () => {
    expect(parseFixtureOwner(`my${SEP}long${SEP}label${SEP}box${SEP}7${SEP}zz`)).toEqual({
      label: `my${SEP}long${SEP}label`,
      host: 'box',
      pid: 7,
    });
  });

  it.each([
    ['too few segments', `suite${SEP}box${SEP}abcdef`],
    ['a non-numeric pid', `suite${SEP}box${SEP}notapid${SEP}abcdef`],
    ['an empty host', `suite${SEP}${SEP}42${SEP}abcdef`],
    ['an empty label', `${SEP}box${SEP}42${SEP}abcdef`],
    ['no token at all', 'plain-directory-name'],
  ])('returns undefined for %s', (_why, name) => {
    expect(parseFixtureOwner(name)).toBeUndefined();
  });
});

describe('isOwnerAlive', () => {
  it('sees this very process', () => {
    expect(isOwnerAlive(process.pid)).toBe(true);
  });

  it('reports a pid no process can hold as dead', () => {
    expect(isOwnerAlive(UNREACHABLE_PID)).toBe(false);
  });
});

describe('classifyEntry', () => {
  const base = scratchDir('classify');

  it('calls a live owner live', () => {
    expect(verdictAt(place(base, ownedName('live', process.pid)), 0)).toBe('live');
  });

  it('refuses to judge a directory carrying no ownership token', () => {
    expect(verdictAt(place(base, 'no-token-here'), 0)).toBe('unjudgeable');
  });

  it('refuses to judge another host, whose pids mean nothing here', () => {
    expect(verdictAt(place(base, ownedName('elsewhere', process.pid, 'some.other.host')), 0)).toBe(
      'unjudgeable',
    );
  });

  it('holds a freshly stranded directory within grace rather than reaping it', () => {
    expect(verdictAt(place(base, ownedName('fresh', UNREACHABLE_PID)), 0)).toBe('within-grace');
  });

  it('still holds it at the grace boundary, which is exclusive', () => {
    expect(verdictAt(place(base, ownedName('boundary', UNREACHABLE_PID)), GRACE_MS)).toBe('within-grace');
  });

  it('calls a dead owner past the grace window residue', () => {
    expect(verdictAt(place(base, ownedName('stale', UNREACHABLE_PID)), GRACE_MS + 1)).toBe('dead-owner');
  });

  it('calls an entry older than a day residue even while its owner still runs', () => {
    expect(verdictAt(place(base, ownedName('ancient', process.pid)), DAY_MS + 1)).toBe('over-age');
  });
});

describe('sweepFixtureResidue', () => {
  it('separates residue from live and unjudgeable entries without reaping', () => {
    const base = scratchDir('sweep-report');
    place(base, ownedName('live', process.pid));
    place(base, 'no-token-here');
    const stale = place(base, ownedName('stale', UNREACHABLE_PID));

    const result = sweepFixtureResidue({ reap: false, base, now: stale.mtimeMs + GRACE_MS + 1 });

    expect(result.baseResolved).toBe(true);
    expect(result.residue.map((r) => r.name)).toEqual([stale.name]);
    expect(result.residue[0]?.verdict).toBe('dead-owner');
    expect(result.liveOwned).toBe(1);
    expect(result.unjudgeable).toBe(1);
    expect(result.reaped).toEqual([]);
    expect(existsSync(stale.path)).toBe(true);
  });

  it('removes exactly the residue when asked to reap, and leaves the rest alone', () => {
    const base = scratchDir('sweep-reap');
    const live = place(base, ownedName('live', process.pid));
    const stale = place(base, ownedName('stale', UNREACHABLE_PID));

    const result = sweepFixtureResidue({ reap: true, base, now: stale.mtimeMs + GRACE_MS + 1 });

    expect(result.reaped).toEqual([stale.path]);
    expect(existsSync(stale.path)).toBe(false);
    expect(existsSync(live.path)).toBe(true);
  });

  it('reports an absent base as resolved-and-empty rather than as a failure', () => {
    const result = sweepFixtureResidue({ reap: false, base: join(scratchDir('absent'), 'never-made') });

    expect(result.baseResolved).toBe(true);
    expect(result.residue).toEqual([]);
    expect(result.liveOwned).toBe(0);
  });
});

describe('rendering', () => {
  it('says nothing when the sweep is clean, so a passing run stays quiet', () => {
    const base = scratchDir('render-clean');
    place(base, ownedName('live', process.pid));

    expect(renderResidue(sweepFixtureResidue({ reap: false, base }))).toBe('');
  });

  it('names the offending directories and refuses to suggest deleting them by hand', () => {
    const base = scratchDir('render-dirty');
    const stale = place(base, ownedName('stale', UNREACHABLE_PID));

    const rendered = renderResidue(
      sweepFixtureResidue({ reap: false, base, now: stale.mtimeMs + GRACE_MS + 1 }),
    );

    expect(rendered).toContain('residue tripwire FAILED');
    expect(rendered).toContain(stale.name);
    expect(rendered).toContain('deleting these by hand hides the defect');
  });

  it('distinguishes an unresolvable base from a clean one, because they are not the same result', () => {
    const rendered = renderResidue({
      base: '',
      baseResolved: false,
      residue: [],
      reaped: [],
      liveOwned: 0,
      unjudgeable: 0,
    });

    expect(rendered).toContain('COULD NOT RUN');
  });

  it('renders a one-line summary carrying every count', () => {
    const line = renderSweepLine({
      base: '/somewhere/.test-fixtures',
      baseResolved: true,
      residue: [{ name: 'a', path: '/somewhere/.test-fixtures/a', verdict: 'dead-owner' }],
      reaped: ['/somewhere/.test-fixtures/a'],
      liveOwned: 2,
      unjudgeable: 3,
    });

    expect(line).toBe(
      'fixtures: base=/somewhere/.test-fixtures resolved=true liveOwned=2 unjudgeable=3 residue=1 reaped=1',
    );
  });

  it('marks an unresolved base rather than printing an empty path', () => {
    const line = renderSweepLine({
      base: '',
      baseResolved: false,
      residue: [],
      reaped: [],
      liveOwned: 0,
      unjudgeable: 0,
    });

    expect(line).toContain('base=<unresolved>');
  });
});
