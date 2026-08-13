#!/usr/bin/env bun

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot, workspacePackages } from './workspace';

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

const requested = process.argv[2];
if (requested === undefined || !SEMVER.test(requested)) {
  process.stderr.write('usage: bun scripts/set-version.ts <major.minor.patch[-prerelease]>\n');
  process.exit(1);
}

const rewriteVersion = (manifestPath: string, version: string): void => {
  const source = readFileSync(manifestPath, 'utf8');
  const rewritten = source.replace(/^(\s*)"version": "[^"]*"/m, `$1"version": "${version}"`);
  if (rewritten === source) throw new Error(`${manifestPath} has no top-level version field to rewrite`);
  writeFileSync(manifestPath, rewritten);
};

const targets = [join(repoRoot, 'package.json'), ...workspacePackages().map((pkg) => pkg.manifestPath)];
for (const target of targets) {
  rewriteVersion(target, requested);
  process.stdout.write(`${target} -> ${requested}\n`);
}
