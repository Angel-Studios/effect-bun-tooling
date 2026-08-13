import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const transpiler = new Bun.Transpiler({ loader: 'ts' });

export const typeScriptFiles = (dir: string): readonly string[] => {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) found.push(...typeScriptFiles(path));
    else if (entry.endsWith('.ts')) found.push(path);
  }
  return found;
};

const packageNameOf = (specifier: string): string => {
  const segments = specifier.split('/');
  return specifier.startsWith('@') ? segments.slice(0, 2).join('/') : (segments[0] ?? specifier);
};

const RUNTIME_BUILTINS: ReadonlySet<string> = new Set(['bun']);

const isBare = (specifier: string): boolean =>
  !specifier.startsWith('.') &&
  !specifier.startsWith('/') &&
  !specifier.startsWith('node:') &&
  !specifier.startsWith('bun:') &&
  !RUNTIME_BUILTINS.has(specifier);

const TYPE_ONLY_STATEMENT = /(?:import|export)\s+type\b[\s\S]*?\bfrom\s*['"]([^'"]+)['"]/g;

const typeOnlySpecifiers = (source: string): readonly string[] =>
  [...source.matchAll(TYPE_ONLY_STATEMENT)].flatMap((match) => (match[1] === undefined ? [] : [match[1]]));

export const bareImportsOf = (files: readonly string[]): ReadonlySet<string> => {
  const bare = new Set<string>();
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const specifiers = [
      ...transpiler.scanImports(source).map((record) => record.path),
      ...typeOnlySpecifiers(source),
    ];
    for (const specifier of specifiers) {
      if (isBare(specifier)) bare.add(packageNameOf(specifier));
    }
  }
  return bare;
};
