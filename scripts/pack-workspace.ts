#!/usr/bin/env bun

import { mkdirSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import { publishablePackages, repoRoot, tarballName } from './workspace';

export const DEFAULT_DESTINATION = join(repoRoot, 'dist-tarballs');

export const packOne = (dir: string, destination: string): string => {
  const result = Bun.spawnSync({
    cmd: ['bun', 'pm', 'pack', '--destination', destination, '--quiet'],
    cwd: dir,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (result.exitCode !== 0) {
    throw new Error(`bun pm pack failed in ${dir}: ${result.stderr.toString()}`);
  }
  return join(destination, basename(result.stdout.toString().trim()));
};

export const packAll = (destination: string = DEFAULT_DESTINATION): readonly string[] => {
  rmSync(destination, { recursive: true, force: true });
  mkdirSync(destination, { recursive: true });

  const packed: string[] = [];
  for (const pkg of publishablePackages()) {
    const produced = basename(packOne(pkg.dir, destination));
    const expected = tarballName(pkg.manifest);
    if (produced !== expected) {
      throw new Error(
        `bun pm pack named ${pkg.manifest.name}'s tarball ${produced}; the release URL expects ${expected}`,
      );
    }
    packed.push(join(destination, expected));
  }
  return packed;
};

if (import.meta.main) {
  for (const path of packAll()) process.stdout.write(`${path}\n`);
}
