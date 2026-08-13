import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SPECIFIER =
  /(?:^|[\s;])(?:import|export)[\s\S]{0,200}?from\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]/g;

export const typeScriptFiles = (dir: string): readonly string[] => {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) found.push(...typeScriptFiles(path));
    else if (entry.endsWith('.ts')) found.push(path);
  }
  return found;
};

export const packageNameOf = (specifier: string): string => {
  const segments = specifier.split('/');
  return specifier.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0];
};

export const bareImportsOf = (files: readonly string[]): ReadonlySet<string> => {
  const bare = new Set<string>();
  for (const file of files) {
    for (const match of readFileSync(file, 'utf8').matchAll(SPECIFIER)) {
      const specifier = match[1] ?? match[2];
      if (specifier === undefined) continue;
      if (specifier.startsWith('.') || specifier.startsWith('node:') || specifier.startsWith('bun:'))
        continue;
      bare.add(packageNameOf(specifier));
    }
  }
  return bare;
};
