#!/usr/bin/env bun

import { join } from 'node:path';
import { readManifest, repoRoot, workspacePackages } from './workspace';

const tag = process.argv[2];
if (tag === undefined) {
  process.stderr.write('usage: bun scripts/assert-tag-version.ts <vX.Y.Z>\n');
  process.exit(1);
}

const expected = tag.startsWith('v') ? tag.slice(1) : tag;
const rootVersion = readManifest(join(repoRoot, 'package.json')).version;
const mismatches = [
  ...(rootVersion === expected ? [] : [`package.json is ${rootVersion}`]),
  ...workspacePackages()
    .filter((pkg) => pkg.manifest.version !== expected)
    .map((pkg) => `${pkg.manifest.name} is ${pkg.manifest.version}`),
];

if (mismatches.length > 0) {
  process.stderr.write(`tag ${tag} expects version ${expected}; ${mismatches.join(', ')}\n`);
  process.exit(1);
}

process.stdout.write(
  `tag ${tag} matches version ${expected} across ${workspacePackages().length} packages\n`,
);
