import { afterAll, describe, expect, it } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeFixtureRoot } from '../fixture-root';
import { bareImportsOf, typeScriptFiles } from '../imports';

const fixtures = makeFixtureRoot('imports');

afterAll(() => {
  fixtures.dispose();
});

const withSource = (label: string, source: string): readonly string[] => {
  const dir = join(fixtures.path(), label);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'subject.ts'), source);
  return typeScriptFiles(dir);
};

const WIDE_NAMES = Array.from({ length: 40 }, (_, index) => `name${index}`).join(',\n  ');

describe('bare import extraction', () => {
  it('sees a side-effect import with no from clause', () => {
    expect([...bareImportsOf(withSource('side-effect', "import 'reflect-metadata';\n"))]).toEqual([
      'reflect-metadata',
    ]);
  });

  it('sees an import whose named bindings run past any fixed character window', () => {
    const source = `import {\n  ${WIDE_NAMES}\n} from 'undeclared-package';\nexport const used = [${WIDE_NAMES}];\n`;
    expect([...bareImportsOf(withSource('wide', source))]).toEqual(['undeclared-package']);
  });

  it('sees a dynamic import', () => {
    const source = "export const load = async () => await import('dynamic-pkg');\n";
    expect([...bareImportsOf(withSource('dynamic', source))]).toEqual(['dynamic-pkg']);
  });

  it('sees a re-export', () => {
    expect([...bareImportsOf(withSource('reexport', "export * from 'reexported-pkg';\n"))]).toEqual([
      'reexported-pkg',
    ]);
  });

  it('sees a type-only import, which a consumer still needs installed to typecheck', () => {
    const source = "import type { Thing } from 'type-only-pkg';\nexport type Alias = Thing;\n";
    expect([...bareImportsOf(withSource('type-only', source))]).toEqual(['type-only-pkg']);
  });

  it('reduces a subpath import to its package name, scoped and unscoped', () => {
    const source =
      "import { a } from '@scope/pkg/deep/path';\nimport { b } from 'plain/deep';\nexport const both = [a, b];\n";
    expect([...bareImportsOf(withSource('subpaths', source))].sort()).toEqual(['@scope/pkg', 'plain']);
  });

  it('ignores relative paths and runtime builtins', () => {
    const source =
      "import { x } from './local';\nimport { readFileSync } from 'node:fs';\nimport { it } from 'bun:test';\nexport const all = [x, readFileSync, it];\n";
    expect([...bareImportsOf(withSource('ignored', source))]).toEqual([]);
  });

  it('ignores the bare `bun` module, which the runtime provides and no consumer installs', () => {
    const source = "import { plugin } from 'bun';\nexport const registered = plugin;\n";
    expect([...bareImportsOf(withSource('bun-builtin', source))]).toEqual([]);
  });

  it('still sees a package whose name merely starts with bun', () => {
    const source = "import { x } from 'bundle-thing';\nexport const used = x;\n";
    expect([...bareImportsOf(withSource('bun-prefix', source))]).toEqual(['bundle-thing']);
  });
});
