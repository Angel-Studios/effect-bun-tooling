import { afterAll } from 'bun:test';
import { mkdirSync, rmSync } from 'node:fs';
import { hostname } from 'node:os';
import { basename, join } from 'node:path';
import { repoRoot } from '../workspace';

const token = (): string =>
  [
    basename(Bun.main).replace(/\.test\.ts$/, ''),
    hostname(),
    String(process.pid),
    Bun.randomUUIDv7('hex'),
  ].join('--');

let root: string | undefined;

export const fixtureRoot = (): string => {
  if (root === undefined) {
    root = join(repoRoot, '.test-fixtures', token());
    mkdirSync(root, { recursive: true });
  }
  return root;
};

afterAll(() => {
  if (root !== undefined) rmSync(root, { recursive: true, force: true });
});
