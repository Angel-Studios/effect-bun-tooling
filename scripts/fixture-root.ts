import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { FIXTURE_ROOT_DIRNAME, HOST, SEP } from '@packages/fixture-residue/sweep';
import { repoRoot } from './workspace';

/** The convention comes from `@packages/fixture-residue`, never a local copy. This minter is
 *  deliberately simpler than `@packages/effect-bun-test/fixture-root` — no sweep, no `reserve`,
 *  and the repo root comes from `./workspace` rather than a marker walk — but the directory NAME
 *  it produces must stay token-compatible with it, because the tooling-plane tripwire classifies
 *  every entry under the base. Re-declaring `SEP` or `HOST` here would silently demote these
 *  directories to `unjudgeable`, which is never reaped and reported until a human intervenes. */

export type FixtureRoot = {
  readonly path: () => string;

  readonly dispose: () => void;
};

export const makeFixtureRoot = (label: string): FixtureRoot => {
  if (label.includes(SEP) || label === '') {
    throw new Error(`invalid fixture label ${JSON.stringify(label)}: it must be non-empty and hyphen-free`);
  }

  let created: string | undefined;

  return {
    path: () => {
      if (created === undefined) {
        created = join(
          repoRoot,
          FIXTURE_ROOT_DIRNAME,
          [label, HOST, String(process.pid), Bun.randomUUIDv7('hex')].join(SEP),
        );
        mkdirSync(created, { recursive: true });
      }
      return created;
    },
    dispose: () => {
      const root = created;
      if (root === undefined) return;
      created = undefined;
      rmSync(root, { recursive: true, force: true });
    },
  };
};
