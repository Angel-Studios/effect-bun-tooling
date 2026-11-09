import { afterAll, describe, expect, it } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { makeFixtureRoot } from '@packages/effect-bun-test/fixture-root';
import { assertSvelteKitSyncRan } from '../src/sync-check';

const APP_TSCONFIG = 'node_modules/$app/tsconfig.json';
const SVELTE_KIT_TSCONFIG = '.svelte-kit/tsconfig.json';

const fixtures = makeFixtureRoot('sync-check');

afterAll(() => {
  fixtures.dispose();
});

const makeSut = (name: string, extendsTarget: string | undefined, generated: string | undefined): string => {
  const cwd = join(fixtures.path(), name);
  mkdirSync(cwd, { recursive: true });
  const body = extendsTarget === undefined ? {} : { extends: extendsTarget };
  writeFileSync(join(cwd, 'tsconfig.json'), `${JSON.stringify(body)}\n`);
  if (generated !== undefined) {
    mkdirSync(dirname(join(cwd, generated)), { recursive: true });
    writeFileSync(join(cwd, generated), '{}\n');
  }
  return cwd;
};

describe('the SvelteKit sync check of the preload', () => {
  it('names node_modules/$app/tsconfig.json when a Kit 3 config has no generated file', () => {
    const cwd = makeSut('kit-3-missing', '$app/tsconfig', undefined);

    expect(() => assertSvelteKitSyncRan(cwd)).toThrow(APP_TSCONFIG);
    expect(() => assertSvelteKitSyncRan(cwd)).toThrow('bunx svelte-kit sync');
  });

  it('accepts a Kit 3 config whose generated file exists', () => {
    const cwd = makeSut('kit-3-present', '$app/tsconfig', APP_TSCONFIG);

    expect(() => assertSvelteKitSyncRan(cwd)).not.toThrow();
  });

  it('also reads the specifier that names the .json extension', () => {
    const cwd = makeSut('kit-3-extension', '$app/tsconfig.json', undefined);

    expect(() => assertSvelteKitSyncRan(cwd)).toThrow(APP_TSCONFIG);
  });

  it('names the Kit 2 file when a Kit 2 config has no generated file', () => {
    const cwd = makeSut('kit-2-missing', `./${SVELTE_KIT_TSCONFIG}`, undefined);

    expect(() => assertSvelteKitSyncRan(cwd)).toThrow(SVELTE_KIT_TSCONFIG);
  });

  it('accepts a Kit 2 config whose generated file exists', () => {
    const cwd = makeSut('kit-2-present', `./${SVELTE_KIT_TSCONFIG}`, SVELTE_KIT_TSCONFIG);

    expect(() => assertSvelteKitSyncRan(cwd)).not.toThrow();
  });

  it('ignores a config that extends another file', () => {
    const cwd = makeSut('unrelated', '../tsconfig.base.json', undefined);

    expect(() => assertSvelteKitSyncRan(cwd)).not.toThrow();
  });

  it('ignores a config with no extends', () => {
    const cwd = makeSut('no-extends', undefined, undefined);

    expect(() => assertSvelteKitSyncRan(cwd)).not.toThrow();
  });

  it('ignores a directory with no tsconfig', () => {
    const cwd = join(fixtures.path(), 'no-tsconfig');
    mkdirSync(cwd, { recursive: true });

    expect(() => assertSvelteKitSyncRan(cwd)).not.toThrow();
  });
});
