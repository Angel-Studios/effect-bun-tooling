#!/usr/bin/env bun

import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { publishablePackages, repoRoot, tarballName } from './workspace';

const destination = join(repoRoot, 'dist-tarballs');

const packAll = async (): Promise<readonly string[]> => {
  rmSync(destination, { recursive: true, force: true });
  mkdirSync(destination, { recursive: true });

  const packed: string[] = [];
  for (const pkg of publishablePackages()) {
    const expected = tarballName(pkg.manifest);
    const result = Bun.spawnSync({
      cmd: ['bun', 'pm', 'pack', '--destination', destination, '--filename', expected, '--quiet'],
      cwd: pkg.dir,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    if (result.exitCode !== 0) {
      throw new Error(`bun pm pack failed for ${pkg.manifest.name}: ${result.stderr.toString()}`);
    }
    packed.push(join(destination, expected));
  }
  return packed;
};

const tarballs = await packAll();
for (const path of tarballs) process.stdout.write(`${path}\n`);
