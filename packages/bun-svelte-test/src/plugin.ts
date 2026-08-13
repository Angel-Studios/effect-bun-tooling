import { readFileSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import type { BunPlugin } from 'bun';
import { compile, compileModule } from 'svelte/compiler';

const SVELTE_COMPONENT_FILTER = /\.svelte$/;
const SVELTE_MODULE_FILTER = /\.svelte\.(ts|js)$/;

const COMPILE_OPTIONS = {
  generate: 'client',
  dev: true,
  css: 'injected',
} as const;

export const SUBSTITUTION_ROOTS: readonly string[] = [process.cwd(), import.meta.dir];

export type BrowserSubstitution = {
  readonly subpath: string;
  readonly serverPath: string;
  readonly browserPath: string;
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

type ExportsEntry = { readonly browser?: unknown; readonly default?: unknown };

export const deriveBrowserSubstitutions = (
  fromDirs: readonly string[] = SUBSTITUTION_ROOTS,
): readonly BrowserSubstitution[] => {
  const found = new Map<string, BrowserSubstitution>();

  for (const dir of fromDirs) {
    let packageJsonPath: string;
    try {
      packageJsonPath = Bun.resolveSync('svelte/package.json', dir);
    } catch {
      continue;
    }

    const packageDir = dirname(packageJsonPath);
    const parsed = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      exports?: Record<string, unknown>;
    };
    if (parsed.exports === undefined) continue;

    for (const [subpath, entry] of Object.entries(parsed.exports)) {
      if (entry === null || typeof entry !== 'object') continue;
      const { browser, default: serverTarget } = entry as ExportsEntry;
      if (typeof browser !== 'string' || typeof serverTarget !== 'string') continue;

      const serverPath = resolvePath(packageDir, serverTarget);
      const browserPath = resolvePath(packageDir, browser);
      if (serverPath === browserPath) continue;
      if (!found.has(serverPath)) found.set(serverPath, { subpath, serverPath, browserPath });
    }
  }

  return [...found.values()];
};

const typeStripper = new Bun.Transpiler({ loader: 'ts', target: 'browser' });

export const sveltePlugin: BunPlugin = {
  name: 'bun-svelte-test',
  setup(build) {
    build.onLoad({ filter: SVELTE_COMPONENT_FILTER }, async ({ path }) => {
      const source = await Bun.file(path).text();
      const { js } = compile(source, { ...COMPILE_OPTIONS, filename: path });
      return { contents: js.code, loader: 'js' };
    });

    build.onLoad({ filter: SVELTE_MODULE_FILTER }, async ({ path }) => {
      const source = await Bun.file(path).text();
      const javascript = path.endsWith('.ts') ? typeStripper.transformSync(source) : source;
      const { js } = compileModule(javascript, {
        generate: COMPILE_OPTIONS.generate,
        dev: COMPILE_OPTIONS.dev,
        filename: path,
      });
      return { contents: js.code, loader: 'js' };
    });

    for (const substitution of deriveBrowserSubstitutions()) {
      build.onLoad({ filter: new RegExp(`^${escapeRegExp(substitution.serverPath)}$`) }, () => ({
        contents: `export * from ${JSON.stringify(substitution.browserPath)};`,
        loader: 'js',
      }));
    }
  },
};
