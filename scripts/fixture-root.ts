import { mkdirSync, rmSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { repoRoot } from './workspace';

const FIXTURE_ROOT_DIRNAME = '.test-fixtures';
const SEP = '--';
const HOST = hostname().replace(/[^A-Za-z0-9_.]+/g, '_');

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
