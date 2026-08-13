#!/usr/bin/env bun

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot, withVersion, workspacePackages } from './workspace';

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

const requested = process.argv[2];
if (requested === undefined || !SEMVER.test(requested)) {
  process.stderr.write('usage: bun scripts/set-version.ts <major.minor.patch[-prerelease]>\n');
  process.exit(1);
}

const rewriteVersion = (manifestPath: string, version: string): void => {
  try {
    writeFileSync(manifestPath, withVersion(readFileSync(manifestPath, 'utf8'), version));
  } catch (cause) {
    throw new Error(`${manifestPath}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
  }
};

const targets = [join(repoRoot, 'package.json'), ...workspacePackages().map((pkg) => pkg.manifestPath)];
for (const target of targets) {
  rewriteVersion(target, requested);
  process.stdout.write(`${target} -> ${requested}\n`);
}
