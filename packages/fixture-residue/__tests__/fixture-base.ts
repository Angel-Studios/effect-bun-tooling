import { afterAll } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { FIXTURE_ROOT_DIRNAME, HOST, SEP } from '../src/sweep';

const repoRoot = (): string => {
  let dir = import.meta.dir;
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml')) || existsSync(join(dir, '.git'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`could not locate the repo root by walking up from ${import.meta.dir}`);
};

const created: string[] = [];

export const scratchDir = (label: string): string => {
  const base = join(repoRoot(), FIXTURE_ROOT_DIRNAME);
  mkdirSync(base, { recursive: true });
  const dir = mkdtempSync(join(base, [label, HOST, String(process.pid), ''].join(SEP)));
  created.push(dir);
  return dir;
};

export const ownedName = (label: string, pid: number, host: string = HOST): string =>
  [label, host, String(pid), 'aaaa'].join(SEP);

afterAll(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});
