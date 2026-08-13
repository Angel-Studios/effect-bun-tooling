#!/usr/bin/env bun

import { mkdirSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import { publishablePackages, repoRoot, tarballName } from './workspace';

const destination = join(repoRoot, 'dist-tarballs');

const packAll = (): readonly string[] => {
  rmSync(destination, { recursive: true, force: true });
  mkdirSync(destination, { recursive: true });

  const packed: string[] = [];
  for (const pkg of publishablePackages()) {
    const result = Bun.spawnSync({
      cmd: ['bun', 'pm', 'pack', '--destination', destination, '--quiet'],
      cwd: pkg.dir,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    if (result.exitCode !== 0) {
      throw new Error(`bun pm pack failed for ${pkg.manifest.name}: ${result.stderr.toString()}`);
    }
    const produced = basename(result.stdout.toString().trim());
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

for (const path of packAll()) process.stdout.write(`${path}\n`);
